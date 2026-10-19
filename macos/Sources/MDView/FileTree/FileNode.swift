import Foundation

enum FilterMode: String, Codable, CaseIterable, Sendable {
    case markdown, markdownAndFolders, allFiles

    var label: String {
        switch self {
        case .markdown: "Markdown Only"
        case .markdownAndFolders: "Markdown + All Folders"
        case .allFiles: "All Files"
        }
    }
}

/// Outline item. Instances are reused across reloads (keyed by path) so the
/// outline view keeps expansion and selection.
@MainActor
final class FileNode: NSObject {
    let path: String          // workspace-relative, "" for the root
    let isDir: Bool
    var name: String
    var mtime: Double
    var children: [FileNode] = []
    var isMarkdown: Bool

    init(path: String, name: String, isDir: Bool, mtime: Double) {
        self.path = path
        self.name = name
        self.isDir = isDir
        self.mtime = mtime
        self.isMarkdown = !isDir && MarkdownFiles.isMarkdown(name)
    }

    var isRecentlyChanged: Bool {
        !isDir && Date().timeIntervalSince1970 - mtime < 300
    }
}

/// Builds the visible tree from a scan, reusing node objects from the previous build.
@MainActor
struct DisplayTreeBuilder {
    var previous: [String: FileNode]
    var mode: FilterMode
    var query: String
    private(set) var nodes: [String: FileNode] = [:]

    init(previous: [String: FileNode], mode: FilterMode, query: String) {
        self.previous = previous
        self.mode = mode
        self.query = query.trimmingCharacters(in: .whitespaces)
    }

    mutating func build(_ scan: ScanNode) -> FileNode {
        let root = node(path: "", scan: scan)
        root.children = children(of: scan, path: "", ancestorMatched: false)
        return root
    }

    private mutating func node(path: String, scan: ScanNode) -> FileNode {
        let key = (scan.isDir ? "d:" : "f:") + path
        let n: FileNode
        if let old = previous[key] {
            n = old
            n.name = scan.name
            n.mtime = scan.mtime
        } else {
            n = FileNode(path: path, name: scan.name, isDir: scan.isDir, mtime: scan.mtime)
        }
        nodes[key] = n
        return n
    }

    private mutating func children(of scan: ScanNode, path: String, ancestorMatched: Bool) -> [FileNode] {
        var out: [FileNode] = []
        for child in scan.children {
            let childPath = path.isEmpty ? child.name : path + "/" + child.name
            if child.isDir {
                if mode == .markdown && !child.containsMarkdown { continue }
                let selfMatched = !query.isEmpty && FuzzyMatch.score(query, child.name) != nil
                let kids = children(of: child, path: childPath, ancestorMatched: ancestorMatched || selfMatched)
                if !query.isEmpty && kids.isEmpty && !selfMatched && !ancestorMatched { continue }
                let n = node(path: childPath, scan: child)
                n.children = kids
                out.append(n)
            } else {
                if mode != .allFiles && !child.containsMarkdown { continue }
                if !query.isEmpty && !ancestorMatched && FuzzyMatch.score(query, child.name) == nil { continue }
                out.append(node(path: childPath, scan: child))
            }
        }
        return out
    }
}
