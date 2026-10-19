import Foundation

/// Case-insensitive subsequence matching with a simple score (higher is better).
enum FuzzyMatch {
    static func score(_ query: String, _ candidate: String) -> Int? {
        let q = Array(query.lowercased().unicodeScalars).filter { !$0.properties.isWhitespace }
        if q.isEmpty { return 0 }
        let c = Array(candidate.lowercased().unicodeScalars)
        let orig = Array(candidate.unicodeScalars)
        var score = 0, qi = 0, last = -2, streak = 0
        for (i, ch) in c.enumerated() where qi < q.count {
            guard ch == q[qi] else { continue }
            var s = 1
            if i == last + 1 { streak += 1; s += 4 * streak } else { streak = 0 }
            if i == 0 { s += 8 }
            else {
                let prev = orig[i - 1]
                if "/-_. ".unicodeScalars.contains(prev) { s += 6 }
                else if CharacterSet.uppercaseLetters.contains(orig[i]) && CharacterSet.lowercaseLetters.contains(prev) { s += 4 }
            }
            if last >= 0 { s -= min(i - last - 1, 3) }
            score += s
            last = i
            qi += 1
        }
        guard qi == q.count else { return nil }
        return score - c.count / 8
    }

    /// Ranks workspace-relative paths, favouring matches in the file name.
    static func rank(_ query: String, paths: [String], limit: Int = 60) -> [String] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return Array(paths.prefix(limit)) }
        var scored: [(String, Int)] = []
        for p in paths {
            let name = (p as NSString).lastPathComponent
            if let s = score(trimmed, name) { scored.append((p, s * 2 + 20)) }
            else if let s = score(trimmed, p) { scored.append((p, s)) }
        }
        scored.sort { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0.count < $1.0.count }
        return scored.prefix(limit).map(\.0)
    }
}
