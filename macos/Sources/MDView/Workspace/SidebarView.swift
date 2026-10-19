import SwiftUI

struct SidebarView: View {
    @Bindable var store: WorkspaceStore

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Image(systemName: "line.3.horizontal.decrease")
                    .foregroundStyle(.secondary)
                    .font(.system(size: 11))
                TextField("Filter", text: $store.filterQuery)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .onExitCommand { store.filterQuery = "" }
                if !store.filterQuery.isEmpty {
                    Button {
                        store.filterQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.06)))
            .padding(.horizontal, 10)
            .padding(.top, 2)
            .padding(.bottom, 6)

            FileTreeOutline(store: store)

            Divider()
            HStack(spacing: 6) {
                Menu {
                    Picker("Show", selection: $store.filterMode) {
                        ForEach(FilterMode.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label(store.filterMode.label, systemImage: "line.3.horizontal.decrease.circle")
                        .font(.system(size: 11))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Choose which files the tree shows")
                Spacer()
                if store.isScanning && store.displayRoot == nil {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .onDrop(of: [.fileURL], isTargeted: nil, perform: openDroppedFiles)
    }
}
