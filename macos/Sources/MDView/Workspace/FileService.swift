import Foundation

/// A file as read from disk, with the formatting facts needed to write it back unchanged.
struct LoadedFile: Sendable, Equatable {
    /// Text with line endings normalised to "\n" and any BOM removed.
    var text: String
    var usesCRLF: Bool
    var hasTrailingNewline: Bool
    var hasBOM: Bool
    var isUTF8: Bool

    static func empty() -> LoadedFile {
        LoadedFile(text: "", usesCRLF: false, hasTrailingNewline: true, hasBOM: false, isUTF8: true)
    }
}

enum FileService {
    enum ReadError: Error { case missing, unreadable }

    static func read(_ url: URL) -> Result<LoadedFile, ReadError> {
        guard FileManager.default.fileExists(atPath: url.path) else { return .failure(.missing) }
        guard let data = try? Data(contentsOf: url) else { return .failure(.unreadable) }
        return .success(decode(data))
    }

    static func decode(_ data: Data) -> LoadedFile {
        var bytes = data
        var hasBOM = false
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { hasBOM = true; bytes = bytes.dropFirst(3) }
        let strict = String(data: bytes, encoding: .utf8)
        let raw = strict ?? String(decoding: bytes, as: UTF8.self)
        let usesCRLF = raw.contains("\r\n")
        let text = usesCRLF ? raw.replacingOccurrences(of: "\r\n", with: "\n") : raw
        return LoadedFile(text: text, usesCRLF: usesCRLF, hasTrailingNewline: text.hasSuffix("\n"),
                          hasBOM: hasBOM, isUTF8: strict != nil)
    }

    /// Normalises editor text the way `decode` does, for comparisons with disk contents.
    static func normalize(_ text: String) -> String {
        text.contains("\r\n") ? text.replacingOccurrences(of: "\r\n", with: "\n") : text
    }

    /// Encodes `text` using the original file's line endings, trailing-newline state and BOM.
    static func encode(_ text: String, like original: LoadedFile) -> (data: Data, normalized: String) {
        var t = normalize(text)
        if original.hasTrailingNewline, !t.hasSuffix("\n"), !t.isEmpty { t += "\n" }
        if !original.hasTrailingNewline, t.hasSuffix("\n") { t.removeLast() }
        let out = original.usesCRLF ? t.replacingOccurrences(of: "\n", with: "\r\n") : t
        var data = Data()
        if original.hasBOM { data.append(contentsOf: [0xEF, 0xBB, 0xBF]) }
        data.append(Data(out.utf8))
        return (data, t)
    }

    /// Atomic write (temporary file + rename) through any symlink to the real file.
    static func write(_ text: String, to url: URL, like original: LoadedFile) throws -> LoadedFile {
        let (data, normalized) = encode(text, like: original)
        let target = url.canonical
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let perms = (try? FileManager.default.attributesOfItem(atPath: target.path))?[.posixPermissions]
        try data.write(to: target, options: .atomic)
        if let perms { try? FileManager.default.setAttributes([.posixPermissions: perms], ofItemAtPath: target.path) }
        var saved = original
        saved.text = normalized
        saved.hasTrailingNewline = normalized.hasSuffix("\n") || (normalized.isEmpty && original.hasTrailingNewline)
        saved.isUTF8 = true
        return saved
    }
}

extension URL {
    /// The real path (symlinks resolved, `/private` kept as the kernel reports it, unlike
    /// `resolvingSymlinksInPath()`). Missing trailing components are appended unresolved.
    var canonical: URL {
        let path = standardizedFileURL.path
        if let resolved = realpath(path, nil) {
            defer { free(resolved) }
            return URL(fileURLWithPath: String(cString: resolved))
        }
        let parent = deletingLastPathComponent()
        guard parent.path != path, !lastPathComponent.isEmpty else { return standardizedFileURL }
        return parent.canonical.appendingPathComponent(lastPathComponent)
    }
}
