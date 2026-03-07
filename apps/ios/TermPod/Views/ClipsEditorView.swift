import SwiftUI

struct ClipsEditorView: View {

    @ObservedObject private var store = ClipStore.shared
    @State private var showAddSheet = false
    @State private var editingClip: Clip?

    var body: some View {
        List {
            if store.clips.isEmpty {
                ContentUnavailableView {
                    Label("No Clips", systemImage: "doc.on.clipboard")
                } description: {
                    Text("Save frequently used commands for quick access from the terminal.")
                } actions: {
                    Button("Add Clip") { showAddSheet = true }
                        .buttonStyle(.borderedProminent)
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(store.clips) { clip in
                    ClipRow(clip: clip)
                        .contentShape(Rectangle())
                        .onTapGesture { editingClip = clip }
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        store.delete(store.clips[index])
                    }
                }
                .onMove { source, destination in
                    store.move(from: source, to: destination)
                }
            }
        }
        .navigationTitle("Clips")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddSheet = true
                } label: {
                    Image(systemName: "plus")
                }
            }

            if !store.clips.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton()
                }
            }
        }
        .sheet(isPresented: $showAddSheet) {
            ClipFormView(mode: .add)
        }
        .sheet(item: $editingClip) { clip in
            ClipFormView(mode: .edit(clip))
        }
    }
}

private struct ClipRow: View {

    let clip: Clip

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(clip.name)
                .font(.subheadline)
                .fontWeight(.medium)

            Text(clip.command)
                .font(.caption)
                .fontDesign(.monospaced)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Add/Edit Form

private struct ClipFormView: View {

    enum Mode: Identifiable {
        case add
        case edit(Clip)

        var id: String {
            switch self {
            case .add: return "add"
            case .edit(let clip): return clip.id.uuidString
            }
        }
    }

    let mode: Mode
    @State private var name: String = ""
    @State private var command: String = ""
    @Environment(\.dismiss) private var dismiss

    init(mode: Mode) {
        self.mode = mode
        if case .edit(let clip) = mode {
            _name = State(initialValue: clip.name)
            _command = State(initialValue: clip.command)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                } header: {
                    Text("Name")
                }

                Section {
                    TextField("ls -la", text: $command, axis: .vertical)
                        .fontDesign(.monospaced)
                        .lineLimit(3...6)
                } header: {
                    Text("Command")
                } footer: {
                    Text("The command text that will be sent to the terminal.")
                }
            }
            .navigationTitle(isEditing ? "Edit Clip" : "New Clip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(name.isEmpty || command.isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private func save() {
        switch mode {
        case .add:
            ClipStore.shared.add(name: name, command: command)
        case .edit(var clip):
            clip.name = name
            clip.command = command
            ClipStore.shared.update(clip)
        }
    }
}
