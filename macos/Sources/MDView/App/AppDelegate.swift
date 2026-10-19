import AppKit
import UniformTypeIdentifiers

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, NSMenuItemValidation {
    private(set) static weak var shared: AppDelegate?

    private var workspaceWindows: [WorkspaceWindowController] = []
    private var welcome: WelcomeWindowController?
    private var settingsWindow: SettingsWindowController?
    private var isTerminating = false
    private var launched = false
    private var pendingOpen: [URL] = []

    /// Paths from the command line (already validated to exist).
    var launchPaths: [URL] = []

    override init() {
        super.init()
        AppDelegate.shared = self
    }

    // MARK: Lifecycle

    func applicationWillFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.set(false, forKey: "NSQuitAlwaysKeepsWindows")
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.mainMenu = MainMenu.build(recentMenuDelegate: self)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        DebugSnapshot.installIfRequested()
        let session = SessionManager.shared
        session.collectWorkspaces = { [weak self] in self?.workspaceWindows.map(\.session) ?? [] }
        session.tracksOpenWorkspaces = false
        if AppSettings.shared.prefs.reopenWorkspaces {
            for ws in session.savedWorkspaces where FileManager.default.fileExists(atPath: ws.root) {
                openWorkspace(URL(fileURLWithPath: ws.root), session: ws)
            }
        }
        launched = true
        open(urls: launchPaths + pendingOpen)
        pendingOpen.removeAll()
        session.tracksOpenWorkspaces = true
        DispatchQueue.main.async {
            if self.workspaceWindows.isEmpty { self.showWelcome() }
            NSApp.activate()
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WorkspaceRegistry.stores.forEach { $0.autosaveAll() } }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if launched { open(urls: urls) } else { pendingOpen.append(contentsOf: urls) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWelcome() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let dirty = WorkspaceRegistry.stores.flatMap { s in s.dirtyTabs.map { (s, $0) } }
        if !dirty.isEmpty {
            let alert = NSAlert()
            alert.messageText = dirty.count == 1
                ? "Do you want to save the changes you made to “\(dirty[0].1.title)” before quitting?"
                : "You have \(dirty.count) documents with unsaved changes. Save them before quitting?"
            alert.informativeText = "Your changes will be lost if you don’t save them."
            alert.addButton(withTitle: dirty.count == 1 ? "Save" : "Save All")
            alert.addButton(withTitle: "Don’t Save")
            alert.addButton(withTitle: "Cancel")
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                for (store, tab) in dirty where !store.saveSynchronously(tab) { return .terminateCancel }
            case .alertSecondButtonReturn:
                break
            default:
                return .terminateCancel
            }
        }
        SessionManager.shared.saveNow()
        isTerminating = true
        SessionManager.shared.tracksOpenWorkspaces = false
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        if !isTerminating { SessionManager.shared.saveNow() }
    }

    // MARK: Opening

    func open(urls: [URL]) {
        for url in urls {
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue {
                openWorkspace(url)
            } else {
                openFile(url)
            }
        }
    }

    @discardableResult
    func openWorkspace(_ url: URL, session: WorkspaceSession? = nil) -> WorkspaceWindowController {
        let root = url.canonical
        if let existing = workspaceWindows.first(where: { $0.store.root == root }) {
            existing.showWindow(nil)
            return existing
        }
        let store = WorkspaceStore(root: root)
        store.start()
        let wc = WorkspaceWindowController(store: store)
        if let session {
            wc.apply(session)
        } else if let last = workspaceWindows.last?.window {
            wc.window?.setFrameTopLeftPoint(last.cascadeTopLeft(from: NSPoint(x: last.frame.minX, y: last.frame.maxY)))
        } else {
            wc.window?.center()
        }
        workspaceWindows.append(wc)
        wc.showWindow(nil)
        SessionManager.shared.noteRecent(root.path)
        welcome?.close()
        SessionManager.shared.scheduleSave()
        return wc
    }

    func openFile(_ url: URL) {
        let file = url.canonical
        let store: WorkspaceStore
        if let s = WorkspaceRegistry.store(containing: file) {
            store = s
            workspaceWindows.first { $0.store === s }?.showWindow(nil)
        } else {
            store = openWorkspace(file.deletingLastPathComponent()).store
        }
        guard let rel = store.relativePath(of: file) else { return }
        store.open(rel, pinned: true)
    }

    func workspaceWindowWillClose(_ wc: WorkspaceWindowController) {
        guard !isTerminating else { return }
        workspaceWindows.removeAll { $0 === wc }
        SessionManager.shared.scheduleSave()
    }

    func showWelcome() {
        if welcome == nil {
            let w = WelcomeWindowController()
            w.onClose = { [weak self] in self?.welcome = nil }
            welcome = w
        }
        welcome?.showWindow(nil)
        welcome?.window?.makeKeyAndOrderFront(nil)
    }

    // MARK: Actions

    @objc func newWindow(_ sender: Any?) { showWelcome() }

    @objc func openFolderPanel(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Open"
        panel.message = "Choose a folder to open as a workspace"
        if panel.runModal() == .OK { open(urls: panel.urls) }
    }

    @objc func openFilePanel(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = ["md", "markdown", "mdx"].compactMap { UTType(filenameExtension: $0) }
            + [UTType("net.daringfireball.markdown")].compactMap { $0 }
        if panel.runModal() == .OK { open(urls: panel.urls) }
    }

    @objc func showSettings(_ sender: Any?) {
        if settingsWindow == nil { settingsWindow = SettingsWindowController() }
        settingsWindow?.showWindow(nil)
        settingsWindow?.window?.makeKeyAndOrderFront(nil)
    }

    @objc func zoomInText(_ sender: Any?) { AppSettings.shared.adjustFontSize(by: 1) }
    @objc func zoomOutText(_ sender: Any?) { AppSettings.shared.adjustFontSize(by: -1) }
    @objc func actualSizeText(_ sender: Any?) { AppSettings.shared.prefs.core.fontSize = CoreSettings().fontSize }

    /// Fallback for ⌘W when no tab-aware window is key.
    @objc func closeTab(_ sender: Any?) { NSApp.keyWindow?.performClose(sender) }

    @objc private func openRecent(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        guard FileManager.default.fileExists(atPath: path) else { return NSSound.beep() }
        open(urls: [URL(fileURLWithPath: path)])
    }

    @objc private func clearRecents(_ sender: Any?) { SessionManager.shared.clearRecents() }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(zoomInText(_:)): AppSettings.shared.prefs.core.fontSize < AppSettings.fontSizeRange.upperBound
        case #selector(zoomOutText(_:)): AppSettings.shared.prefs.core.fontSize > AppSettings.fontSizeRange.lowerBound
        case #selector(closeTab(_:)): NSApp.keyWindow != nil
        default: true
        }
    }

    // MARK: Open Recent menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        for path in SessionManager.shared.recents {
            let item = NSMenuItem(title: (path as NSString).lastPathComponent, action: #selector(openRecent(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = path
            item.toolTip = path
            let icon = NSWorkspace.shared.icon(forFile: path)
            icon.size = NSSize(width: 16, height: 16)
            item.image = icon
            menu.addItem(item)
        }
        if !SessionManager.shared.recents.isEmpty { menu.addItem(.separator()) }
        let clear = NSMenuItem(title: "Clear Menu", action: #selector(clearRecents(_:)), keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
    }
}
