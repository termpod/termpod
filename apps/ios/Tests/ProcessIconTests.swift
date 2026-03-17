import XCTest
@testable import TermPod

final class ProcessIconTests: XCTestCase {

    // MARK: - Exact Match

    func testExactMatchNode() {
        let icon = ProcessIconLookup.icon(for: "node")
        XCTAssertNotNil(icon)
        XCTAssertEqual(icon?.title, "Node.js")
    }

    func testExactMatchGit() {
        let icon = ProcessIconLookup.icon(for: "git")
        XCTAssertNotNil(icon)
        XCTAssertEqual(icon?.title, "Git")
    }

    func testExactMatchPython3() {
        let icon = ProcessIconLookup.icon(for: "python3")
        XCTAssertNotNil(icon)
        XCTAssertEqual(icon?.title, "Python")
    }

    func testExactMatchClaude() {
        let icon = ProcessIconLookup.icon(for: "claude")
        XCTAssertNotNil(icon)
        XCTAssertEqual(icon?.title, "Claude")
    }

    func testNilProcessName() {
        XCTAssertNil(ProcessIconLookup.icon(for: nil))
    }

    func testUnknownProcess() {
        XCTAssertNil(ProcessIconLookup.icon(for: "totally-unknown-process"))
    }

    // MARK: - Fuzzy Match: Strip Trailing Digits/Dots

    func testFuzzyMatchPython312() {
        let icon = ProcessIconLookup.icon(for: "python3.12")
        XCTAssertNotNil(icon, "python3.12 should fuzzy match to python")
        XCTAssertEqual(icon?.title, "Python")
    }

    func testFuzzyMatchPython311() {
        let icon = ProcessIconLookup.icon(for: "python3.11")
        XCTAssertNotNil(icon)
        XCTAssertEqual(icon?.title, "Python")
    }

    func testFuzzyMatchNode20() {
        let icon = ProcessIconLookup.icon(for: "node20")
        XCTAssertNotNil(icon, "node20 should fuzzy match to node")
        XCTAssertEqual(icon?.title, "Node.js")
    }

    // MARK: - Fuzzy Match: Strip After Dash

    func testFuzzyMatchDashVersionWithIconInRegistry() {
        // "docker-compose" → base "docker" → slug "docker" → in iconRegistry
        let icon = ProcessIconLookup.icon(for: "docker-compose")
        XCTAssertNotNil(icon, "docker-compose should fuzzy match to docker")
        XCTAssertEqual(icon?.title, "Docker")
    }

    func testFuzzyMatchDashVersionGo() {
        // go is in processMap and iconRegistry
        let icon = ProcessIconLookup.icon(for: "go-1.21")
        XCTAssertNotNil(icon, "go-1.21 should fuzzy match to go")
        XCTAssertEqual(icon?.title, "Go")
    }

    // MARK: - Fuzzy Match: No False Positives

    func testFuzzyMatchDoesNotMatchGarbage() {
        XCTAssertNil(ProcessIconLookup.icon(for: "xyz123"))
    }

    func testFuzzyMatchDoesNotMatchPartialOverlap() {
        // "nod" is not in the map
        XCTAssertNil(ProcessIconLookup.icon(for: "nod"))
    }

    // MARK: - Folder Icon

    func testFolderIconExists() {
        XCTAssertEqual(ProcessIconLookup.folderIcon.title, "Folder")
        XCTAssertFalse(ProcessIconLookup.folderIcon.svgPath.isEmpty)
    }

    // MARK: - SVG Path Caching

    func testSVGPathCachingReturnsSamePath() {
        let pathData = "M10 4H2v16h20V6H12l-2-2z"
        let shape1 = SVGPath(pathData: pathData)
        let shape2 = SVGPath(pathData: pathData)

        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path1 = shape1.path(in: rect)
        let path2 = shape2.path(in: rect)

        XCTAssertEqual(path1.boundingRect, path2.boundingRect)
    }

    func testSVGPathDifferentDataReturnsDifferentPaths() {
        let shape1 = SVGPath(pathData: "M0 0L24 24")
        let shape2 = SVGPath(pathData: "M0 24L24 0")

        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path1 = shape1.path(in: rect)
        let path2 = shape2.path(in: rect)

        // Different paths should produce different results
        XCTAssertNotEqual(path1.description, path2.description)
    }

    func testSVGPathScalesToRect() {
        let shape = SVGPath(pathData: "M0 0L24 24")

        let smallRect = CGRect(x: 0, y: 0, width: 12, height: 12)
        let largeRect = CGRect(x: 0, y: 0, width: 48, height: 48)

        let smallPath = shape.path(in: smallRect)
        let largePath = shape.path(in: largeRect)

        // Large rect should produce a larger bounding rect
        XCTAssertGreaterThan(largePath.boundingRect.width, smallPath.boundingRect.width)
    }
}
