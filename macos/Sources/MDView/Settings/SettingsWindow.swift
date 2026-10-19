import AppKit
import SwiftUI

@MainActor
final class SettingsWindowController: NSWindowController {
    init() {
        let host = NSHostingController(rootView: SettingsView())
        let window = NSWindow(contentViewController: host)
        window.title = "Settings"
        window.styleMask = [.titled, .closable]
        window.isRestorable = false
        window.tabbingMode = .disallowed
        super.init(window: window)
        window.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    @objc func closeTab(_ sender: Any?) { window?.performClose(sender) }
}

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralPane().tabItem { Label("General", systemImage: "gearshape") }
            AppearancePane().tabItem { Label("Appearance", systemImage: "textformat") }
            DiagramsPane().tabItem { Label("Diagrams", systemImage: "point.3.connected.trianglepath.dotted") }
        }
        .frame(width: 520)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 8)
    }
}

private struct GeneralPane: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Form {
            Toggle("Reopen last workspaces on launch", isOn: $settings.prefs.reopenWorkspaces)
            Picker("Default mode for opened files", selection: $settings.prefs.defaultMode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Picker("Autosave", selection: $settings.prefs.autosave) {
                ForEach(AutosaveMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Section("File tree") {
                Toggle("Respect .gitignore", isOn: $settings.prefs.respectGitignore)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Extra ignore globs")
                    TextEditor(text: $settings.prefs.extraIgnoreGlobs)
                        .font(.system(.body, design: .monospaced))
                        .frame(height: 70)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.primary.opacity(0.15)))
                    Text("One gitignore-style pattern per line, e.g. `dist/` or `**/*.generated.md`. .git, node_modules and .DS_Store are always hidden.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct AppearancePane: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Form {
            Picker("Content width", selection: $settings.prefs.core.width) {
                ForEach(WidthMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Stepper(value: $settings.prefs.core.fontSize, in: AppSettings.fontSizeRange, step: 1) {
                LabeledContent("Base font size", value: "\(Int(settings.prefs.core.fontSize)) px")
            }
            Picker("Prose font", selection: $settings.prefs.core.proseFont) {
                Text("System").tag("system")
                Text("New York (serif)").tag("serif")
            }
            Section("Code") {
                Picker("Light theme", selection: $settings.prefs.core.codeThemeLight) {
                    ForEach(AppSettings.codeThemes, id: \.self) { Text($0).tag($0) }
                }
                Picker("Dark theme", selection: $settings.prefs.core.codeThemeDark) {
                    ForEach(AppSettings.codeThemes, id: \.self) { Text($0).tag($0) }
                }
                Toggle("Line numbers in code blocks", isOn: $settings.prefs.core.codeLineNumbers)
            }
            Section("Editor") {
                Toggle("Line numbers", isOn: $settings.prefs.core.editorLineNumbers)
                Toggle("Vim keybindings", isOn: $settings.prefs.core.vim)
                Toggle("Scroll sync in Split mode", isOn: $settings.prefs.core.scrollSync)
            }
        }
        .formStyle(.grouped)
    }
}

private struct DiagramsPane: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Form {
            LabeledContent("Inline max height") {
                HStack {
                    Slider(value: $settings.prefs.core.diagramMaxHeight, in: 30...100, step: 5)
                    Text("\(Int(settings.prefs.core.diagramMaxHeight))% of window")
                        .monospacedDigit()
                        .frame(width: 110, alignment: .trailing)
                }
            }
            Picker("Small diagrams", selection: $settings.prefs.core.diagramSmallZoom) {
                Text("Actual size (100%)").tag("actual")
                Text("Fit to width").tag("fit")
            }
            Toggle("Show minimap by default", isOn: $settings.prefs.core.showMinimap)
            Picker("Mermaid theme", selection: $settings.prefs.core.mermaidTheme) {
                Text("Automatic").tag("auto")
                Text("Default").tag("default")
                Text("Dark").tag("dark")
                Text("Neutral").tag("neutral")
                Text("Forest").tag("forest")
                Text("Base").tag("base")
            }
        }
        .formStyle(.grouped)
    }
}
