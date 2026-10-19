import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Re-runs `body` whenever the observable state it reads changes, until it returns false.
@MainActor
func observeContinuously(_ body: @escaping @MainActor () -> Bool) {
    let keepGoing = withObservationTracking { body() } onChange: {
        Task { @MainActor in observeContinuously(body) }
    }
    _ = keepGoing
}

private extension NSToolbarItem.Identifier {
    static let mode = NSToolbarItem.Identifier("mdview.mode")
    static let width = NSToolbarItem.Identifier("mdview.width")
}

@MainActor
final class WorkspaceWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate, NSMenuItemValidation, WorkspaceUI {
    let store: WorkspaceStore
    private let splitController = NSSplitViewController()
    private let sidebarItem: NSSplitViewItem
    private var modeGroup: NSToolbarItemGroup?
    private var widthItem: NSMenuToolbarItem?
    private var collapseObservation: NSKeyValueObservation?
    private var closeConfirmed = false
    private var isClosed = false

    init(store: WorkspaceStore) {
        self.store = store
        let sidebarHost = NSHostingController(rootView: SidebarView(store: store))
        sidebarHost.sizingOptions = []
        sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebarHost)
        sidebarItem.minimumThickness = 180
        sidebarItem.maximumThickness = 400
        sidebarItem.canCollapse = true
        sidebarItem.holdingPriority = .init(260)
        let contentHost = NSHostingController(rootView: DocumentPane(store: store))
        contentHost.sizingOptions = []
        let contentItem = NSSplitViewItem(viewController: contentHost)
        contentItem.minimumThickness = 320
        splitController.addSplitViewItem(sidebarItem)
        splitController.addSplitViewItem(contentItem)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.contentViewController = splitController
        window.setContentSize(NSSize(width: 1240, height: 820))
        window.minSize = NSSize(width: 560, height: 360)
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.title = store.name
        window.representedURL = store.root
        window.toolbarStyle = .unified
        window.titlebarSeparatorStyle = .automatic
        window.collectionBehavior.insert(.fullScreenPrimary)
        super.init(window: window)
        window.delegate = self

        let toolbar = NSToolbar(identifier: "MDViewWorkspaceToolbar")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar

        store.ui = self
        splitController.splitView.setPosition(240, ofDividerAt: 0)
        collapseObservation = sidebarItem.observe(\.isCollapsed, options: [.new]) { [weak self] item, _ in
            let collapsed = item.isCollapsed
            MainActor.assumeIsolated {
                guard let self, self.store.sidebarVisible == collapsed else { return }
                self.store.sidebarVisible = !collapsed
                SessionManager.shared.scheduleSave()
            }
        }
        startObserving()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func startObserving() {
        observeContinuously { [weak self] in
            guard let self, !self.isClosed else { return false }
            let tab = self.store.activeTab
            let mode = tab?.mode
            let path = tab?.path
            let dirty = tab?.isDirty ?? false
            let width = AppSettings.shared.prefs.core.width
            let sidebarVisible = self.store.sidebarVisible
            self.window?.subtitle = path ?? ""
            self.window?.representedURL = path.map { self.store.url(for: $0) } ?? self.store.root
            self.window?.isDocumentEdited = dirty || self.store.tabs.contains(where: \.isDirty)
            if let group = self.modeGroup {
                group.selectedIndex = mode.flatMap { Mode.allCases.firstIndex(of: $0) } ?? -1
                group.isEnabled = tab != nil
            }
            self.widthItem?.title = width.label
            if self.sidebarItem.isCollapsed == sidebarVisible {
                self.sidebarItem.animator().isCollapsed = !sidebarVisible
            }
            return true
        }
    }

    // MARK: Toolbar

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace, .mode, .width]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        switch id {
        case .mode:
            let group = NSToolbarItemGroup(
                itemIdentifier: id, titles: Mode.allCases.map(\.label), selectionMode: .selectOne,
                labels: Mode.allCases.map(\.label), target: self, action: #selector(modeSegmentChanged(_:)))
            group.label = "Mode"
            group.toolTip = "Preview, Split or Edit (⌘E toggles, ⌘⇧P cycles)"
            group.controlRepresentation = .expanded
            modeGroup = group
            return group
        case .width:
            let menu = NSMenu()
            for (i, w) in WidthMode.allCases.enumerated() {
                let item = NSMenuItem(title: w.label, action: #selector(setContentWidth(_:)), keyEquivalent: "")
                item.tag = i
                menu.addItem(item)
            }
            let item = NSMenuToolbarItem(itemIdentifier: id)
            item.menu = menu
            item.image = NSImage(systemSymbolName: "arrow.left.and.right.text.vertical", accessibilityDescription: "Content width")
                ?? NSImage(systemSymbolName: "arrow.left.and.right", accessibilityDescription: "Content width")
            item.title = AppSettings.shared.prefs.core.width.label
            item.label = "Width"
            item.toolTip = "Content width"
            item.showsIndicator = true
            widthItem = item
            return item
        default:
            return nil
        }
    }

    @objc private func modeSegmentChanged(_ sender: NSToolbarItemGroup) {
        guard let tab = store.activeTab, Mode.allCases.indices.contains(sender.selectedIndex) else { return }
        store.setMode(Mode.allCases[sender.selectedIndex], for: tab)
    }

    // MARK: Menu actions

    @objc func quickOpen(_ sender: Any?) { store.quickOpenVisible.toggle() }
    @objc func saveTab(_ sender: Any?) {
        guard let tab = store.activeTab else { return }
        Task { _ = await store.save(tab) }
    }
    @objc func saveTabAs(_ sender: Any?) {
        guard let tab = store.activeTab else { return }
        saveAs(tab)
    }
    @objc func closeTab(_ sender: Any?) {
        if store.quickOpenVisible { store.quickOpenVisible = false; return }
        if let tab = store.activeTab { requestClose(tab) } else { window?.performClose(sender) }
    }
    @objc func reopenClosedTab(_ sender: Any?) { store.reopenClosedTab() }
    @objc func closeWorkspaceWindow(_ sender: Any?) { window?.performClose(sender) }

    @objc func findInDocument(_ sender: Any?) { store.send(.find) }
    @objc func findNextInDocument(_ sender: Any?) { store.send(.findNext) }
    @objc func findPreviousInDocument(_ sender: Any?) { store.send(.findPrevious) }
    @objc func replaceInDocument(_ sender: Any?) { store.send(.replace) }
    @objc func formatBold(_ sender: Any?) { store.send(.bold) }
    @objc func formatItalic(_ sender: Any?) { store.send(.italic) }
    @objc func formatLink(_ sender: Any?) { store.send(.link) }

    @objc func setModeFromMenu(_ sender: NSMenuItem) {
        guard let tab = store.activeTab, Mode.allCases.indices.contains(sender.tag) else { return }
        store.setMode(Mode.allCases[sender.tag], for: tab)
    }
    @objc func toggleEditMode(_ sender: Any?) { store.toggleEditMode() }
    @objc func cycleModes(_ sender: Any?) { store.cycleMode() }
    @objc func revealInTree(_ sender: Any?) { store.revealActiveFile() }
    @objc func toggleSidebar(_ sender: Any?) { splitController.toggleSidebar(sender) }
    @objc func setContentWidth(_ sender: NSMenuItem) {
        guard WidthMode.allCases.indices.contains(sender.tag) else { return }
        AppSettings.shared.prefs.core.width = WidthMode.allCases[sender.tag]
    }
    @objc func expandFocusedDiagram(_ sender: Any?) { store.expandFocusedDiagramOrPin() }
    @objc func nextDiagram(_ sender: Any?) { store.send(.nextDiagram) }
    @objc func previousDiagram(_ sender: Any?) { store.send(.previousDiagram) }
    @objc func goBackInTab(_ sender: Any?) { store.goBack() }
    @objc func goForwardInTab(_ sender: Any?) { store.goForward() }
    @objc func nextTab(_ sender: Any?) { store.selectTab(offset: 1) }
    @objc func previousTab(_ sender: Any?) { store.selectTab(offset: -1) }
    @objc func selectTabNumber(_ sender: NSMenuItem) { store.selectTab(number: sender.tag) }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        let tab = store.activeTab
        switch item.action {
        case #selector(saveTab(_:)), #selector(saveTabAs(_:)):
            return tab?.isEditable ?? false
        case #selector(reopenClosedTab(_:)):
            return store.canReopenClosedTab
        case #selector(setModeFromMenu(_:)):
            item.state = tab.map { Mode.allCases.firstIndex(of: $0.mode) == item.tag } == true ? .on : .off
            return tab != nil
        case #selector(setContentWidth(_:)):
            item.state = WidthMode.allCases.firstIndex(of: AppSettings.shared.prefs.core.width) == item.tag ? .on : .off
            return true
        case #selector(goBackInTab(_:)):
            return store.canGoBack
        case #selector(goForwardInTab(_:)):
            return store.canGoForward
        case #selector(nextTab(_:)), #selector(previousTab(_:)):
            return store.tabs.count > 1
        case #selector(selectTabNumber(_:)):
            return item.tag == 9 ? !store.tabs.isEmpty : store.tabs.count >= item.tag
        case #selector(toggleEditMode(_:)), #selector(cycleModes(_:)), #selector(revealInTree(_:)),
             #selector(findInDocument(_:)), #selector(findNextInDocument(_:)), #selector(findPreviousInDocument(_:)),
             #selector(replaceInDocument(_:)), #selector(formatBold(_:)), #selector(formatItalic(_:)),
             #selector(formatLink(_:)), #selector(expandFocusedDiagram(_:)), #selector(nextDiagram(_:)),
             #selector(previousDiagram(_:)):
            return tab != nil
        default:
            return true
        }
    }

    // MARK: WorkspaceUI

    var isWebViewFocused: Bool {
        guard let tab = store.activeTab, let web = WebViewPool.shared.live(tab.id)?.webView,
              let responder = window?.firstResponder as? NSView else { return false }
        return responder === web || responder.isDescendant(of: web)
    }

    func showError(_ error: Error) {
        guard let window else { return }
        NSAlert(error: error).beginSheetModal(for: window)
    }

    func requestClose(_ tab: Tab) {
        guard tab.isDirty, let window else { return store.removeTab(tab) }
        let alert = NSAlert()
        alert.messageText = "Do you want to save the changes you made to “\(tab.title)”?"
        alert.informativeText = "Your changes will be lost if you don’t save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Don’t Save")
        alert.addButton(withTitle: "Cancel")
        alert.buttons[1].keyEquivalent = "d"
        alert.buttons[1].keyEquivalentModifierMask = .command
        alert.beginSheetModal(for: window) { [weak self] response in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch response {
                case .alertFirstButtonReturn:
                    Task {
                        if await self.store.save(tab) { self.store.removeTab(tab) }
                    }
                case .alertSecondButtonReturn:
                    self.store.removeTab(tab)
                default:
                    break
                }
            }
        }
    }

    func saveAs(_ tab: Tab) {
        guard let window else { return }
        let panel = NSSavePanel()
        let url = store.url(for: tab.path)
        panel.directoryURL = url.deletingLastPathComponent()
        panel.nameFieldStringValue = url.lastPathComponent
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        panel.allowsOtherFileTypes = true
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            MainActor.assumeIsolated {
                guard let self, response == .OK, let target = panel.url else { return }
                Task {
                    var text = tab.currentText
                    if let c = WebViewPool.shared.live(tab.id), c.isReady,
                       let t = await c.send(.getText)?["text"]?.string { text = t }
                    if self.store.relativePath(of: target) != nil {
                        self.store.write(tab, text: text, to: target)
                    } else {
                        do {
                            _ = try FileService.write(text, to: target, like: tab.disk)
                            AppDelegate.shared?.open(urls: [target])
                        } catch {
                            self.showError(error)
                        }
                    }
                }
            }
        }
    }

    func export(svg: String, format: String, suggestedName: String, width: Double, height: Double) {
        guard let window else { return }
        let isPNG = format == "png"
        let panel = NSSavePanel()
        let base = (suggestedName as NSString).deletingPathExtension
        panel.nameFieldStringValue = (base.isEmpty ? "diagram" : base) + (isPNG ? ".png" : ".svg")
        panel.allowedContentTypes = [isPNG ? .png : .svg]
        panel.canCreateDirectories = true
        if let tab = store.activeTab { panel.directoryURL = store.url(for: tab.path).deletingLastPathComponent() }
        panel.beginSheetModal(for: window) { [weak self] response in
            MainActor.assumeIsolated {
                guard response == .OK, let url = panel.url else { return }
                Task {
                    do {
                        if isPNG {
                            guard let data = await SVGRasterizer.png(svg: svg, width: width, height: height) else {
                                throw CocoaError(.fileWriteUnknown)
                            }
                            try data.write(to: url, options: .atomic)
                        } else {
                            try Data(svg.utf8).write(to: url, options: .atomic)
                        }
                    } catch {
                        self?.showError(error)
                    }
                }
            }
        }
    }

    func setFullScreen(_ on: Bool) {
        guard let window, window.styleMask.contains(.fullScreen) != on else { return }
        window.toggleFullScreen(nil)
    }

    // MARK: Window delegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        let dirty = store.dirtyTabs
        if closeConfirmed || dirty.isEmpty { return true }
        let alert = NSAlert()
        alert.messageText = dirty.count == 1
            ? "Do you want to save the changes you made to “\(dirty[0].title)”?"
            : "You have \(dirty.count) documents with unsaved changes. Save them before closing?"
        alert.informativeText = "Your changes will be lost if you don’t save them."
        alert.addButton(withTitle: dirty.count == 1 ? "Save" : "Save All")
        alert.addButton(withTitle: "Don’t Save")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: sender) { [weak self] response in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch response {
                case .alertFirstButtonReturn:
                    Task {
                        for t in dirty { guard await self.store.save(t) else { return } }
                        self.closeConfirmed = true
                        self.window?.close()
                    }
                case .alertSecondButtonReturn:
                    self.closeConfirmed = true
                    self.window?.close()
                default:
                    break
                }
            }
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        isClosed = true
        AppDelegate.shared?.workspaceWindowWillClose(self)
        store.close()
    }

    func windowDidResize(_ notification: Notification) { SessionManager.shared.scheduleSave() }
    func windowDidMove(_ notification: Notification) { SessionManager.shared.scheduleSave() }
    func windowDidResignKey(_ notification: Notification) { store.autosaveAll() }

    private var didInitialFocus = false

    /// On first show AppKit focuses the first key view, the sidebar's filter field, so typing,
    /// space and the arrow keys would not reach the document. Start in the document instead,
    /// or in the tree when no file is open.
    func windowDidBecomeKey(_ notification: Notification) {
        guard !didInitialFocus, let window else { return }
        didInitialFocus = true
        DispatchQueue.main.async { [weak self] in
            guard let self, let tab = self.store.activeTab, let web = WebViewPool.shared.live(tab.id)?.webView else {
                if let tree = window.contentView.flatMap(Self.firstOutline) { window.makeFirstResponder(tree) }
                return
            }
            window.makeFirstResponder(web)
        }
    }

    private static func firstOutline(in view: NSView) -> NSOutlineView? {
        if let o = view as? NSOutlineView { return o }
        for v in view.subviews { if let o = firstOutline(in: v) { return o } }
        return nil
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        store.send(.diagramFullScreenChanged, arg: .bool(true))
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        store.send(.diagramFullScreenChanged, arg: .bool(false))
    }

    // MARK: Session

    var session: WorkspaceSession {
        var s = store.snapshot
        if let window { s.frame = NSStringFromRect(window.frame) }
        s.sidebarVisible = !sidebarItem.isCollapsed
        s.sidebarWidth = sidebarItem.isCollapsed ? nil : Double(sidebarItem.viewController.view.frame.width)
        return s
    }

    func apply(_ session: WorkspaceSession) {
        if let f = session.frame, let window {
            let rect = NSRectFromString(f)
            if rect.width > 100, rect.height > 100 { window.setFrame(rect, display: false) }
        }
        store.restore(session)
        sidebarItem.isCollapsed = !session.sidebarVisible
        if let w = session.sidebarWidth, session.sidebarVisible {
            splitController.splitView.setPosition(CGFloat(min(max(w, 180), 400)), ofDividerAt: 0)
        }
    }
}
