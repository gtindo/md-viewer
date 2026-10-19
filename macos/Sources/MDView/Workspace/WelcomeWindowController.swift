import AppKit
import SwiftUI

/// The empty-state window: Open Folder, Open File and recent workspaces.
@MainActor
final class WelcomeWindowController: NSWindowController, NSWindowDelegate {
    var onClose: (() -> Void)?

    init() {
        let host = NSHostingController(rootView: WelcomeView())
        host.sizingOptions = []
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 400),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.contentViewController = host
        window.setContentSize(NSSize(width: 620, height: 400))
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.title = "Welcome to MDView"
        window.center()
        super.init(window: window)
        window.delegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func windowWillClose(_ notification: Notification) { onClose?() }

    @objc func closeTab(_ sender: Any?) { window?.performClose(sender) }
}

private struct WelcomeView: View {
    @State private var recents = SessionManager.shared.recents
    @State private var dropTargeted = false

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 14) {
                Spacer()
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 96, height: 96)
                Text("MDView").font(.system(size: 26, weight: .semibold))
                Text("Markdown and Mermaid, readable at any size")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer().frame(height: 8)
                VStack(alignment: .leading, spacing: 8) {
                    Button { AppDelegate.shared?.openFolderPanel(nil) } label: {
                        Label("Open Folder…", systemImage: "folder")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Button { AppDelegate.shared?.openFilePanel(nil) } label: {
                        Label("Open File…", systemImage: "doc.text")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .controlSize(.large)
                .frame(width: 200)
                Spacer()
                Text("Or drop a folder here")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.bottom, 16)
            }
            .frame(width: 320)
            .frame(maxHeight: .infinity)

            Divider()

            VStack(alignment: .leading, spacing: 0) {
                Text("Recent")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.top, 40)
                    .padding(.bottom, 8)
                if recents.isEmpty {
                    Text("No recent workspaces")
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 16)
                    Spacer()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(recents, id: \.self) { path in
                                RecentRow(path: path)
                            }
                        }
                        .padding(.horizontal, 8)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color.primary.opacity(0.03))
        }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 8).stroke(Color.accentColor, lineWidth: 3).padding(4)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            for p in providers {
                _ = p.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    Task { @MainActor in AppDelegate.shared?.open(urls: [url]) }
                }
            }
            return true
        }
    }
}

private struct RecentRow: View {
    let path: String
    @State private var hovering = false

    var body: some View {
        Button {
            AppDelegate.shared?.open(urls: [URL(fileURLWithPath: path)])
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "folder.fill").foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text((path as NSString).lastPathComponent).lineLimit(1)
                    Text((path as NSString).abbreviatingWithTildeInPath)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(hovering ? Color.primary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(path)
    }
}
