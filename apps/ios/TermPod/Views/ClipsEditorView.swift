import SwiftUI

struct ClipsEditorView: View {

    @ObservedObject private var store = ClipStore.shared
    @State private var showAddSheet = false
    @State private var editingClip: Clip?

    private var populatedCategories: [String] {
        store.categories.filter { !store.clips(in: $0).isEmpty }
    }

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
                ForEach(populatedCategories, id: \.self) { category in
                    Section(category) {
                        ForEach(store.clips(in: category)) { clip in
                            ClipRow(clip: clip)
                                .contentShape(Rectangle())
                                .onTapGesture { editingClip = clip }
                        }
                        .onDelete { indexSet in
                            let categoryClips = store.clips(in: category)
                            for index in indexSet {
                                store.delete(categoryClips[index])
                            }
                        }
                    }
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
    @State private var category: String = "General"
    @State private var showCustomCategoryField = false
    @State private var customCategory: String = ""
    @Environment(\.dismiss) private var dismiss

    private var store: ClipStore { ClipStore.shared }

    init(mode: Mode) {
        self.mode = mode
        if case .edit(let clip) = mode {
            _name = State(initialValue: clip.name)
            _command = State(initialValue: clip.command)
            _category = State(initialValue: clip.category)
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

                Section {
                    Picker("Category", selection: $category) {
                        ForEach(store.categories, id: \.self) { cat in
                            Text(cat).tag(cat)
                        }
                        Text("Custom…").tag("__custom__")
                    }

                    if category == "__custom__" || showCustomCategoryField {
                        TextField("Category name", text: $customCategory)
                            .autocorrectionDisabled()
                    }
                } header: {
                    Text("Category")
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
                    .disabled(isSaveDisabled)
                }
            }
            .onChange(of: category) { _, newValue in
                showCustomCategoryField = newValue == "__custom__"
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var resolvedCategory: String {
        if category == "__custom__" {
            return customCategory.trimmingCharacters(in: .whitespaces).isEmpty ? "General" : customCategory.trimmingCharacters(in: .whitespaces)
        }
        return category
    }

    private var isSaveDisabled: Bool {
        if name.isEmpty || command.isEmpty { return true }
        if category == "__custom__" && customCategory.trimmingCharacters(in: .whitespaces).isEmpty { return true }
        return false
    }

    private func save() {
        switch mode {
        case .add:
            store.add(name: name, command: command, category: resolvedCategory)
        case .edit(var clip):
            clip.name = name
            clip.command = command
            clip.category = resolvedCategory
            store.update(clip)
        }
    }
}
