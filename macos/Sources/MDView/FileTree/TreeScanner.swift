import Foundation
import Darwin

/// One entry of a scanned workspace. Children are sorted (folders first, natural order).
struct ScanNode: Sendable {
    var name: String
    var isDir: Bool
    var mtime: Double
    var children: [ScanNode]
    /// For directories: contains a markdown file at any depth. For files: is markdown.
    var containsMarkdown: Bool
}

struct ScanOptions: Sendable {
    var respectGitignore: Bool
    var extraGlobs: [String]
}

struct ScanResult: Sendable {
    var root: ScanNode
    /// Workspace-relative paths of every markdown file, for quick open.
    var markdownPaths: [String]
    var fileCount: Int
    var duration: Double
}

enum MarkdownFiles {
    static let extensions: Set<String> = ["md", "markdown", "mdx"]

    static func isMarkdown(_ name: String) -> Bool {
        guard let dot = name.lastIndex(of: ".") else { return false }
        return extensions.contains(name[name.index(after: dot)...].lowercased())
    }
}

enum TreeScanner {
    static let alwaysHidden: Set<String> = [".git", "node_modules", ".DS_Store"]

    /// Full enumeration with fts(3), pruning ignored directories as they are entered.
    static func scan(root: URL, options: ScanOptions) -> ScanResult {
        let start = Date()
        let rootPath = root.path
        let rootPrefixLen = rootPath.utf8.count + (rootPath.hasSuffix("/") ? 0 : 1)

        var matchers: [GitIgnore] = []
        let extra = GitIgnore(base: "", globs: options.extraGlobs)
        if options.respectGitignore {
            if let t = try? String(contentsOfFile: rootPath + "/.git/info/exclude", encoding: .utf8) {
                matchers.append(GitIgnore(base: "", text: t))
            }
        }

        struct Frame {
            var node: ScanNode
            var relPath: String
            var pushedMatcher: Bool
        }
        var stack: [Frame] = []
        var markdownPaths: [String] = []
        var fileCount = 0
        var rootNode = ScanNode(name: root.lastPathComponent, isDir: true, mtime: 0, children: [], containsMarkdown: false)

        func isIgnored(rel: String, name: String, isDir: Bool) -> Bool {
            if alwaysHidden.contains(name) { return true }
            let relBytes = Array(rel.utf8), nameBytes = Array(name.utf8)
            if !extra.isEmpty, let d = extra.decision(relativePath: relBytes, name: nameBytes, isDir: isDir) { return d }
            guard options.respectGitignore else { return false }
            for m in matchers.reversed() {
                let sub: [UInt8]
                if m.base.isEmpty {
                    sub = relBytes
                } else {
                    let prefix = m.base.utf8.count + 1
                    guard relBytes.count > prefix else { continue }
                    sub = Array(relBytes[prefix...])
                }
                if let d = m.decision(relativePath: sub, name: nameBytes, isDir: isDir) { return d }
            }
            return false
        }

        func loadGitignore(dirPath: String, rel: String) -> Bool {
            guard options.respectGitignore,
                  let text = try? String(contentsOfFile: dirPath + "/.gitignore", encoding: .utf8) else { return false }
            let gi = GitIgnore(base: rel, text: text)
            guard !gi.isEmpty else { return false }
            matchers.append(gi)
            return true
        }

        rootPath.withCString { cPath in
            var paths: [UnsafeMutablePointer<CChar>?] = [strdup(cPath), nil]
            defer { free(paths[0]) }
            guard let fts = fts_open(&paths, FTS_PHYSICAL | FTS_NOCHDIR, nil) else { return }
            defer { fts_close(fts) }

            while let ent = fts_read(fts) {
                let info = Int32(ent.pointee.fts_info)
                let level = Int(ent.pointee.fts_level)
                if level == 0 {
                    if info == FTS_D {
                        let pushed = loadGitignore(dirPath: rootPath, rel: "")
                        stack.append(Frame(node: rootNode, relPath: "", pushedMatcher: pushed))
                    } else if info == FTS_DP, let f = stack.popLast() {
                        if f.pushedMatcher { matchers.removeLast() }
                        rootNode = finish(f.node)
                    }
                    continue
                }
                let fullPath = String(cString: ent.pointee.fts_path)
                let rel = String(fullPath.utf8.dropFirst(rootPrefixLen)) ?? ""
                let name = (rel as NSString).lastPathComponent
                let mtime: Double = {
                    guard let st = ent.pointee.fts_statp else { return 0 }
                    return Double(st.pointee.st_mtimespec.tv_sec) + Double(st.pointee.st_mtimespec.tv_nsec) / 1e9
                }()

                switch info {
                case FTS_D:
                    if isIgnored(rel: rel, name: name, isDir: true) {
                        fts_set(fts, ent, FTS_SKIP)
                        continue
                    }
                    let pushed = loadGitignore(dirPath: fullPath, rel: rel)
                    stack.append(Frame(node: ScanNode(name: name, isDir: true, mtime: mtime, children: [], containsMarkdown: false),
                                       relPath: rel, pushedMatcher: pushed))
                case FTS_DP, FTS_DNR:
                    // Only directories we pushed come back here (skipped ones do not).
                    guard stack.count > 1, stack.last?.relPath == rel, let f = stack.popLast() else { continue }
                    if f.pushedMatcher { matchers.removeLast() }
                    let done = finish(f.node)
                    stack[stack.count - 1].node.children.append(done)
                case FTS_F, FTS_SL, FTS_SLNONE, FTS_DEFAULT:
                    var isDir = false
                    if info == FTS_SL {
                        var st = stat()
                        if stat(fullPath, &st) == 0, (st.st_mode & S_IFMT) == S_IFDIR { isDir = true }
                    }
                    if isIgnored(rel: rel, name: name, isDir: isDir) { continue }
                    let md = !isDir && MarkdownFiles.isMarkdown(name)
                    if md { markdownPaths.append(rel) }
                    fileCount += 1
                    if !stack.isEmpty {
                        stack[stack.count - 1].node.children.append(
                            ScanNode(name: name, isDir: isDir, mtime: mtime, children: [], containsMarkdown: md))
                    }
                default:
                    continue // errors, unreadable dirs, cycles
                }
            }
        }

        markdownPaths.sort { $0.localizedStandardCompare($1) == .orderedAscending }
        return ScanResult(root: rootNode, markdownPaths: markdownPaths, fileCount: fileCount,
                          duration: Date().timeIntervalSince(start))
    }

    private static func finish(_ node: ScanNode) -> ScanNode {
        var n = node
        n.children.sort(by: sortOrder)
        n.containsMarkdown = n.children.contains { $0.containsMarkdown }
        return n
    }

    static func sortOrder(_ a: ScanNode, _ b: ScanNode) -> Bool {
        if a.isDir != b.isDir { return a.isDir }
        return a.name.localizedStandardCompare(b.name) == .orderedAscending
    }
}
