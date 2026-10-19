import AppKit
import SwiftUI

/// ⌘P: fuzzy search over the workspace's markdown files.
struct QuickOpenView: View {
    let store: WorkspaceStore
    @State private var query = ""
    @State private var selection = 0

    private var results: [String] { FuzzyMatch.rank(query, paths: store.markdownPaths, limit: 50) }

    var body: some View {
        let results = self.results
        ZStack(alignment: .top) {
            Color.black.opacity(0.001)
                .onTapGesture { close() }
            VStack(spacing: 0) {
                CommandTextField(
                    text: $query, placeholder: "Open file by name",
                    onMove: { delta in
                        guard !results.isEmpty else { return }
                        selection = (selection + delta + results.count) % results.count
                    },
                    onSubmit: { open(results) },
                    onCancel: { close() })
                    .frame(height: 28)
                    .padding(10)
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(results.enumerated()), id: \.element) { i, path in
                                row(path, selected: i == selection)
                                    .id(i)
                                    .contentShape(Rectangle())
                                    .onTapGesture { selection = i; open(results) }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .onChange(of: selection) { _, s in proxy.scrollTo(s) }
                }
                .frame(maxHeight: 340)
                if results.isEmpty {
                    Text(store.markdownPaths.isEmpty ? "No markdown files" : "No matches")
                        .foregroundStyle(.secondary)
                        .padding(14)
                }
            }
            .frame(width: 560)
            .fixedSize(horizontal: false, vertical: true)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.15)))
            .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
            .padding(.top, 48)
        }
        .onChange(of: query) { _, _ in selection = 0 }
    }

    private func row(_ path: String, selected: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text").foregroundStyle(selected ? .white : .secondary)
            Text((path as NSString).lastPathComponent)
                .foregroundStyle(selected ? .white : .primary)
            Text((path as NSString).deletingLastPathComponent)
                .font(.caption)
                .foregroundStyle(selected ? .white.opacity(0.8) : .secondary)
                .lineLimit(1)
                .truncationMode(.head)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(selected ? Color.accentColor : .clear, in: RoundedRectangle(cornerRadius: 5))
        .padding(.horizontal, 6)
    }

    private func open(_ results: [String]) {
        guard results.indices.contains(selection) else { return NSSound.beep() }
        let path = results[selection]
        close()
        store.open(path, pinned: true)
    }

    private func close() {
        store.quickOpenVisible = false
    }
}

/// A text field that reports arrow keys, Return and Escape.
struct CommandTextField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var onMove: (Int) -> Void
    var onSubmit: () -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField()
        field.placeholderString = placeholder
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 17)
        field.delegate = context.coordinator
        DispatchQueue.main.async { field.window?.makeFirstResponder(field) }
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text { field.stringValue = text }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: CommandTextField
        init(_ parent: CommandTextField) { self.parent = parent }

        func controlTextDidChange(_ note: Notification) {
            if let f = note.object as? NSTextField { parent.text = f.stringValue }
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.moveUp(_:)): parent.onMove(-1)
            case #selector(NSResponder.moveDown(_:)): parent.onMove(1)
            case #selector(NSResponder.insertNewline(_:)): parent.onSubmit()
            case #selector(NSResponder.cancelOperation(_:)): parent.onCancel()
            default: return false
            }
            return true
        }
    }
}
