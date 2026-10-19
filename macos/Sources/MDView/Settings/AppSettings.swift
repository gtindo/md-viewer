import Foundation
import Observation

enum AutosaveMode: String, Codable, CaseIterable, Sendable {
    case off, onFocusLoss, afterIdle

    var label: String {
        switch self {
        case .off: "Off"
        case .onFocusLoss: "On focus loss"
        case .afterIdle: "After 2 seconds idle"
        }
    }
}

/// Everything persisted app-wide. `core` maps 1:1 onto bridge.ts `Settings`.
struct Preferences: Codable, Equatable, Sendable {
    var core = CoreSettings()
    var reopenWorkspaces = true
    var defaultMode: Mode = .preview
    var autosave: AutosaveMode = .off
    var respectGitignore = true
    /// Newline-separated gitignore-style globs.
    var extraIgnoreGlobs = ""

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Preferences()
        core = (try? c.decodeIfPresent(CoreSettings.self, forKey: .core)) ?? d.core
        reopenWorkspaces = (try? c.decodeIfPresent(Bool.self, forKey: .reopenWorkspaces)) ?? d.reopenWorkspaces
        defaultMode = (try? c.decodeIfPresent(Mode.self, forKey: .defaultMode)) ?? d.defaultMode
        autosave = (try? c.decodeIfPresent(AutosaveMode.self, forKey: .autosave)) ?? d.autosave
        respectGitignore = (try? c.decodeIfPresent(Bool.self, forKey: .respectGitignore)) ?? d.respectGitignore
        extraIgnoreGlobs = (try? c.decodeIfPresent(String.self, forKey: .extraIgnoreGlobs)) ?? d.extraIgnoreGlobs
    }

    var ignoreGlobList: [String] {
        extraIgnoreGlobs
            .split(whereSeparator: { $0 == "\n" || $0 == "," })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

extension Notification.Name {
    static let mdviewPreferencesChanged = Notification.Name("MDViewPreferencesChanged")
}

@MainActor @Observable
final class AppSettings {
    static let shared = AppSettings()

    static let fontSizeRange: ClosedRange<Double> = 10...32
    static let codeThemes = [
        "github-light", "github-dark", "light-plus", "dark-plus", "one-light", "one-dark-pro",
        "min-light", "min-dark", "solarized-light", "solarized-dark", "catppuccin-latte",
        "catppuccin-mocha", "nord", "vitesse-light", "vitesse-dark",
    ]

    private static let key = "preferences.v1"

    var prefs: Preferences {
        didSet {
            guard prefs != oldValue else { return }
            prefs.core.fontSize = min(max(prefs.core.fontSize, Self.fontSizeRange.lowerBound), Self.fontSizeRange.upperBound)
            save()
            NotificationCenter.default.post(name: .mdviewPreferencesChanged, object: nil,
                                            userInfo: ["old": oldValue])
        }
    }

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let p = try? JSONDecoder().decode(Preferences.self, from: data) {
            prefs = p
        } else {
            prefs = Preferences()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(prefs) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    func adjustFontSize(by delta: Double) {
        prefs.core.fontSize = min(max(prefs.core.fontSize + delta, Self.fontSizeRange.lowerBound), Self.fontSizeRange.upperBound)
    }
}
