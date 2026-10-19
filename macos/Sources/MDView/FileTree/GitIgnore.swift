import Foundation

/// A gitignore-style glob, compiled to tokens over UTF-8 bytes.
struct Glob: Sendable {
    enum Token: Sendable, Equatable {
        case literal(UInt8)
        case any                 // ?
        case star                // * (no slash)
        case globstar            // ** (anything, including slashes)
        case globstarSlash       // **/ (zero or more whole directories)
        case set([ClosedRange<UInt8>], negated: Bool)
    }

    private enum Fast: Sendable {
        case exact([UInt8])
        case suffix([UInt8])     // "*.ext"
        case prefix([UInt8])     // "name*"
        case general
    }

    let tokens: [Token]
    private let fast: Fast

    init(_ pattern: String) {
        let p = Array(pattern.utf8)
        var t: [Token] = []
        var i = 0
        while i < p.count {
            let c = p[i]
            switch c {
            case UInt8(ascii: "\\") where i + 1 < p.count:
                t.append(.literal(p[i + 1])); i += 2; continue
            case UInt8(ascii: "?"):
                t.append(.any)
            case UInt8(ascii: "*"):
                if i + 1 < p.count, p[i + 1] == UInt8(ascii: "*") {
                    let atSegmentStart = i == 0 || p[i - 1] == UInt8(ascii: "/")
                    if atSegmentStart, i + 2 < p.count, p[i + 2] == UInt8(ascii: "/") {
                        t.append(.globstarSlash); i += 3; continue
                    }
                    t.append(.globstar); i += 2
                    while i < p.count, p[i] == UInt8(ascii: "*") { i += 1 }
                    continue
                }
                t.append(.star)
            case UInt8(ascii: "["):
                if let (set, next) = Glob.parseSet(p, from: i) { t.append(set); i = next; continue }
                t.append(.literal(c))
            default:
                t.append(.literal(c))
            }
            i += 1
        }
        tokens = t

        func literals(_ ts: ArraySlice<Token>) -> [UInt8]? {
            var out: [UInt8] = []
            for tok in ts { guard case .literal(let b) = tok else { return nil }; out.append(b) }
            return out
        }
        if let lit = literals(t[...]) {
            fast = .exact(lit)
        } else if t.first == .star, let lit = literals(t.dropFirst()), !lit.contains(UInt8(ascii: "/")) {
            fast = .suffix(lit)
        } else if t.last == .star, let lit = literals(t.dropLast()), !lit.contains(UInt8(ascii: "/")) {
            fast = .prefix(lit)
        } else {
            fast = .general
        }
    }

    private static func parseSet(_ p: [UInt8], from start: Int) -> (Token, Int)? {
        var i = start + 1
        var negated = false
        if i < p.count, p[i] == UInt8(ascii: "!") || p[i] == UInt8(ascii: "^") { negated = true; i += 1 }
        var ranges: [ClosedRange<UInt8>] = []
        var first = true
        while i < p.count {
            let c = p[i]
            if c == UInt8(ascii: "]"), !first { return (.set(ranges, negated: negated), i + 1) }
            first = false
            if i + 2 < p.count, p[i + 1] == UInt8(ascii: "-"), p[i + 2] != UInt8(ascii: "]") {
                let lo = min(c, p[i + 2]), hi = max(c, p[i + 2])
                ranges.append(lo...hi); i += 3
            } else {
                ranges.append(c...c); i += 1
            }
        }
        return nil
    }

    func matches(_ s: [UInt8]) -> Bool {
        switch fast {
        case .exact(let lit): return s == lit
        case .suffix(let lit):
            return s.count >= lit.count && !s.contains(UInt8(ascii: "/")) && s.suffix(lit.count).elementsEqual(lit)
        case .prefix(let lit):
            return s.count >= lit.count && !s.dropFirst(lit.count).contains(UInt8(ascii: "/")) && s.prefix(lit.count).elementsEqual(lit)
        case .general:
            return Glob.match(tokens[...], s[...])
        }
    }

    private static func match(_ t: ArraySlice<Token>, _ s: ArraySlice<UInt8>) -> Bool {
        var t = t, s = s
        while let tok = t.first {
            switch tok {
            case .literal(let b):
                guard s.first == b else { return false }
                t = t.dropFirst(); s = s.dropFirst()
            case .any:
                guard let c = s.first, c != UInt8(ascii: "/") else { return false }
                t = t.dropFirst(); s = s.dropFirst()
            case .set(let ranges, let negated):
                guard let c = s.first, c != UInt8(ascii: "/") else { return false }
                guard ranges.contains(where: { $0.contains(c) }) != negated else { return false }
                t = t.dropFirst(); s = s.dropFirst()
            case .star:
                let rest = t.dropFirst()
                var j = s.startIndex
                while true {
                    if match(rest, s[j...]) { return true }
                    if j == s.endIndex || s[j] == UInt8(ascii: "/") { return false }
                    j += 1
                }
            case .globstar:
                let rest = t.dropFirst()
                if rest.isEmpty { return true }
                var j = s.startIndex
                while true {
                    if match(rest, s[j...]) { return true }
                    if j == s.endIndex { return false }
                    j += 1
                }
            case .globstarSlash:
                let rest = t.dropFirst()
                if match(rest, s) { return true }
                var j = s.startIndex
                while j < s.endIndex {
                    if s[j] == UInt8(ascii: "/"), match(rest, s[(j + 1)...]) { return true }
                    j += 1
                }
                return false
            }
        }
        return s.isEmpty
    }
}

/// Rules from one .gitignore file (or the settings' extra globs), relative to `base`.
struct GitIgnore: Sendable {
    struct Rule: Sendable {
        let glob: Glob
        let negated: Bool
        let dirOnly: Bool
        /// Unanchored rules (no slash) match the basename at any depth.
        let anchored: Bool
    }

    /// Workspace-relative directory containing the rules ("" for the root).
    let base: String
    let rules: [Rule]

    init(base: String, text: String) {
        self.base = base
        var rules: [Rule] = []
        for raw in text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            var line = String(raw)
            if line.isEmpty || line.hasPrefix("#") { continue }
            // Trailing spaces are ignored unless escaped.
            while line.hasSuffix(" "), !line.hasSuffix("\\ ") { line.removeLast() }
            if line.isEmpty { continue }
            var negated = false
            if line.hasPrefix("!") { negated = true; line.removeFirst() }
            else if line.hasPrefix("\\!") || line.hasPrefix("\\#") { line.removeFirst() }
            var dirOnly = false
            if line.hasSuffix("/") { dirOnly = true; while line.hasSuffix("/") { line.removeLast() } }
            if line.isEmpty { continue }
            var anchored = line.contains("/")
            if line.hasPrefix("/") { line.removeFirst() }
            if line.hasPrefix("**/") { anchored = true }
            rules.append(Rule(glob: Glob(line), negated: negated, dirOnly: dirOnly, anchored: anchored))
        }
        self.rules = rules
    }

    init(base: String, globs: [String]) {
        self.init(base: base, text: globs.joined(separator: "\n"))
    }

    var isEmpty: Bool { rules.isEmpty }

    /// nil = no rule matched; true = ignored; false = explicitly re-included.
    func decision(relativePath: [UInt8], name: [UInt8], isDir: Bool) -> Bool? {
        for rule in rules.reversed() {
            if rule.dirOnly && !isDir { continue }
            let subject = rule.anchored ? relativePath : name
            if rule.glob.matches(subject) { return !rule.negated }
        }
        return nil
    }
}
