import Foundation
import XCTest
@testable import TermPod

final class KeychainServiceTests: XCTestCase {

    private let testKey = "termpod-test-key-\(UUID().uuidString)"

    override func tearDown() {
        super.tearDown()
        KeychainService.delete(key: testKey)
    }

    func testSaveAndLoad() {
        KeychainService.save(key: testKey, value: "hello-world")
        let loaded = KeychainService.load(key: testKey)
        XCTAssertEqual(loaded, "hello-world")
    }

    func testLoadNonexistentKeyReturnsNil() {
        let loaded = KeychainService.load(key: "nonexistent-key-\(UUID().uuidString)")
        XCTAssertNil(loaded)
    }

    func testDeleteRemovesValue() {
        KeychainService.save(key: testKey, value: "to-delete")
        KeychainService.delete(key: testKey)
        let loaded = KeychainService.load(key: testKey)
        XCTAssertNil(loaded)
    }

    func testSaveOverwritesExistingValue() {
        KeychainService.save(key: testKey, value: "first")
        KeychainService.save(key: testKey, value: "second")
        let loaded = KeychainService.load(key: testKey)
        XCTAssertEqual(loaded, "second")
    }

    func testSaveEmptyString() {
        KeychainService.save(key: testKey, value: "")
        let loaded = KeychainService.load(key: testKey)
        XCTAssertEqual(loaded, "")
    }

    func testSaveLongValue() {
        let longValue = String(repeating: "a", count: 10_000)
        KeychainService.save(key: testKey, value: longValue)
        let loaded = KeychainService.load(key: testKey)
        XCTAssertEqual(loaded, longValue)
    }

    func testSaveUnicodeValue() {
        let unicode = "Hello 🌍 café résumé 日本語"
        KeychainService.save(key: testKey, value: unicode)
        let loaded = KeychainService.load(key: testKey)
        XCTAssertEqual(loaded, unicode)
    }

    func testDeleteNonexistentKeyDoesNotCrash() {
        KeychainService.delete(key: "definitely-not-stored-\(UUID().uuidString)")
        // No crash = pass
    }
}
