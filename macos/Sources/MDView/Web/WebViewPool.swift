import AppKit
import WebKit

/// Keeps at most `capacity` tab web views alive app-wide (LRU). Evicted tabs save
/// their TabState first and are recreated on demand.
@MainActor
final class WebViewPool {
    static let shared = WebViewPool()
    let capacity = 8

    private var controllers: [UUID: DocumentController] = [:]
    private var settingsObserver: NSObjectProtocol?

    private init() {
        settingsObserver = NotificationCenter.default.addObserver(
            forName: .mdviewPreferencesChanged, object: nil, queue: .main
        ) { [weak self] note in
            let old = (note.userInfo?["old"] as? Preferences)?.core
            MainActor.assumeIsolated {
                let core = AppSettings.shared.prefs.core
                guard old != core else { return }
                self?.broadcast(.setSettings(core))
            }
        }
    }

    func live(_ tabID: UUID) -> DocumentController? { controllers[tabID] }

    var all: [DocumentController] { Array(controllers.values) }

    func broadcast(_ message: HostToCore) {
        for c in controllers.values { c.enqueue(message) }
    }

    /// Returns the tab's live controller, creating (and opening) it when needed.
    func controller(for tab: Tab, store: WorkspaceStore) -> DocumentController {
        if let c = controllers[tab.id] {
            c.lastUsed = Date()
            return c
        }
        let c = DocumentController(workspaceRoot: store.root)
        c.lastUsed = Date()
        controllers[tab.id] = c
        store.attach(c, to: tab)
        evictIfNeeded(keeping: tab.id)
        return c
    }

    private func evictIfNeeded(keeping keep: UUID) {
        guard controllers.count > capacity else { return }
        let candidates = controllers
            .filter { $0.key != keep && $0.value.webView.window == nil }
            .sorted { $0.value.lastUsed < $1.value.lastUsed }
        for (id, _) in candidates.prefix(controllers.count - capacity) {
            Task { await self.discard(id) }
        }
    }

    /// Saves state through `getState`, then destroys the web view.
    func discard(_ tabID: UUID, saveState: Bool = true) async {
        guard let c = controllers[tabID] else { return }
        if saveState, c.isReady, let state = await c.send(.getState)?.decode(TabState.self) {
            WorkspaceRegistry.tab(withID: tabID)?.state = state
        }
        guard controllers[tabID] === c else { return }
        // A tab that became visible again while we were saving stays alive.
        if c.webView.window != nil && saveState { return }
        controllers.removeValue(forKey: tabID)
        c.teardown()
    }

    func discardNow(_ tabID: UUID) {
        controllers.removeValue(forKey: tabID)?.teardown()
    }
}
