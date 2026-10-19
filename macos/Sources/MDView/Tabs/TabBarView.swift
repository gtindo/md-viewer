import SwiftUI
import UniformTypeIdentifiers

struct TabBarView: View {
    let store: WorkspaceStore
    @State private var dragging: UUID?
    static let minWidth: CGFloat = 120
    static let maxWidth: CGFloat = 220
    static let height: CGFloat = 30

    var body: some View {
        GeometryReader { geo in
            let count = CGFloat(max(store.tabs.count, 1))
            let overflow = count * Self.minWidth > geo.size.width
            let available = geo.size.width - (overflow ? 28 : 0)
            let width = min(Self.maxWidth, max(Self.minWidth, available / count))
            HStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 0) {
                            ForEach(store.tabs) { tab in
                                TabItemView(store: store, tab: tab, isActive: tab.id == store.activeTabID)
                                    .frame(width: width)
                                    .id(tab.id)
                                    .onDrag {
                                        dragging = tab.id
                                        return NSItemProvider(object: tab.id.uuidString as NSString)
                                    }
                                    .onDrop(of: [.text], delegate: TabDropDelegate(target: tab, store: store, dragging: $dragging))
                            }
                        }
                    }
                    .onChange(of: store.activeTabID) { _, id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id) }
                    }
                }
                if overflow {
                    Menu {
                        ForEach(store.tabs) { tab in
                            Button {
                                store.activate(tab)
                            } label: {
                                if tab.id == store.activeTabID { Label(tab.title, systemImage: "checkmark") } else { Text(tab.title) }
                            }
                        }
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .frame(width: 28)
                    .help("All tabs")
                }
            }
        }
        .frame(height: Self.height)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

private struct TabDropDelegate: DropDelegate {
    let target: Tab
    let store: WorkspaceStore
    @Binding var dragging: UUID?

    func dropEntered(info: DropInfo) {
        MainActor.assumeIsolated {
            guard let id = dragging, id != target.id, let tab = store.tabs.first(where: { $0.id == id }) else { return }
            withAnimation(.easeOut(duration: 0.12)) { store.moveTab(tab, before: target) }
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        return true
    }
}

private struct TabItemView: View {
    let store: WorkspaceStore
    let tab: Tab
    let isActive: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 4) {
            closeButton
            Text(tab.title)
                .italic(!tab.isPinned)
                .strikethrough(tab.isDeleted)
                .lineLimit(1)
                .truncationMode(.middle)
                .font(.system(size: 12))
                .foregroundStyle(isActive ? .primary : .secondary)
                .frame(maxWidth: .infinity)
            Color.clear.frame(width: 16, height: 16)
        }
        .padding(.horizontal, 6)
        .frame(maxHeight: .infinity)
        .background(isActive ? Color(nsColor: .controlBackgroundColor) : (hovering ? Color.primary.opacity(0.04) : .clear))
        .overlay(alignment: .trailing) { Divider() }
        .overlay(alignment: .bottom) {
            if isActive { Rectangle().fill(Color.accentColor).frame(height: 2) }
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .gesture(TapGesture(count: 2).onEnded { store.pin(tab) })
        .simultaneousGesture(TapGesture().onEnded { store.activate(tab) })
        .help(tab.path)
        .contextMenu { menu }
    }

    @ViewBuilder private var closeButton: some View {
        ZStack {
            if tab.isDirty && !hovering {
                Circle().fill(Color.primary.opacity(0.6)).frame(width: 7, height: 7)
            } else if hovering || isActive {
                Button {
                    store.ui?.requestClose(tab)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .semibold))
                        .frame(width: 16, height: 16)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Close Tab")
            }
        }
        .frame(width: 16, height: 16)
    }

    @ViewBuilder private var menu: some View {
        Button("Close") { store.ui?.requestClose(tab) }
        Button("Close Others") {
            for t in store.tabs where t !== tab { store.ui?.requestClose(t) }
        }
        Button("Close to the Right") {
            guard let i = store.tabs.firstIndex(where: { $0 === tab }) else { return }
            for t in store.tabs[(i + 1)...] { store.ui?.requestClose(t) }
        }
        Divider()
        if !tab.isPinned { Button("Keep Open") { store.pin(tab) } }
        Button("Copy Path") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(store.url(for: tab.path).path, forType: .string)
        }
        Button("Reveal in Tree") {
            store.activate(tab)
            store.revealActiveFile()
        }
    }
}
