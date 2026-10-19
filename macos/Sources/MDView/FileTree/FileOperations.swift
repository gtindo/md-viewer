import AppKit

/// Context-menu file operations. The FSEvents watcher picks up the resulting changes.
@MainActor
struct FileOperations {
    let store: WorkspaceStore

    private func directory(for node: FileNode) -> String {
        node.isDir ? node.path : (node.path as NSString).deletingLastPathComponent
    }

    private func join(_ dir: String, _ name: String) -> String {
        dir.isEmpty ? name : dir + "/" + name
    }

    private func prompt(_ title: String, value: String, button: String, selectStem: Bool = false) -> String? {
        let alert = NSAlert()
        alert.messageText = title
        alert.addButton(withTitle: button)
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(string: value)
        field.frame = NSRect(x: 0, y: 0, width: 280, height: 24)
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        DispatchQueue.main.async {
            if selectStem, let editor = field.currentEditor() {
                let stem = (value as NSString).deletingPathExtension
                editor.selectedRange = NSRange(location: 0, length: (stem as NSString).length)
            }
        }
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.contains("/"), name != ".", name != ".." else {
            if !name.isEmpty { NSSound.beep() }
            return nil
        }
        return name
    }

    private func fail(_ error: Error) {
        store.ui?.showError(error)
    }

    private func uniqueName(in dir: String, base: String) -> String {
        let ext = (base as NSString).pathExtension
        let stem = (base as NSString).deletingPathExtension
        var candidate = base
        var n = 2
        while FileManager.default.fileExists(atPath: store.url(for: join(dir, candidate)).path) {
            candidate = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
            n += 1
        }
        return candidate
    }

    func newFile(in node: FileNode) {
        let dir = directory(for: node)
        guard var name = prompt("New File", value: uniqueName(in: dir, base: "Untitled.md"), button: "Create", selectStem: true)
        else { return }
        if (name as NSString).pathExtension.isEmpty { name += ".md" }
        let rel = join(dir, name)
        let url = store.url(for: rel)
        guard !FileManager.default.fileExists(atPath: url.path) else { return NSSound.beep() }
        do {
            try Data().write(to: url, options: .withoutOverwriting)
            if !dir.isEmpty { store.expanded.insert(dir) }
            if MarkdownFiles.isMarkdown(name) { store.open(rel, pinned: true, mode: .edit) }
            store.rescan()
        } catch { fail(error) }
    }

    func newFolder(in node: FileNode) {
        let dir = directory(for: node)
        guard let name = prompt("New Folder", value: uniqueName(in: dir, base: "New Folder"), button: "Create") else { return }
        do {
            try FileManager.default.createDirectory(at: store.url(for: join(dir, name)), withIntermediateDirectories: false)
            if !dir.isEmpty { store.expanded.insert(dir) }
            store.rescan()
        } catch { fail(error) }
    }

    func rename(_ node: FileNode) {
        guard !node.path.isEmpty,
              let name = prompt("Rename “\(node.name)”", value: node.name, button: "Rename", selectStem: !node.isDir),
              name != node.name else { return }
        let parent = (node.path as NSString).deletingLastPathComponent
        let newRel = join(parent, name)
        do {
            try FileManager.default.moveItem(at: store.url(for: node.path), to: store.url(for: newRel))
            store.didMove(from: node.path, to: newRel)
            store.rescan()
        } catch { fail(error) }
    }

    func duplicate(_ node: FileNode) {
        guard !node.path.isEmpty else { return }
        let parent = (node.path as NSString).deletingLastPathComponent
        let ext = (node.name as NSString).pathExtension
        let stem = (node.name as NSString).deletingPathExtension
        let base = ext.isEmpty || node.isDir ? "\(node.name) copy" : "\(stem) copy.\(ext)"
        let rel = join(parent, uniqueName(in: parent, base: base))
        do {
            try FileManager.default.copyItem(at: store.url(for: node.path), to: store.url(for: rel))
            store.rescan()
        } catch { fail(error) }
    }

    func trash(_ node: FileNode) {
        guard !node.path.isEmpty else { return }
        do {
            try FileManager.default.trashItem(at: store.url(for: node.path), resultingItemURL: nil)
            store.rescan()
        } catch { fail(error) }
    }

    func revealInFinder(_ node: FileNode) {
        NSWorkspace.shared.activateFileViewerSelecting([store.url(for: node.path)])
    }

    func copyPath(_ node: FileNode, relative: Bool) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(relative ? (node.path.isEmpty ? "." : node.path) : store.url(for: node.path).path, forType: .string)
    }

    func openInDefaultApp(_ node: FileNode) {
        NSWorkspace.shared.open(store.url(for: node.path))
    }
}
