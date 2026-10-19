import Foundation
import Observation

struct HistoryEntry: Codable, Sendable, Equatable {
    var path: String
    var state: TabState
}

/// Persisted / reopenable description of a tab.
struct TabSnapshot: Codable, Sendable, Equatable {
    var path: String
    var pinned: Bool
    var mode: Mode
    var state: TabState
}

@MainActor @Observable
final class Tab: Identifiable {
    let id = UUID()
    /// Workspace-relative path using "/" separators.
    var path: String
    var isPinned: Bool
    var mode: Mode
    var isDirty = false
    var isDeleted = false
    /// Latest text reported by the editor (`edited`), when it differs from disk.
    var editedText: String?
    /// Last contents read from or written to disk.
    var disk = LoadedFile.empty()
    var banner: Banner?
    var allowRemoteImages = false
    @ObservationIgnored var state = TabState()
    @ObservationIgnored var back: [HistoryEntry] = []
    @ObservationIgnored var forward: [HistoryEntry] = []
    /// On-disk contents that conflict with unsaved edits, while the conflict banner is shown.
    @ObservationIgnored var theirs: LoadedFile?
    @ObservationIgnored var autosaveWork: DispatchWorkItem?

    init(path: String, pinned: Bool, mode: Mode) {
        self.path = path
        self.isPinned = pinned
        self.mode = mode
    }

    var title: String { (path as NSString).lastPathComponent }
    var isEditable: Bool { disk.isUTF8 }
    var currentText: String { editedText ?? disk.text }

    var snapshot: TabSnapshot {
        TabSnapshot(path: path, pinned: isPinned, mode: mode, state: state)
    }
}
