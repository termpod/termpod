import Foundation

struct Clip: Identifiable, Codable, Equatable {

    let id: UUID
    var name: String
    var command: String
    var createdAt: Date

    init(id: UUID = UUID(), name: String, command: String, createdAt: Date = .now) {
        self.id = id
        self.name = name
        self.command = command
        self.createdAt = createdAt
    }
}

@MainActor
final class ClipStore: ObservableObject {

    static let shared = ClipStore()

    @Published var clips: [Clip] = [] {
        didSet { save() }
    }

    private let key = "termpod.clips"

    private init() {
        load()
    }

    func add(name: String, command: String) {
        clips.append(Clip(name: name, command: command))
    }

    func update(_ clip: Clip) {
        guard let index = clips.firstIndex(where: { $0.id == clip.id }) else { return }
        clips[index] = clip
    }

    func delete(_ clip: Clip) {
        clips.removeAll { $0.id == clip.id }
    }

    func move(from source: IndexSet, to destination: Int) {
        clips.move(fromOffsets: source, toOffset: destination)
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(clips) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([Clip].self, from: data)
        else { return }
        clips = decoded
    }
}
