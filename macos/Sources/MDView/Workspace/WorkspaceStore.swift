import AppKit
import Observation

/// UI services the store needs from its window.
@MainActor
protocol WorkspaceUI: AnyObject {
    func showError(_ error: Error)
    func requestClose(_ tab: Tab)
    func saveAs(_ tab: Tab)
    func export(svg: String, format: String, suggestedName: String, width: Double, height: Double)
    func setFullScreen(_ on: Bool)
    var isWebViewFocused: Bool { get }
}

@MainActor
enum WorkspaceRegistry {
    static var stores: [WorkspaceStore] = []

    static func tab(withID id: UUID) -> Tab? {
        for s in stores { if let t = s.tabs.first(where: { $0.id == id }) { return t } }
        return nil
    }

    /// The open workspace with the deepest root containing `url`.
    static func store(containing url: URL) -> WorkspaceStore? {
        let p = url.canonical.path
        return stores
            .filter { p == $0.root.path || p.hasPrefix($0.root.path + "/") }
            .max { $0.root.path.count < $1.root.path.count }
    }
}

@MainActor @Observable
final class WorkspaceStore {
    let root: URL
    var name: String { root.lastPathComponent }

    // MARK: Tree state
    var filterMode: FilterMode {
        didSet { if filterMode != oldValue { rebuildTree(); persistPrefs() } }
    }
    var filterQuery = "" {
        didSet { if filterQuery != oldValue { rebuildTree() } }
    }
    @ObservationIgnored var expanded: Set<String> {
        didSet { persistPrefs() }
    }
    private(set) var displayRoot: FileNode?
    /// Bumped when the visible tree structure changes.
    private(set) var treeVersion = 0
    /// Bumped when only modification dots may have changed.
    private(set) var dotsVersion = 0
    private(set) var markdownPaths: [String] = []
    private(set) var isScanning = false
    @ObservationIgnored private var scan: ScanResult?
    @ObservationIgnored private var nodes: [String: FileNode] = [:]
    @ObservationIgnored private var rescanPending = false
    @ObservationIgnored private var watcher: FileWatcher?
    @ObservationIgnored private var dotTimer: Timer?
    @ObservationIgnored private var prefsObserver: NSObjectProtocol?

    // MARK: Tab state
    var tabs: [Tab] = []
    var activeTabID: UUID? {
        didSet { if activeTabID != oldValue { SessionManager.shared.scheduleSave() } }
    }
    var revealRequest = 0
    var quickOpenVisible = false
    var sidebarVisible = true
    @ObservationIgnored private var closedTabs: [TabSnapshot] = []
    @ObservationIgnored weak var ui: WorkspaceUI?

    var activeTab: Tab? { tabs.first { $0.id == activeTabID } }

    init(root: URL) {
        self.root = root.canonical
        let prefs = SessionManager.shared.workspacePrefs(for: self.root.path)
        filterMode = prefs?.filterMode ?? .markdown
        expanded = Set(prefs?.expanded ?? [])
    }

    func start() {
        WorkspaceRegistry.stores.append(self)
        rescan()
        watcher = FileWatcher(path: root.path) { [weak self] events in self?.handle(events) }
        dotTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.dotsVersion += 1 }
        }
        prefsObserver = NotificationCenter.default.addObserver(
            forName: .mdviewPreferencesChanged, object: nil, queue: .main
        ) { [weak self] note in
            let old = note.userInfo?["old"] as? Preferences
            MainActor.assumeIsolated {
                let new = AppSettings.shared.prefs
                if old?.respectGitignore != new.respectGitignore || old?.extraIgnoreGlobs != new.extraIgnoreGlobs {
                    self?.rescan()
                }
            }
        }
    }

    func close() {
        watcher?.stop()
        watcher = nil
        dotTimer?.invalidate()
        if let prefsObserver { NotificationCenter.default.removeObserver(prefsObserver) }
        for t in tabs { WebViewPool.shared.discardNow(t.id) }
        WorkspaceRegistry.stores.removeAll { $0 === self }
    }

    func url(for path: String) -> URL {
        path.isEmpty ? root : root.appendingPathComponent(path)
    }

    func relativePath(of url: URL) -> String? {
        let p = url.canonical.path
        if p == root.path { return "" }
        guard p.hasPrefix(root.path + "/") else { return nil }
        return String(p.dropFirst(root.path.count + 1))
    }

    private func persistPrefs() {
        SessionManager.shared.setWorkspacePrefs(
            WorkspacePrefs(filterMode: filterMode, expanded: Array(expanded).sorted()), for: root.path)
    }

    // MARK: Scanning and watching

    func rescan() {
        if isScanning { rescanPending = true; return }
        isScanning = true
        let root = self.root
        let prefs = AppSettings.shared.prefs
        let options = ScanOptions(respectGitignore: prefs.respectGitignore, extraGlobs: prefs.ignoreGlobList)
        let started = Date()
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                TreeScanner.scan(root: root, options: options)
            }.value
            self.isScanning = false
            debugLog("scanned \(result.fileCount) files in \(Int(result.duration * 1000)) ms")
            self.scan = result
            if self.markdownPaths != result.markdownPaths { self.markdownPaths = result.markdownPaths }
            self.rebuildTree()
            debugLog("tree ready in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
            if self.rescanPending {
                self.rescanPending = false
                self.rescan()
            }
        }
    }

    private func rebuildTree() {
        guard let scan else { return }
        var builder = DisplayTreeBuilder(previous: nodes, mode: filterMode, query: filterQuery)
        let oldSignature = signature(displayRoot)
        let newRoot = builder.build(scan.root)
        nodes = builder.nodes
        let newSignature = signature(newRoot)
        displayRoot = newRoot
        if oldSignature.structure != newSignature.structure {
            treeVersion += 1
        } else if oldSignature.mtimes != newSignature.mtimes {
            dotsVersion += 1
        }
    }

    private func signature(_ root: FileNode?) -> (structure: [ObjectIdentifier], mtimes: [Double]) {
        var s: [ObjectIdentifier] = [], m: [Double] = []
        func walk(_ n: FileNode) {
            s.append(ObjectIdentifier(n))
            m.append(n.mtime)
            n.children.forEach(walk)
            s.append(ObjectIdentifier(FileNode.self))  // marks the end of a child list
        }
        if let root { walk(root) }
        return (s, m)
    }

    private func handle(_ events: [FileEvent]) {
        let rootPath = root.path
        var relevant = false
        var changed = Set<String>()
        for e in events {
            let p = e.path.hasSuffix("/") ? String(e.path.dropLast()) : e.path
            if p == rootPath || !p.hasPrefix(rootPath + "/") { relevant = true; continue }
            let rel = String(p.dropFirst(rootPath.count + 1))
            let parts = rel.split(separator: "/")
            if parts.contains(where: { $0 == "node_modules" }) { continue }
            if parts.first == ".git" {
                if rel == ".git/info/exclude" { relevant = true }
                continue
            }
            relevant = true
            changed.insert(rel)
        }
        guard relevant else { return }
        rescan()
        for tab in tabs {
            let touched = changed.contains(tab.path) || changed.contains { tab.path.hasPrefix($0 + "/") }
            if touched || tab.isDeleted || events.contains(where: \.isStructural) {
                refreshFromDisk(tab)
            }
        }
    }

    // MARK: Opening and closing tabs

    @discardableResult
    func open(_ path: String, pinned: Bool, mode: Mode? = nil, state: TabState? = nil, activate: Bool = true) -> Tab {
        if let existing = tabs.first(where: { $0.path == path }) {
            if pinned { existing.isPinned = true }
            if activate { self.activate(existing) }
            return existing
        }
        let m = mode ?? AppSettings.shared.prefs.defaultMode
        if !pinned, let preview = tabs.first(where: { !$0.isPinned && !$0.isDirty }) {
            preview.path = path
            preview.mode = m
            preview.state = state ?? TabState()
            preview.back = []
            preview.forward = []
            preview.allowRemoteImages = false
            load(preview)
            if let c = WebViewPool.shared.live(preview.id) {
                if c.remoteImages {
                    c.load(remoteImages: false)
                    sendOpenSequence(preview, c)
                } else {
                    showDocument(preview, in: c)
                }
            }
            if activate { self.activate(preview) }
            SessionManager.shared.scheduleSave()
            return preview
        }
        let tab = Tab(path: path, pinned: pinned, mode: m)
        if let state { tab.state = state }
        load(tab)
        if let active = activeTab, let i = tabs.firstIndex(where: { $0 === active }) {
            tabs.insert(tab, at: i + 1)
        } else {
            tabs.append(tab)
        }
        if activate { self.activate(tab) }
        SessionManager.shared.scheduleSave()
        return tab
    }

    func activate(_ tab: Tab) {
        activeTabID = tab.id
        _ = WebViewPool.shared.controller(for: tab, store: self)
    }

    /// Removes a tab without asking about unsaved changes.
    func removeTab(_ tab: Tab) {
        guard let i = tabs.firstIndex(where: { $0 === tab }) else { return }
        tab.autosaveWork?.cancel()
        let wasActive = tab.id == activeTabID
        tabs.remove(at: i)
        if wasActive {
            if tabs.isEmpty { activeTabID = nil } else { activate(tabs[min(i, tabs.count - 1)]) }
        }
        let tabID = tab.id
        Task {
            if let c = WebViewPool.shared.live(tabID), c.isReady,
               let s = await c.send(.getState)?.decode(TabState.self) {
                tab.state = s
            }
            WebViewPool.shared.discardNow(tabID)
            self.closedTabs.append(tab.snapshot)
            if self.closedTabs.count > 30 { self.closedTabs.removeFirst() }
        }
        SessionManager.shared.scheduleSave()
    }

    var canReopenClosedTab: Bool { !closedTabs.isEmpty }

    func reopenClosedTab() {
        while let snap = closedTabs.popLast() {
            guard FileManager.default.fileExists(atPath: url(for: snap.path).path) else { continue }
            open(snap.path, pinned: true, mode: snap.mode, state: snap.state)
            return
        }
        NSSound.beep()
    }

    func selectTab(offset: Int) {
        guard !tabs.isEmpty else { return }
        let i = tabs.firstIndex { $0.id == activeTabID } ?? 0
        activate(tabs[(i + offset + tabs.count) % tabs.count])
    }

    func selectTab(number: Int) {
        guard !tabs.isEmpty else { return }
        // ⌘9 always selects the last tab, as in browsers.
        let i = number == 9 ? tabs.count - 1 : number - 1
        guard tabs.indices.contains(i) else { return }
        activate(tabs[i])
    }

    func moveTab(_ tab: Tab, before target: Tab) {
        guard tab !== target, let from = tabs.firstIndex(where: { $0 === tab }),
              let to = tabs.firstIndex(where: { $0 === target }) else { return }
        tabs.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        SessionManager.shared.scheduleSave()
    }

    func pin(_ tab: Tab) {
        if !tab.isPinned { tab.isPinned = true; SessionManager.shared.scheduleSave() }
    }

    // MARK: Documents

    private func load(_ tab: Tab) {
        tab.editedText = nil
        tab.isDirty = false
        tab.theirs = nil
        switch FileService.read(url(for: tab.path)) {
        case .success(let f):
            tab.disk = f
            tab.isDeleted = false
            tab.banner = f.isUTF8 ? nil : Self.readonlyBanner
        case .failure:
            tab.disk = .empty()
            tab.isDeleted = true
            tab.banner = Self.deletedBanner
        }
    }

    static let deletedBanner = Banner(
        kind: .deleted, message: "This file was deleted on disk.",
        actions: [BannerAction(id: "close", label: "Close"), BannerAction(id: "saveAs", label: "Save As…", primary: true)])
    static let readonlyBanner = Banner(
        kind: .readonly, message: "This file is not valid UTF-8. It is shown read-only.", actions: [])

    private func conflictBanner(theirs: String) -> Banner {
        Banner(kind: .conflict, message: "This file changed on disk and you have unsaved edits.",
               actions: [BannerAction(id: "keepMine", label: "Keep Mine"),
                         BannerAction(id: "loadTheirs", label: "Load Theirs"),
                         BannerAction(id: "compare", label: "Compare", primary: true)],
               theirs: theirs)
    }

    private func payload(_ tab: Tab, reason: String) -> RenderPayload {
        RenderPayload(path: tab.path, text: tab.currentText, editable: tab.isEditable,
                      reason: reason, allowRemoteImages: tab.allowRemoteImages)
    }

    /// Wires a freshly created controller to its tab and loads the document.
    func attach(_ c: DocumentController, to tab: Tab) {
        c.onMessage = { [weak self, weak tab, weak c] msg in
            guard let self, let tab, let c else { return }
            self.handle(msg, from: tab, controller: c)
        }
        c.onProcessTerminated = { [weak self, weak tab, weak c] in
            guard let self, let tab, let c else { return }
            c.load(remoteImages: tab.allowRemoteImages)
            self.sendOpenSequence(tab, c)
        }
        c.load(remoteImages: tab.allowRemoteImages)
        sendOpenSequence(tab, c)
    }

    func sendOpenSequence(_ tab: Tab, _ c: DocumentController) {
        c.enqueue(.setSettings(AppSettings.shared.prefs.core))
        showDocument(tab, in: c)
    }

    private func showDocument(_ tab: Tab, in c: DocumentController) {
        c.enqueue(.setMode(tab.mode))
        c.enqueue(.render(payload(tab, reason: "open")))
        c.enqueue(.restoreState(tab.state))
        c.enqueue(.banner(tab.banner))
    }

    private func setBanner(_ banner: Banner?, on tab: Tab) {
        guard tab.banner != banner else { return }
        tab.banner = banner
        WebViewPool.shared.live(tab.id)?.enqueue(.banner(banner))
    }

    func refreshFromDisk(_ tab: Tab) {
        let live = WebViewPool.shared.live(tab.id)
        switch FileService.read(url(for: tab.path)) {
        case .failure(.missing):
            if !tab.isDeleted {
                tab.isDeleted = true
                setBanner(Self.deletedBanner, on: tab)
            }
        case .failure:
            return
        case .success(let f):
            if tab.isDeleted {
                tab.isDeleted = false
                setBanner(f.isUTF8 ? nil : Self.readonlyBanner, on: tab)
            }
            if f.text == tab.disk.text && f.isUTF8 == tab.disk.isUTF8 {
                tab.disk = f
                return
            }
            if tab.isDirty {
                if tab.editedText == f.text {
                    tab.disk = f
                    tab.isDirty = false
                    tab.theirs = nil
                    setBanner(nil, on: tab)
                    live?.enqueue(.markSaved)
                } else if tab.theirs?.text != f.text {
                    tab.theirs = f
                    setBanner(conflictBanner(theirs: f.text), on: tab)
                }
                return
            }
            tab.disk = f
            tab.editedText = nil
            setBanner(f.isUTF8 ? nil : Self.readonlyBanner, on: tab)
            live?.enqueue(.render(payload(tab, reason: "reload")))
        }
    }

    // MARK: Messages from the core

    private func handle(_ msg: CoreToHost, from tab: Tab, controller c: DocumentController) {
        switch msg {
        case .ready, .rendered, .log:
            break
        case .renderError(let message, let line, _):
            debugLog("render error \(tab.path):\(line ?? 0) \(message)")
        case .diagramsRendered(let count, let errors):
            debugLog("\(tab.path): \(count) diagrams, \(errors.count) errors")
        case .linkClicked(let href, let resolvedPath, let anchor, let external, let modifier):
            followLink(href: href, resolvedPath: resolvedPath, anchor: anchor, external: external,
                       modifier: modifier, from: tab)
        case .hoverLink:
            break // the core shows its own status line
        case .scrollChanged(let y, let line):
            tab.state.scrollY = y
            tab.state.topLine = line
            SessionManager.shared.scheduleSave()
        case .diagramStateChanged(let key, let state):
            var d = tab.state.diagrams ?? [:]
            d[key] = state
            tab.state.diagrams = d
            SessionManager.shared.scheduleSave()
        case .editorStateChanged(let cursor, let line):
            tab.state.editorCursor = cursor
            tab.state.editorScrollLine = line
            SessionManager.shared.scheduleSave()
        case .edited(let text):
            let normalized = FileService.normalize(text)
            tab.editedText = normalized
            let dirty = normalized != tab.disk.text
            if tab.isDirty != dirty { tab.isDirty = dirty }
            if dirty { pin(tab) }
            scheduleIdleAutosave(tab)
        case .copy(let text, let png, let svg, let asPng, let width, let height):
            Clipboard.write(text: text, pngBase64: png, svg: svg, asPng: asPng, width: width, height: height)
        case .export(let format, let svg, let name, let width, let height):
            ui?.export(svg: svg, format: format, suggestedName: name, width: width, height: height)
        case .requestMode(let mode, let line):
            setMode(mode, for: tab)
            if let line { c.enqueue(.scrollToLine(line)) }
        case .bannerAction(let id):
            handleBannerAction(id, tab: tab, controller: c)
        case .requestFullScreen(let on):
            ui?.setFullScreen(on)
        case .save:
            Task { _ = await save(tab) }
        }
    }

    private func handleBannerAction(_ id: String, tab: Tab, controller c: DocumentController) {
        switch id {
        case "keepMine":
            if let theirs = tab.theirs { tab.disk = theirs }
            tab.theirs = nil
            tab.isDirty = tab.currentText != tab.disk.text
            setBanner(nil, on: tab)
        case "loadTheirs":
            if let theirs = tab.theirs { tab.disk = theirs } else { load(tab) }
            tab.theirs = nil
            tab.editedText = nil
            tab.isDirty = false
            setBanner(tab.disk.isUTF8 ? nil : Self.readonlyBanner, on: tab)
            c.enqueue(.render(payload(tab, reason: "reload")))
            c.enqueue(.markSaved)
        case "compare":
            break // handled by the core
        case "close":
            ui?.requestClose(tab)
        case "saveAs":
            ui?.saveAs(tab)
        case "loadRemoteImages":
            tab.allowRemoteImages = true
            if tab.banner?.kind == .remoteImages { tab.banner = nil }
            Task {
                if c.isReady, let s = await c.send(.getState)?.decode(TabState.self) { tab.state = s }
                c.load(remoteImages: true)
                self.sendOpenSequence(tab, c)
            }
        default:
            setBanner(nil, on: tab)
        }
    }

    // MARK: Links and history

    private func followLink(href: String, resolvedPath: String?, anchor: String?, external: Bool,
                            modifier: Bool, from tab: Tab) {
        if href.hasPrefix("#") {
            // The core already scrolled; just record where we came from.
            pushAnchorHistory(tab)
            return
        }
        if let u = URL(string: href), let scheme = u.scheme?.lowercased(), scheme != "mdview", scheme != "file" {
            if ["http", "https", "mailto"].contains(scheme) { NSWorkspace.shared.open(u) }
            return
        }
        if external, let u = URL(string: href) { NSWorkspace.shared.open(u); return }

        var pathPart = href
        var fragment = anchor
        if let hash = pathPart.firstIndex(of: "#") {
            if fragment == nil { fragment = String(pathPart[pathPart.index(after: hash)...]) }
            pathPart = String(pathPart[..<hash])
        }
        if let q = pathPart.firstIndex(of: "?") { pathPart = String(pathPart[..<q]) }
        // The core reports the raw (unresolved) path part; resolution happens here.
        _ = resolvedPath
        fragment = fragment.flatMap { $0.isEmpty ? nil : ($0.removingPercentEncoding ?? $0) }

        let target: URL
        if pathPart.hasPrefix("file://"), let u = URL(string: pathPart) {
            target = u.standardizedFileURL
        } else if pathPart.hasPrefix("mdview://ws/") {
            let rel = String(pathPart.dropFirst("mdview://ws/".count))
            target = url(for: rel.removingPercentEncoding ?? rel).standardizedFileURL
        } else {
            let decoded = pathPart.removingPercentEncoding ?? pathPart
            if decoded.hasPrefix("/") {
                target = root.appendingPathComponent(String(decoded.dropFirst())).standardizedFileURL
            } else {
                target = url(for: tab.path).deletingLastPathComponent().appendingPathComponent(decoded).standardizedFileURL
            }
        }

        let exists = FileManager.default.fileExists(atPath: target.path)
        let isMarkdown = MarkdownFiles.isMarkdown(target.lastPathComponent)
        guard let rel = relativePath(of: target) else {
            if isMarkdown && exists { AppDelegate.shared?.open(urls: [target]) }
            else if exists { NSWorkspace.shared.open(target) }
            else { NSSound.beep() }
            return
        }
        guard isMarkdown else {
            if exists { NSWorkspace.shared.open(target) } else { NSSound.beep() }
            return
        }
        if rel == tab.path {
            if let fragment { navigateToAnchor(fragment, in: tab) }
            return
        }
        let destination: Tab
        if modifier {
            destination = open(rel, pinned: true)
        } else if let existing = tabs.first(where: { $0.path == rel }) {
            destination = existing
            activate(existing)
        } else if !tab.isPinned && !tab.isDirty {
            navigate(tab, to: rel, anchor: fragment)
            return
        } else {
            destination = open(rel, pinned: false)
        }
        if let fragment {
            WebViewPool.shared.controller(for: destination, store: self).enqueue(.scrollToAnchor(fragment))
        }
    }

    private func currentState(_ tab: Tab) async -> TabState {
        if let c = WebViewPool.shared.live(tab.id), c.isReady,
           let s = await c.send(.getState)?.decode(TabState.self) {
            tab.state = s
        }
        return tab.state
    }

    private func navigate(_ tab: Tab, to path: String, anchor: String?) {
        Task {
            let state = await currentState(tab)
            tab.back.append(HistoryEntry(path: tab.path, state: state))
            tab.forward.removeAll()
            tab.path = path
            tab.state = TabState()
            load(tab)
            let c = WebViewPool.shared.controller(for: tab, store: self)
            showDocument(tab, in: c)
            if let anchor { c.enqueue(.scrollToAnchor(anchor)) }
            SessionManager.shared.scheduleSave()
        }
    }

    /// Uses the last reported scroll position: the core may already be scrolling to the target.
    private func pushAnchorHistory(_ tab: Tab) {
        tab.back.append(HistoryEntry(path: tab.path, state: tab.state))
        tab.forward.removeAll()
    }

    private func navigateToAnchor(_ anchor: String, in tab: Tab) {
        pushAnchorHistory(tab)
        WebViewPool.shared.controller(for: tab, store: self).enqueue(.scrollToAnchor(anchor))
    }

    func goBack() { traverseHistory(back: true) }
    func goForward() { traverseHistory(back: false) }

    var canGoBack: Bool { !(activeTab?.back.isEmpty ?? true) }
    var canGoForward: Bool { !(activeTab?.forward.isEmpty ?? true) }

    private func traverseHistory(back: Bool) {
        guard let tab = activeTab else { return }
        guard let entry = back ? tab.back.last : tab.forward.last else { return NSSound.beep() }
        if entry.path != tab.path && tab.isDirty { return NSSound.beep() }
        Task {
            let state = await currentState(tab)
            let current = HistoryEntry(path: tab.path, state: state)
            if back { tab.back.removeLast(); tab.forward.append(current) }
            else { tab.forward.removeLast(); tab.back.append(current) }
            let c = WebViewPool.shared.controller(for: tab, store: self)
            tab.state = entry.state
            if entry.path != tab.path {
                tab.path = entry.path
                load(tab)
                showDocument(tab, in: c)
            } else {
                c.enqueue(.restoreState(entry.state))
            }
            SessionManager.shared.scheduleSave()
        }
    }

    // MARK: Modes and commands

    func setMode(_ mode: Mode, for tab: Tab) {
        guard tab.mode != mode else { return }
        tab.mode = mode
        WebViewPool.shared.live(tab.id)?.enqueue(.setMode(mode))
        SessionManager.shared.scheduleSave()
    }

    func toggleEditMode() {
        guard let t = activeTab else { return }
        setMode(t.mode == .preview ? .edit : .preview, for: t)
    }

    func cycleMode() {
        guard let t = activeTab else { return }
        let next: Mode = switch t.mode { case .preview: .split; case .split: .edit; case .edit: .preview }
        setMode(next, for: t)
    }

    func send(_ command: CoreCommand, arg: JSONValue? = nil) {
        guard let t = activeTab else { return }
        WebViewPool.shared.controller(for: t, store: self).enqueue(.command(command, arg))
    }

    func expandFocusedDiagramOrPin() {
        guard let t = activeTab else { return }
        pin(t)
        if ui?.isWebViewFocused == true { send(.expandFocusedDiagram) }
    }

    func revealActiveFile() {
        guard activeTab != nil else { return }
        if !filterQuery.isEmpty { filterQuery = "" }
        sidebarVisible = true
        revealRequest += 1
    }

    // MARK: Saving

    /// ⌘S: asks the editor for its text, then writes atomically.
    func save(_ tab: Tab) async -> Bool {
        guard tab.isEditable else { NSSound.beep(); return false }
        var text = tab.currentText
        if let c = WebViewPool.shared.live(tab.id), c.isReady, let t = await c.send(.getText)?["text"]?.string {
            text = t
        }
        return write(tab, text: text, to: url(for: tab.path))
    }

    /// Synchronous save from the last text the editor reported (used on quit).
    @discardableResult
    func saveSynchronously(_ tab: Tab) -> Bool {
        guard tab.isEditable else { return false }
        return write(tab, text: tab.currentText, to: url(for: tab.path))
    }

    @discardableResult
    func write(_ tab: Tab, text: String, to target: URL) -> Bool {
        do {
            let saved = try FileService.write(text, to: target, like: tab.disk)
            if let rel = relativePath(of: target), rel != tab.path { tab.path = rel }
            tab.disk = saved
            tab.editedText = nil
            tab.isDirty = false
            tab.isDeleted = false
            tab.theirs = nil
            tab.autosaveWork?.cancel()
            if let kind = tab.banner?.kind, kind == .conflict || kind == .deleted { setBanner(nil, on: tab) }
            WebViewPool.shared.live(tab.id)?.enqueue(.markSaved)
            SessionManager.shared.scheduleSave()
            return true
        } catch {
            ui?.showError(error)
            return false
        }
    }

    var dirtyTabs: [Tab] { tabs.filter(\.isDirty) }

    func autosaveAll() {
        guard AppSettings.shared.prefs.autosave == .onFocusLoss else { return }
        for t in dirtyTabs where t.isEditable && !t.isDeleted { Task { _ = await save(t) } }
    }

    private func scheduleIdleAutosave(_ tab: Tab) {
        guard AppSettings.shared.prefs.autosave == .afterIdle, tab.isEditable else { return }
        tab.autosaveWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak tab] in
            MainActor.assumeIsolated {
                guard let self, let tab, tab.isDirty, !tab.isDeleted else { return }
                Task { _ = await self.save(tab) }
            }
        }
        tab.autosaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    // MARK: File operations (tree context menu)

    /// Keeps open tabs pointing at files after a rename or move inside the workspace.
    func didMove(from old: String, to new: String) {
        for t in tabs {
            if t.path == old { t.path = new }
            else if t.path.hasPrefix(old + "/") { t.path = new + t.path.dropFirst(old.count) }
        }
        if expanded.contains(old) { expanded.remove(old); expanded.insert(new) }
        SessionManager.shared.scheduleSave()
    }

    // MARK: Session

    var snapshot: WorkspaceSession {
        WorkspaceSession(
            root: root.path, frame: nil,
            tabs: tabs.map(\.snapshot),
            activeIndex: tabs.firstIndex { $0.id == activeTabID },
            sidebarVisible: sidebarVisible)
    }

    func restore(_ session: WorkspaceSession) {
        for snap in session.tabs where FileManager.default.fileExists(atPath: url(for: snap.path).path) {
            _ = open(snap.path, pinned: snap.pinned, mode: snap.mode, state: snap.state, activate: false)
        }
        // Restored tabs keep their saved order.
        let order = session.tabs.map(\.path)
        tabs.sort { (order.firstIndex(of: $0.path) ?? 0) < (order.firstIndex(of: $1.path) ?? 0) }
        sidebarVisible = session.sidebarVisible
        if let i = session.activeIndex, i < session.tabs.count,
           let t = tabs.first(where: { $0.path == session.tabs[i].path }) {
            activate(t)
        } else if let first = tabs.first {
            activate(first)
        }
    }
}
