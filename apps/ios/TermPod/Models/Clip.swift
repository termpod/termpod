import Foundation

struct Clip: Identifiable, Codable, Equatable {

    let id: UUID
    var name: String
    var command: String
    var category: String
    var createdAt: Date

    init(id: UUID = UUID(), name: String, command: String, category: String = "General", createdAt: Date = .now) {
        self.id = id
        self.name = name
        self.command = command
        self.category = category
        self.createdAt = createdAt
    }

    // Backward-compatible decoding: existing clips without `category` default to "General"
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        command = try container.decode(String.self, forKey: .command)
        category = try container.decodeIfPresent(String.self, forKey: .category) ?? "General"
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }
}

@MainActor
final class ClipStore: ObservableObject {

    static let shared = ClipStore()

    static let defaultCategories = ["General", "Git", "Docker", "SSH"]

    @Published var clips: [Clip] = [] {
        didSet { save() }
    }

    var categories: [String] {
        let custom = clips.map(\.category).filter { !Self.defaultCategories.contains($0) }
        let unique = Array(NSOrderedSet(array: custom)) as? [String] ?? []
        return Self.defaultCategories + unique
    }

    private static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return dir.appendingPathComponent("termpod-clips.json")
    }

    private init() {
        load()
    }

    func add(name: String, command: String, category: String = "General") {
        clips.append(Clip(name: name, command: command, category: category))
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

    func clips(in category: String) -> [Clip] {
        clips.filter { $0.category == category }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(clips) else { return }

        let url = Self.fileURL

        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        try? data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    private func load() {
        // Migrate from UserDefaults if present
        if let legacyData = UserDefaults.standard.data(forKey: "termpod.clips"),
           let decoded = try? JSONDecoder().decode([Clip].self, from: legacyData) {
            clips = decoded
            save()
            UserDefaults.standard.removeObject(forKey: "termpod.clips")
            return
        }

        guard let data = try? Data(contentsOf: Self.fileURL),
              let decoded = try? JSONDecoder().decode([Clip].self, from: data)
        else { return }

        clips = decoded
    }
}
