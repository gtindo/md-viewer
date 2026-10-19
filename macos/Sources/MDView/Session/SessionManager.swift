import AppKit

struct WorkspacePrefs: Codable, Sendable, Equatable {
    var filterMode: FilterMode
    var expanded: [String]
}

struct WorkspaceSession: Codable, Sendable, Equatable {
    var root: String
    var frame: String?
    var tabs: [TabSnapshot]
    var activeIndex: Int?
    var sidebarVisible: Bool
    var sidebarWidth: Double?
}

struct SessionFile: Codable, Sendable {
    var version = 1
    var workspaces: [WorkspaceSession] = []
    var recent: [String] = []
    var workspacePrefs: [String: WorkspacePrefs] = [:]

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 1
        workspaces = (try? c.decodeIfPresent([WorkspaceSession].self, forKey: .workspaces)) ?? []
        recent = (try? c.decodeIfPresent([String].self, forKey: .recent)) ?? []
        workspacePrefs = (try? c.decodeIfPresent([String: WorkspacePrefs].self, forKey: .workspacePrefs)) ?? [:]
    }
}

/// Persists open workspaces, per-workspace tree preferences and recents to
/// ~/Library/Application Support/MDView/session.json.
@MainActor
final class SessionManager {
    static let shared = SessionManager()
    static let maxRecents = 10

    private(set) var file: SessionFile
    private var saveWork: DispatchWorkItem?
    /// Supplies the live workspace sessions (set by the app delegate).
    var collectWorkspaces: (() -> [WorkspaceSession])?
    /// While false (e.g. during launch restore or termination), the open-workspace list is not rewritten.
    var tracksOpenWorkspaces = true

    private static var url: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("MDView/session.json")
    }

    private init() {
        if let data = try? Data(contentsOf: Self.url), let f = try? JSONDecoder().decode(SessionFile.self, from: data) {
            file = f
        } else {
            file = SessionFile()
        }
    }

    var savedWorkspaces: [WorkspaceSession] { file.workspaces }
    var recents: [String] { file.recent }

    func workspacePrefs(for root: String) -> WorkspacePrefs? { file.workspacePrefs[root] }

    func setWorkspacePrefs(_ prefs: WorkspacePrefs, for root: String) {
        guard file.workspacePrefs[root] != prefs else { return }
        file.workspacePrefs[root] = prefs
        scheduleSave()
    }

    func noteRecent(_ root: String) {
        file.recent.removeAll { $0 == root }
        file.recent.insert(root, at: 0)
        if file.recent.count > Self.maxRecents { file.recent.removeLast(file.recent.count - Self.maxRecents) }
        NSDocumentController.shared.noteNewRecentDocumentURL(URL(fileURLWithPath: root))
        scheduleSave()
    }

    func clearRecents() {
        file.recent.removeAll()
        NSDocumentController.shared.clearRecentDocuments(nil)
        scheduleSave()
    }

    func scheduleSave() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.saveNow() }
        }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
    }

    func saveNow() {
        saveWork?.cancel()
        saveWork = nil
        if tracksOpenWorkspaces, let collect = collectWorkspaces {
            file.workspaces = collect()
        }
        do {
            try FileManager.default.createDirectory(at: Self.url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let enc = JSONEncoder()
            enc.outputFormatting = [.prettyPrinted, .sortedKeys]
            try enc.encode(file).write(to: Self.url, options: .atomic)
        } catch {
            debugLog("session save failed: \(error)")
        }
    }
}
