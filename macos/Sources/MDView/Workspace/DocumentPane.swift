import AppKit
import SwiftUI

struct DocumentPane: View {
    let store: WorkspaceStore

    var body: some View {
        VStack(spacing: 0) {
            if !store.tabs.isEmpty {
                TabBarView(store: store)
                Divider()
            }
            ZStack {
                WebContainer(store: store)
                if store.tabs.isEmpty {
                    NoDocumentView(store: store)
                }
            }
        }
        .overlay {
            if store.quickOpenVisible {
                QuickOpenView(store: store)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: nil, perform: openDroppedFiles)
    }
}

/// Folders dropped on a window open as workspaces; files open in their workspace.
func openDroppedFiles(_ providers: [NSItemProvider]) -> Bool {
    for p in providers {
        _ = p.loadObject(ofClass: URL.self) { url, _ in
            guard let url else { return }
            Task { @MainActor in AppDelegate.shared?.open(urls: [url]) }
        }
    }
    return true
}

private struct NoDocumentView: View {
    let store: WorkspaceStore

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(.tertiary)
            Text(store.markdownPaths.isEmpty && !store.isScanning ? "No markdown files in this folder" : "Select a file in the sidebar")
                .foregroundStyle(.secondary)
            Text("⌘P to quick open")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
    }
}

/// Hosts the active tab's web view; switching tabs swaps the pooled web view in.
struct WebContainer: NSViewRepresentable {
    let store: WorkspaceStore

    func makeNSView(context: Context) -> WebHostView { WebHostView() }

    func updateNSView(_ view: WebHostView, context: Context) {
        guard let tab = store.activeTab else {
            view.show(nil)
            return
        }
        view.show(WebViewPool.shared.controller(for: tab, store: store).webView)
    }
}

final class WebHostView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.textBackgroundColor.cgColor
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = NSColor.textBackgroundColor.cgColor
        }
    }

    func show(_ web: MDWebView?) {
        if let web, web.superview === self { return }
        let hadFocus = subviews.contains { v in
            guard let r = window?.firstResponder as? NSView else { return false }
            return r.isDescendant(of: v)
        }
        subviews.forEach { $0.removeFromSuperview() }
        guard let web else { return }
        web.removeFromSuperview()
        web.translatesAutoresizingMaskIntoConstraints = false
        addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: leadingAnchor),
            web.trailingAnchor.constraint(equalTo: trailingAnchor),
            web.topAnchor.constraint(equalTo: topAnchor),
            web.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        if hadFocus { window?.makeFirstResponder(web) }
    }
}
