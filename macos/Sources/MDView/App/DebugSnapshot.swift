import AppKit
import WebKit

/// Development aid: when MDVIEW_DEBUG_SNAPSHOT=<file.png> is set, `kill -USR1 <pid>` writes
/// an image of the front window (native views plus web view contents). Useful where
/// screen recording is not permitted.
@MainActor
enum DebugSnapshot {
    private static var source: DispatchSourceSignal?

    static func installIfRequested() {
        DebugCommands.installIfRequested()
        guard let path = ProcessInfo.processInfo.environment["MDVIEW_DEBUG_SNAPSHOT"], !path.isEmpty else { return }
        signal(SIGUSR1, SIG_IGN)
        let s = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        s.setEventHandler {
            Task { @MainActor in await capture(to: URL(fileURLWithPath: path)) }
        }
        s.resume()
        source = s
    }

    static func capture(to url: URL, includeWeb: Bool = true) async {
        guard let window = DebugCommands.activeWindow ?? NSApp.orderedWindows.first(where: { $0.isVisible && !($0 is OffscreenWindow) })
        else { return }
        await capture(window: window, to: url, includeWeb: includeWeb)
    }

    static func capture(window: NSWindow, to url: URL, includeWeb: Bool) async {
        guard let frameView = window.contentView?.superview else { return }
        let bounds = frameView.bounds
        guard let rep = frameView.bitmapImageRepForCachingDisplay(in: bounds) else { return }
        frameView.cacheDisplay(in: bounds, to: rep)
        let image = NSImage(size: bounds.size)
        image.addRepresentation(rep)

        var webViews: [WKWebView] = []
        func collect(_ v: NSView) {
            if let w = v as? WKWebView, !w.isHidden, w.window != nil { webViews.append(w); return }
            v.subviews.forEach(collect)
        }
        if includeWeb { collect(frameView) }

        let output = NSImage(size: bounds.size)
        output.lockFocus()
        image.draw(in: bounds)
        output.unlockFocus()
        for web in webViews {
            let config = WKSnapshotConfiguration()
            guard let snap = try? await web.takeSnapshot(configuration: config) else { continue }
            let rect = web.convert(web.bounds, to: frameView)
            output.lockFocus()
            snap.draw(in: rect)
            output.unlockFocus()
        }
        guard let tiff = output.tiffRepresentation, let bmp = NSBitmapImageRep(data: tiff),
              let png = bmp.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: url, options: .atomic)
        debugLog("wrote snapshot \(url.path)")
    }
}

/// Development aid: when MDVIEW_DEBUG_COMMANDS=<file> is set, `kill -USR2 <pid>` runs the
/// commands in that file (one per line) and appends results to MDVIEW_DEBUG output (stderr).
///   action <selector:>        send a nil-targeted action (as a menu item would)
///   post <json>               inject a core→host message from the active tab's web view
///   js <script>               evaluate JavaScript in the active tab's web view and log the result
///   open <path>               open a file or folder as if dropped on the Dock icon
///   key <chars> [cmd,shift,option,control]   deliver a key-down through NSApp.sendEvent
///   dump                      log workspace and tab state as JSON
///   wait <seconds>
@MainActor
enum DebugCommands {
    private static var source: DispatchSourceSignal?

    static func installIfRequested() {
        guard let path = ProcessInfo.processInfo.environment["MDVIEW_DEBUG_COMMANDS"], !path.isEmpty else { return }
        signal(SIGUSR2, SIG_IGN)
        let s = DispatchSource.makeSignalSource(signal: SIGUSR2, queue: .main)
        s.setEventHandler {
            Task { @MainActor in await run(URL(fileURLWithPath: path)) }
        }
        s.resume()
        source = s
    }

    private static func out(_ s: String) {
        FileHandle.standardError.write(Data(("[debug] " + s + "\n").utf8))
    }

    private static var selectedRoot: String?

    static var activeWindow: NSWindow? {
        let windows = NSApp.orderedWindows.filter { $0.windowController is WorkspaceWindowController }
        if let selectedRoot, let w = windows.first(where: { ($0.windowController as? WorkspaceWindowController)?.store.root.path.hasSuffix(selectedRoot) == true }) {
            return w
        }
        return windows.first
    }

    private static var activeStore: WorkspaceStore? {
        (activeWindow?.windowController as? WorkspaceWindowController)?.store
    }

    static func run(_ file: URL) async {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return }
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            let (cmd, arg) = line.firstIndex(of: " ").map { (String(line[..<$0]), String(line[line.index(after: $0)...])) } ?? (line, "")
            switch cmd {
            case "select":
                selectedRoot = arg
                activeWindow?.makeKeyAndOrderFront(nil)
                out("selected \(activeStore?.root.path ?? "-")")
            case "action":
                activeWindow?.makeKeyAndOrderFront(nil)
                // The app may not be active (no key window), so walk the window's chain explicitly.
                let sel = Selector(arg)
                var ok = false
                if NSApp.keyWindow == nil, let w = activeWindow {
                    ok = (w.firstResponder ?? w).tryToPerform(sel, with: nil)
                }
                if !ok { ok = NSApp.sendAction(sel, to: nil, from: nil) }
                out("action \(arg) -> \(ok)")
            case "post":
                guard let store = activeStore, let tab = store.activeTab, let c = WebViewPool.shared.live(tab.id) else { out("post: no tab"); continue }
                _ = try? await c.webView.evaluateJavaScript("window.webkit.messageHandlers.mdview.postMessage(\(arg)); 1")
                out("posted \(arg.prefix(80))")
            case "js":
                guard let store = activeStore, let tab = store.activeTab, let c = WebViewPool.shared.live(tab.id) else { out("js: no tab"); continue }
                do {
                    let r = try await c.webView.callAsyncJavaScript(arg, arguments: [:], in: nil, contentWorld: .page)
                    out("js -> \(String(describing: r))")
                } catch { out("js error: \(error)") }
            case "openrel":
                // Like a tree click: "openrel docs/a.md" (preview) or "openrel docs/a.md pin".
                let parts = arg.split(separator: " ").map(String.init)
                guard let store = activeStore, let path = parts.first else { continue }
                store.open(path, pinned: parts.count > 1)
            case "open":
                AppDelegate.shared?.open(urls: [URL(fileURLWithPath: arg)])
            case "key":
                let parts = arg.split(separator: " ", maxSplits: 1).map(String.init)
                var chars = parts.first ?? ""
                if chars == "RET" { chars = "\r" } else if chars == "TAB" { chars = "\t" }
                var flags: NSEvent.ModifierFlags = []
                for m in (parts.count > 1 ? parts[1] : "").split(separator: ",") {
                    switch m {
                    case "cmd": flags.insert(.command)
                    case "shift": flags.insert(.shift)
                    case "option": flags.insert(.option)
                    case "control": flags.insert(.control)
                    default: break
                    }
                }
                guard let w = activeWindow else { continue }
                w.makeKeyAndOrderFront(nil)
                if let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                            windowNumber: w.windowNumber, context: nil, characters: chars,
                                            charactersIgnoringModifiers: chars, isARepeat: false, keyCode: 0) {
                    NSApp.sendEvent(e)
                    out("key \(arg) sent (first responder: \(type(of: w.firstResponder as Any)))")
                }
            case "focusweb":
                guard let store = activeStore, let tab = store.activeTab, let c = WebViewPool.shared.live(tab.id) else { continue }
                c.webView.window?.makeFirstResponder(c.webView)
                out("focused web view")
            case "dump":
                guard let store = activeStore else { out("dump: no workspace"); continue }
                let tabs = store.tabs.map { t in
                    "{\"path\":\"\(t.path)\",\"pinned\":\(t.isPinned),\"mode\":\"\(t.mode.rawValue)\",\"dirty\":\(t.isDirty),\"deleted\":\(t.isDeleted),\"banner\":\"\(t.banner?.kind.rawValue ?? "")\",\"back\":\(t.back.count),\"fwd\":\(t.forward.count),\"scrollY\":\(t.state.scrollY ?? -1),\"live\":\(WebViewPool.shared.live(t.id) != nil)}"
                }
                out("dump active-app=\(NSApp.isActive) key=\(NSApp.keyWindow?.title ?? "-") fr=\(NSApp.keyWindow.map { String(describing: type(of: $0.firstResponder as Any)) } ?? "-") root=\(store.root.path) active=\(store.activeTab?.path ?? "-") filter=\(store.filterMode.rawValue) expanded=\(store.expanded.sorted()) tabs=[\(tabs.joined(separator: ","))] pool=\(WebViewPool.shared.all.count) font=\(AppSettings.shared.prefs.core.fontSize) width=\(AppSettings.shared.prefs.core.width.rawValue)")
            case "tree":
                // tree <markdown|markdownAndFolders|allFiles> | tree query <text> | tree reveal
                guard let store = activeStore else { continue }
                let parts = arg.split(separator: " ", maxSplits: 1).map(String.init)
                if parts.first == "query" { store.filterQuery = parts.count > 1 ? parts[1] : "" }
                else if parts.first == "reveal" { store.revealActiveFile() }
                else if let m = FilterMode(rawValue: arg) { store.filterMode = m }
                func walk(_ n: FileNode, _ depth: Int) -> [String] {
                    [String(repeating: "  ", count: depth) + n.name + (n.isDir ? "/" : "")] + n.children.flatMap { walk($0, depth + 1) }
                }
                out("tree:\n" + (store.displayRoot.map { walk($0, 0) } ?? []).joined(separator: "\n"))
            case "openmany":
                guard let store = activeStore else { continue }
                for p in store.markdownPaths.prefix(Int(arg) ?? 10) {
                    store.open(p, pinned: true)
                    try? await Task.sleep(for: .milliseconds(300))
                }
            case "snapshotwin":
                // snapshotwin <title prefix> <path>
                let parts = arg.split(separator: " ", maxSplits: 1).map(String.init)
                guard parts.count == 2, let w = NSApp.windows.first(where: { $0.isVisible && $0.title.hasPrefix(parts[0]) }) else { out("no window"); continue }
                await DebugSnapshot.capture(window: w, to: URL(fileURLWithPath: parts[1]), includeWeb: true)
            case "snapshot":
                // snapshot <path> [noweb] — noweb shows native views only (overlays above web views).
                let parts = arg.split(separator: " ").map(String.init)
                guard let p = parts.first else { continue }
                await DebugSnapshot.capture(to: URL(fileURLWithPath: p), includeWeb: !parts.contains("noweb"))
            case "wait":
                try? await Task.sleep(for: .seconds(Double(arg) ?? 1))
            default:
                out("unknown command \(cmd)")
            }
        }
        out("done")
    }
}
