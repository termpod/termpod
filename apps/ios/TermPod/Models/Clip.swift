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

    private static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return dir.appendingPathComponent("termpod-clips.json")
    }

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

        let url = Self.fileURL

        // Ensure directory exists
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
