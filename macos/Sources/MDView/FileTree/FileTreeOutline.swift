import AppKit
import SwiftUI

/// The workspace file tree: an NSOutlineView in source-list style.
struct FileTreeOutline: NSViewRepresentable {
    let store: WorkspaceStore

    func makeCoordinator() -> FileTreeCoordinator { FileTreeCoordinator(store: store) }

    func makeNSView(context: Context) -> NSScrollView { context.coordinator.scrollView }

    func updateNSView(_ view: NSScrollView, context: Context) {
        // Reading these registers observation, so SwiftUI calls us when they change.
        context.coordinator.update(
            treeVersion: store.treeVersion, dotsVersion: store.dotsVersion,
            activePath: store.activeTab?.path, revealRequest: store.revealRequest,
            query: store.filterQuery)
    }
}

final class TreeOutlineView: NSOutlineView {
    var onActivate: ((_ pin: Bool) -> Void)?

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 36, 76: onActivate?(true)        // Return / Enter
        case 49: onActivate?(false)           // Space
        default: super.keyDown(with: event)
        }
    }
}

@MainActor
final class FileTreeCoordinator: NSObject, NSOutlineViewDataSource, NSOutlineViewDelegate, NSMenuDelegate {
    let store: WorkspaceStore
    let outline = TreeOutlineView()
    let scrollView = NSScrollView()
    private var restoring = false
    private var lastTreeVersion = -1
    private var lastDotsVersion = -1
    private var lastActivePath: String?
    private var lastReveal = 0
    private var lastQuery = ""

    init(store: WorkspaceStore) {
        self.store = store
        super.init()
        let column = NSTableColumn(identifier: .init("name"))
        column.resizingMask = .autoresizingMask
        outline.addTableColumn(column)
        outline.outlineTableColumn = column
        outline.headerView = nil
        outline.style = .sourceList
        outline.rowSizeStyle = .default
        outline.floatsGroupRows = false
        outline.indentationPerLevel = 13
        outline.autoresizesOutlineColumn = true
        outline.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
        outline.allowsMultipleSelection = false
        outline.backgroundColor = .clear
        outline.dataSource = self
        outline.delegate = self
        outline.target = self
        outline.action = #selector(clicked(_:))
        outline.doubleAction = #selector(doubleClicked(_:))
        outline.onActivate = { [weak self] pin in self?.activateSelection(pin: pin) }
        let menu = NSMenu()
        menu.delegate = self
        outline.menu = menu

        scrollView.documentView = outline
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
    }

    private var rootNode: FileNode? { store.displayRoot }

    func update(treeVersion: Int, dotsVersion: Int, activePath: String?, revealRequest: Int, query: String) {
        if treeVersion != lastTreeVersion || query != lastQuery {
            lastTreeVersion = treeVersion
            lastQuery = query
            lastDotsVersion = dotsVersion
            reload()
        } else if dotsVersion != lastDotsVersion {
            lastDotsVersion = dotsVersion
            reloadVisibleRows()
        }
        if revealRequest != lastReveal {
            lastReveal = revealRequest
            lastActivePath = activePath
            selectActive(reveal: true)
        } else if activePath != lastActivePath {
            lastActivePath = activePath
            selectActive(reveal: false)
        }
    }

    private func reload() {
        let origin = scrollView.contentView.bounds.origin
        restoring = true
        outline.reloadData()
        if !store.filterQuery.isEmpty {
            outline.expandItem(nil, expandChildren: true)
        } else if let root = rootNode {
            restoreExpansion(root.children)
        }
        restoring = false
        selectActive(reveal: false)
        scrollView.contentView.scroll(to: origin)
        scrollView.reflectScrolledClipView(scrollView.contentView)
    }

    private func restoreExpansion(_ nodes: [FileNode]) {
        for n in nodes where n.isDir && store.expanded.contains(n.path) {
            outline.expandItem(n)
            restoreExpansion(n.children)
        }
    }

    private func reloadVisibleRows() {
        let rows = outline.rows(in: outline.visibleRect)
        guard rows.length > 0 else { return }
        for row in rows.location..<(rows.location + rows.length) {
            if let cell = outline.view(atColumn: 0, row: row, makeIfNecessary: false) as? FileCellView,
               let node = outline.item(atRow: row) as? FileNode {
                cell.configure(node)
            }
        }
    }

    private func node(atPath path: String) -> (node: FileNode, ancestors: [FileNode])? {
        guard var current = rootNode else { return nil }
        var ancestors: [FileNode] = []
        var prefix = ""
        for comp in path.split(separator: "/") {
            prefix = prefix.isEmpty ? String(comp) : prefix + "/" + comp
            guard let next = current.children.first(where: { $0.path == prefix }) else { return nil }
            if next.path != path { ancestors.append(next) }
            current = next
        }
        return (current, ancestors)
    }

    private func selectActive(reveal: Bool) {
        guard let path = store.activeTab?.path, let found = node(atPath: path) else {
            if !reveal { outline.deselectAll(nil) }
            return
        }
        if reveal { found.ancestors.forEach { outline.expandItem($0) } }
        let row = outline.row(forItem: found.node)
        if row >= 0 {
            outline.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            if reveal {
                outline.scrollRowToVisible(row)
                outline.window?.makeFirstResponder(outline)
            }
        } else {
            outline.deselectAll(nil)
        }
    }

    // MARK: Actions

    @objc private func clicked(_ sender: Any?) {
        let row = outline.clickedRow
        guard row >= 0, let node = outline.item(atRow: row) as? FileNode else { return }
        if node.isDir {
            if let event = NSApp.currentEvent {
                let p = outline.convert(event.locationInWindow, from: nil)
                if outline.frameOfOutlineCell(atRow: row).insetBy(dx: -4, dy: 0).contains(p) { return }
            }
            if outline.isItemExpanded(node) { outline.collapseItem(node) } else { outline.expandItem(node) }
        } else if node.isMarkdown {
            store.open(node.path, pinned: false)
        }
    }

    @objc private func doubleClicked(_ sender: Any?) {
        let row = outline.clickedRow
        guard row >= 0, let node = outline.item(atRow: row) as? FileNode, !node.isDir else { return }
        if node.isMarkdown {
            store.open(node.path, pinned: true)
        } else {
            NSWorkspace.shared.open(store.url(for: node.path))
        }
    }

    private func activateSelection(pin: Bool) {
        let row = outline.selectedRow
        guard row >= 0, let node = outline.item(atRow: row) as? FileNode else { return }
        if node.isDir {
            if outline.isItemExpanded(node) { outline.collapseItem(node) } else { outline.expandItem(node) }
        } else if node.isMarkdown {
            store.open(node.path, pinned: pin)
            if pin, let tab = store.activeTab, let c = WebViewPool.shared.live(tab.id) { outline.window?.makeFirstResponder(c.webView) }
        } else if pin {
            NSWorkspace.shared.open(store.url(for: node.path))
        }
    }

    // MARK: Data source

    func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int {
        ((item as? FileNode) ?? rootNode)?.children.count ?? 0
    }

    func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any {
        ((item as? FileNode) ?? rootNode)!.children[index]
    }

    func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool {
        guard let n = item as? FileNode else { return false }
        return n.isDir && !n.children.isEmpty
    }

    func outlineView(_ outlineView: NSOutlineView, viewFor tableColumn: NSTableColumn?, item: Any) -> NSView? {
        guard let node = item as? FileNode else { return nil }
        let cell = (outlineView.makeView(withIdentifier: FileCellView.identifier, owner: nil) as? FileCellView) ?? FileCellView()
        cell.configure(node)
        return cell
    }

    func outlineViewItemDidExpand(_ notification: Notification) {
        guard !restoring, store.filterQuery.isEmpty,
              let n = notification.userInfo?["NSObject"] as? FileNode else { return }
        store.expanded.insert(n.path)
    }

    func outlineViewItemDidCollapse(_ notification: Notification) {
        guard !restoring, store.filterQuery.isEmpty,
              let n = notification.userInfo?["NSObject"] as? FileNode else { return }
        store.expanded.remove(n.path)
    }

    // MARK: Context menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let row = outline.clickedRow
        let node = row >= 0 ? outline.item(atRow: row) as? FileNode : nil
        let target = node ?? rootNode
        guard let target else { return }
        func add(_ title: String, _ action: @escaping @MainActor (FileNode) -> Void) {
            let item = NSMenuItem(title: title, action: #selector(menuAction(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = MenuAction(node: target, run: action)
            menu.addItem(item)
        }
        let ops = FileOperations(store: store)
        add("New File…") { ops.newFile(in: $0) }
        add("New Folder…") { ops.newFolder(in: $0) }
        if node != nil {
            menu.addItem(.separator())
            add("Rename…") { ops.rename($0) }
            add("Duplicate") { ops.duplicate($0) }
            add("Move to Trash") { ops.trash($0) }
        }
        menu.addItem(.separator())
        add("Reveal in Finder") { ops.revealInFinder($0) }
        add("Copy Path") { ops.copyPath($0, relative: false) }
        add("Copy Relative Path") { ops.copyPath($0, relative: true) }
        if node != nil, node?.isDir == false {
            add("Open in Default App") { ops.openInDefaultApp($0) }
        }
    }

    @objc private func menuAction(_ sender: NSMenuItem) {
        guard let a = sender.representedObject as? MenuAction else { return }
        a.run(a.node)
    }
}

private final class MenuAction: NSObject {
    let node: FileNode
    let run: @MainActor (FileNode) -> Void
    init(node: FileNode, run: @escaping @MainActor (FileNode) -> Void) {
        self.node = node
        self.run = run
    }
}

final class FileCellView: NSTableCellView {
    static let identifier = NSUserInterfaceItemIdentifier("FileCell")
    private let icon = NSImageView()
    private let label = NSTextField(labelWithString: "")
    private let dot = NSView()

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        imageView = icon
        textField = label
        label.lineBreakMode = .byTruncatingMiddle
        label.cell?.truncatesLastVisibleLine = true
        icon.imageScaling = .scaleProportionallyDown
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3
        dot.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
        dot.toolTip = "Modified in the last 5 minutes"
        for v in [icon, label, dot] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 2),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 16),
            icon.heightAnchor.constraint(equalToConstant: 16),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 5),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            dot.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 4),
            dot.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            dot.centerYAnchor.constraint(equalTo: centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 6),
            dot.heightAnchor.constraint(equalToConstant: 6),
        ])
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        dot.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
    }

    @MainActor
    func configure(_ node: FileNode) {
        label.stringValue = node.name
        let symbol = node.isDir ? "folder" : (node.isMarkdown ? "doc.text" : "doc")
        icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        icon.contentTintColor = node.isDir ? .controlAccentColor : .secondaryLabelColor
        dot.isHidden = !node.isRecentlyChanged
        toolTip = node.path
    }
}
