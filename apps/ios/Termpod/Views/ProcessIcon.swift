import SwiftUI

// MARK: - SVG Path Shape

/// A SwiftUI Shape that renders an SVG path string within a 24x24 viewBox.
struct SVGPath: Shape {
    let pathData: String

    func path(in rect: CGRect) -> Path {
        let svgPath = parseSVGPath(pathData)
        let scaleX = rect.width / 24
        let scaleY = rect.height / 24

        return svgPath.applying(CGAffineTransform(scaleX: scaleX, y: scaleY))
    }

    private func parseSVGPath(_ d: String) -> Path {
        var path = Path()
        let scanner = Scanner(string: d)
        scanner.charactersToBeSkipped = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ","))

        var currentPoint = CGPoint.zero
        var lastControl = CGPoint.zero
        var lastCommand: Character = "M"

        while !scanner.isAtEnd {
            var command: Character = lastCommand

            // Try to scan a command letter
            let saved = scanner.currentIndex
            if let ch = scanner.scanCharacter(), ch.isLetter {
                command = ch
            } else {
                scanner.currentIndex = saved
                // Implicit repeat of last command (lineTo after moveTo)
                if lastCommand == "M" { command = "L" }
                else if lastCommand == "m" { command = "l" }
                else { command = lastCommand }
            }

            switch command {
            case "M":
                guard let pt = scanPoint(scanner) else { break }
                currentPoint = pt
                path.move(to: pt)
                lastCommand = "M"
            case "m":
                guard let pt = scanPoint(scanner) else { break }
                currentPoint = CGPoint(x: currentPoint.x + pt.x, y: currentPoint.y + pt.y)
                path.move(to: currentPoint)
                lastCommand = "m"
            case "L":
                guard let pt = scanPoint(scanner) else { break }
                currentPoint = pt
                path.addLine(to: pt)
                lastCommand = "L"
            case "l":
                guard let pt = scanPoint(scanner) else { break }
                currentPoint = CGPoint(x: currentPoint.x + pt.x, y: currentPoint.y + pt.y)
                path.addLine(to: currentPoint)
                lastCommand = "l"
            case "H":
                guard let x = scanDouble(scanner) else { break }
                currentPoint.x = x
                path.addLine(to: currentPoint)
                lastCommand = "H"
            case "h":
                guard let dx = scanDouble(scanner) else { break }
                currentPoint.x += dx
                path.addLine(to: currentPoint)
                lastCommand = "h"
            case "V":
                guard let y = scanDouble(scanner) else { break }
                currentPoint.y = y
                path.addLine(to: currentPoint)
                lastCommand = "V"
            case "v":
                guard let dy = scanDouble(scanner) else { break }
                currentPoint.y += dy
                path.addLine(to: currentPoint)
                lastCommand = "v"
            case "C":
                guard let c1 = scanPoint(scanner), let c2 = scanPoint(scanner), let end = scanPoint(scanner) else { break }
                path.addCurve(to: end, control1: c1, control2: c2)
                lastControl = c2
                currentPoint = end
                lastCommand = "C"
            case "c":
                guard let c1 = scanPoint(scanner), let c2 = scanPoint(scanner), let end = scanPoint(scanner) else { break }
                let abs1 = CGPoint(x: currentPoint.x + c1.x, y: currentPoint.y + c1.y)
                let abs2 = CGPoint(x: currentPoint.x + c2.x, y: currentPoint.y + c2.y)
                let absEnd = CGPoint(x: currentPoint.x + end.x, y: currentPoint.y + end.y)
                path.addCurve(to: absEnd, control1: abs1, control2: abs2)
                lastControl = abs2
                currentPoint = absEnd
                lastCommand = "c"
            case "S":
                guard let c2 = scanPoint(scanner), let end = scanPoint(scanner) else { break }
                let c1 = CGPoint(x: 2 * currentPoint.x - lastControl.x, y: 2 * currentPoint.y - lastControl.y)
                path.addCurve(to: end, control1: c1, control2: c2)
                lastControl = c2
                currentPoint = end
                lastCommand = "S"
            case "s":
                guard let c2 = scanPoint(scanner), let end = scanPoint(scanner) else { break }
                let c1 = CGPoint(x: 2 * currentPoint.x - lastControl.x, y: 2 * currentPoint.y - lastControl.y)
                let abs2 = CGPoint(x: currentPoint.x + c2.x, y: currentPoint.y + c2.y)
                let absEnd = CGPoint(x: currentPoint.x + end.x, y: currentPoint.y + end.y)
                path.addCurve(to: absEnd, control1: c1, control2: abs2)
                lastControl = abs2
                currentPoint = absEnd
                lastCommand = "s"
            case "Q":
                guard let ctrl = scanPoint(scanner), let end = scanPoint(scanner) else { break }
                path.addQuadCurve(to: end, control: ctrl)
                lastControl = ctrl
                currentPoint = end
                lastCommand = "Q"
            case "q":
                guard let ctrl = scanPoint(scanner), let end = scanPoint(scanner) else { break }
                let absCtrl = CGPoint(x: currentPoint.x + ctrl.x, y: currentPoint.y + ctrl.y)
                let absEnd = CGPoint(x: currentPoint.x + end.x, y: currentPoint.y + end.y)
                path.addQuadCurve(to: absEnd, control: absCtrl)
                lastControl = absCtrl
                currentPoint = absEnd
                lastCommand = "q"
            case "T":
                guard let end = scanPoint(scanner) else { break }
                let ctrl = CGPoint(x: 2 * currentPoint.x - lastControl.x, y: 2 * currentPoint.y - lastControl.y)
                path.addQuadCurve(to: end, control: ctrl)
                lastControl = ctrl
                currentPoint = end
                lastCommand = "T"
            case "t":
                guard let end = scanPoint(scanner) else { break }
                let ctrl = CGPoint(x: 2 * currentPoint.x - lastControl.x, y: 2 * currentPoint.y - lastControl.y)
                let absEnd = CGPoint(x: currentPoint.x + end.x, y: currentPoint.y + end.y)
                path.addQuadCurve(to: absEnd, control: ctrl)
                lastControl = ctrl
                currentPoint = absEnd
                lastCommand = "t"
            case "A", "a":
                // Simplified: skip arc parameters and move to endpoint
                for _ in 0..<5 { _ = scanDouble(scanner) }
                guard let end = scanPoint(scanner) else { break }
                let absEnd = command == "a"
                    ? CGPoint(x: currentPoint.x + end.x, y: currentPoint.y + end.y)
                    : end
                path.addLine(to: absEnd)
                currentPoint = absEnd
                lastCommand = command
            case "Z", "z":
                path.closeSubpath()
                lastCommand = command
            default:
                break
            }
        }

        return path
    }

    private func scanDouble(_ scanner: Scanner) -> Double? {
        scanner.scanDouble()
    }

    private func scanPoint(_ scanner: Scanner) -> CGPoint? {
        guard let x = scanner.scanDouble(), let y = scanner.scanDouble() else { return nil }
        return CGPoint(x: x, y: y)
    }
}

// MARK: - Icon Data

struct ProcessIconData {
    let title: String
    let color: Color
    let svgPath: String
}

// MARK: - Process Icon Lookup

enum ProcessIconLookup {

    static func icon(for processName: String?) -> ProcessIconData? {
        guard let name = processName else { return nil }
        guard let slug = processMap[name] else { return nil }

        return iconRegistry[slug]
    }

    static let folderIcon = ProcessIconData(
        title: "Folder",
        color: Color(hex: "4A90D9"),
        svgPath: "M10 4H2v16h20V6H12l-2-2z"
    )

    // Process name -> icon slug
    private static let processMap: [String: String] = [
        "git": "git",
        "node": "nodedotjs", "nodejs": "nodedotjs",
        "npm": "npm", "npx": "npm",
        "yarn": "yarn",
        "pnpm": "pnpm",
        "bun": "bun", "bunx": "bun",
        "python": "python", "python3": "python",
        "ruby": "ruby", "irb": "ruby",
        "rustc": "rust", "cargo": "rust",
        "go": "go",
        "java": "openjdk", "javac": "openjdk",
        "php": "php", "composer": "php",
        "swift": "swift", "swiftc": "swift",
        "docker": "docker",
        "bash": "gnubash",
        "vim": "vim", "vi": "vim",
        "nvim": "neovim",
        "emacs": "gnuemacs",
        "make": "cmake", "cmake": "cmake",
        "tmux": "tmux",
        "lua": "lua", "luajit": "lua",
        "psql": "sqlite", "sqlite3": "sqlite",
        "redis-cli": "redis",
        "terraform": "terraform",
        "kubectl": "kubernetes",
        "helm": "helm",
        "deno": "deno",
        "tsc": "typescript",
        "claude": "anthropic",
        "codex": "openai",
        "gemini": "googlegemini",
        "opencode": "opencode",
        "aider": "anthropic",
        "cursor": "cursor",
    ]

    // Icon slug -> icon data (subset of most common icons)
    private static let iconRegistry: [String: ProcessIconData] = [
        "git": ProcessIconData(title: "Git", color: Color(hex: "F05032"), svgPath: "M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187"),
        "nodedotjs": ProcessIconData(title: "Node.js", color: Color(hex: "5FA04E"), svgPath: "M11.998 24c-.321 0-.641-.084-.922-.247l-2.936-1.737c-.438-.245-.224-.332-.08-.383.585-.203.703-.25 1.328-.604.065-.037.151-.023.218.017l2.256 1.339a.29.29 0 0 0 .272 0l8.795-5.076a.277.277 0 0 0 .134-.238V6.921a.28.28 0 0 0-.137-.242L12.137 1.6a.27.27 0 0 0-.27 0L3.08 6.68a.285.285 0 0 0-.139.24v10.15a.27.27 0 0 0 .138.236l2.409 1.392c1.307.654 2.108-.116 2.108-.89V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.112.255.253v10.021c0 1.745-.95 2.745-2.604 2.745-.508 0-.909 0-2.026-.551L2.28 18.675a1.857 1.857 0 0 1-.922-1.604V6.921c0-.659.353-1.275.922-1.603L11.076.242a1.92 1.92 0 0 1 1.846 0l8.794 5.076c.57.329.924.944.924 1.603v10.15a1.86 1.86 0 0 1-.924 1.604l-8.794 5.078a1.836 1.836 0 0 1-.924.247"),
        "python": ProcessIconData(title: "Python", color: Color(hex: "3776AB"), svgPath: "M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05L0 11.97l.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.35.12-.33.2-.28.3-.25.41-.2.54-.14.69-.08.87-.02h3.48zm-2.27 1.17a.97.97 0 0 0-.47.11c-.14.08-.23.2-.26.34-.03.14 0 .27.08.39.08.12.21.2.36.22.14.02.28-.02.4-.11s.2-.22.21-.36c.01-.14-.05-.27-.16-.38a.55.55 0 0 0-.16-.21zM24 13.55V20.9l-.05.56-.15.56-.26.53-.36.49-.46.45-.55.39-.63.32-.7.24-.76.15-.8.06H18.8l-1.54-.05-.7-.14-.58-.22-.47-.28-.38-.33-.3-.36-.22-.37-.17-.36-.1-.33-.07-.28-.03-.22V15.1l.05-.64.13-.54.21-.46.27-.39.32-.32.36-.25.38-.19.39-.14.38-.09.34-.06.3-.03.24-.02H15.3l.68-.05.59-.14.5-.22.41-.27.33-.33.27-.35.2-.37.15-.38.1-.36.07-.32.04-.29.02-.22v-3.06h3.09l.19.02.27.06.33.12.37.19.38.27.37.37.34.47.3.6.26.73.2.89.13 1.04.05 1.23-.06 1.22-.16 1.04-.24.87-.32.71-.37.57-.4.43-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02h-.16l-.06-.01h-8.16v.83h5.07l.01 2.76.02.36-.05.34-.12.33-.2.28-.3.24-.4.2-.54.14-.68.08-.88.02H12.2zM13.77 22.7a.97.97 0 0 1 .47-.11c.17 0 .32.07.43.21a.56.56 0 0 1 .08.57.83.83 0 0 1-.36.22c-.14.04-.28.02-.39-.08a.64.64 0 0 1-.23-.44.56.56 0 0 1 0-.37z"),
        "rust": ProcessIconData(title: "Rust", color: Color(hex: "CE422B"), svgPath: "M23.834 11.703l-1.707-.956a10.654 10.654 0 0 0-.096-.549l1.452-1.268-1.045-1.705-1.88.456a10.632 10.632 0 0 0-.357-.437l.934-1.774-1.48-1.292-1.659.918a10.654 10.654 0 0 0-.512-.287L18.004.87 16.37.38l-1.19 1.525a10.654 10.654 0 0 0-.58-.107L14.096.123 12.39.096 11.94 1.88a10.654 10.654 0 0 0-.58.064L10.023.58 8.413.983l.422 1.91a10.654 10.654 0 0 0-.519.26l-1.555-1.09-1.395 1.39 1.09 1.554a10.654 10.654 0 0 0-.36.43l-1.87-.508L3.29 6.416l1.674 1.07a10.654 10.654 0 0 0-.195.534l-1.915.294-.38 1.635 1.862.445a10.654 10.654 0 0 0-.018.584l-1.855.597.09 1.676 1.932-.108c.04.194.088.386.143.576l-1.68.79.552 1.598 1.882-.348c.094.18.195.356.302.528l-1.39 1.126.977 1.397 1.696-.74c.145.163.296.32.453.47l-.988 1.454 1.348 1.067 1.38-1.078c.182.12.37.234.563.34l-.494 1.68 1.62.617 1.015-1.447c.2.066.404.124.612.175l.077 1.757 1.75.124.587-1.698c.207.012.414.017.622.013l.636 1.648 1.715-.36.148-1.786c.204-.04.406-.089.605-.146l1.166 1.39 1.548-.836-.403-1.761c.185-.1.366-.207.542-.321l1.609.983 1.258-1.247-1.002-1.556c.15-.148.296-.302.434-.462l1.88.392.91-1.597-1.504-1.22a10.654 10.654 0 0 0 .27-.489l1.932-.275.52-1.794-1.783-.704c.047-.195.086-.392.118-.59z"),
        "docker": ProcessIconData(title: "Docker", color: Color(hex: "2496ED"), svgPath: "M13.983 11.078h2.119a.186.186 0 0 0 .186-.185V9.006a.186.186 0 0 0-.186-.186h-2.119a.185.185 0 0 0-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 0 0 .186-.186V3.574a.186.186 0 0 0-.186-.185h-2.118a.185.185 0 0 0-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 0 0 .186-.186V6.29a.186.186 0 0 0-.186-.185h-2.118a.185.185 0 0 0-.185.185v1.887c0 .102.082.186.185.186m-2.93 0h2.12a.186.186 0 0 0 .184-.186V6.29a.185.185 0 0 0-.185-.185H8.1a.185.185 0 0 0-.185.185v1.887c0 .102.083.186.185.186m-2.964 0h2.119a.186.186 0 0 0 .185-.186V6.29a.185.185 0 0 0-.185-.185H5.136a.186.186 0 0 0-.186.185v1.887c0 .102.084.186.186.186m5.893 2.715h2.118a.186.186 0 0 0 .186-.185V9.006a.186.186 0 0 0-.186-.186h-2.118a.185.185 0 0 0-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 0 0 .184-.185V9.006a.185.185 0 0 0-.184-.186h-2.12a.185.185 0 0 0-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 0 0 .185-.185V9.006a.185.185 0 0 0-.185-.186H5.136a.186.186 0 0 0-.186.185v1.888c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 0 0 .184-.185V9.006a.185.185 0 0 0-.184-.186h-2.12a.185.185 0 0 0-.184.186v1.887c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 0 0-.75.748 11.376 11.376 0 0 0 .692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 0 0 3.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"),
        "vim": ProcessIconData(title: "Vim", color: Color(hex: "019733"), svgPath: "M24 12.042c0 .9-.08 1.78-.24 2.628H12.398V24L0 12.222V11.76L12.398 0v9.33H23.76c.16.85.24 1.73.24 2.63v.082z"),
        "neovim": ProcessIconData(title: "Neovim", color: Color(hex: "57A143"), svgPath: "M2.214 4.954v13.615L7.655 24V10.314L3.312 3.845 2.214 4.954zm4.999 17.98l-4.557-4.548V5.136l.59-.596 3.967 5.908v12.485zm14.573-4.457l-.862.937-4.24-6.376V0l5.068 5.092.034 13.385zM7.431.001l12.998 19.835-3.637 3.637L3.787 3.683 7.43 0z"),
        "gnubash": ProcessIconData(title: "Bash", color: Color(hex: "4EAA25"), svgPath: "M2.22 0c-.436 0-.84.227-1.066.593L.075 2.48c-.266.431-.238.98.061 1.388l6.484 8.798L.08 20.17c-.267.413-.282.942-.018 1.361l1.1 1.843c.23.357.624.582 1.052.586h.022c.22 0 .436-.068.619-.193l6.53-4.866 6.53 4.883c.18.124.394.193.612.193h.036c.43-.004.822-.23 1.052-.586l1.092-1.835c.263-.419.249-.948-.034-1.354L12.124 12.7l6.52-8.846c.296-.407.326-.956.061-1.388l-1.09-1.886A1.238 1.238 0 0016.556 0H7.457c-.222 0-.438.066-.62.192l-3.55 2.64c-.259.187-.565.186-.824-.004L2.069.167A1.23 1.23 0 002.22.001z"),
        "anthropic": ProcessIconData(title: "Anthropic", color: Color(hex: "D97757"), svgPath: "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"),
        "googlegemini": ProcessIconData(title: "Gemini", color: Color(hex: "8E75B2"), svgPath: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"),
        "cursor": ProcessIconData(title: "Cursor", color: Color(hex: "6B5CE7"), svgPath: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"),
        "openai": ProcessIconData(title: "OpenAI", color: Color(hex: "412991"), svgPath: "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 10.68.002 6.046 6.046 0 0 0 4.93 3.32a5.985 5.985 0 0 0-4 2.9 6.046 6.046 0 0 0 .744 7.094 5.985 5.985 0 0 0 .516 4.911 6.046 6.046 0 0 0 6.51 2.9 5.985 5.985 0 0 0 4.576 1.963 6.046 6.046 0 0 0 5.75-3.318 5.985 5.985 0 0 0 4-2.9 6.046 6.046 0 0 0-.744-7.094zM13.32 22.45a4.485 4.485 0 0 1-2.876-.997l.143-.081 4.773-2.757a.776.776 0 0 0 .395-.675v-6.736l2.017 1.167a.071.071 0 0 1 .039.054v5.573a4.51 4.51 0 0 1-4.49 4.452zm-9.634-4.082a4.483 4.483 0 0 1-.54-3.017l.143.085 4.773 2.757a.77.77 0 0 0 .787 0l5.829-3.368v2.333a.074.074 0 0 1-.029.06l-4.826 2.789a4.512 4.512 0 0 1-6.137-1.64zM2.478 7.86A4.485 4.485 0 0 1 4.84 5.89l-.002.164v5.513a.775.775 0 0 0 .394.674l5.829 3.365-2.017 1.168a.073.073 0 0 1-.069.006L4.149 13.99a4.514 4.514 0 0 1-1.67-6.13zm16.546 3.856l-5.829-3.366L15.212 7.18a.073.073 0 0 1 .069-.006l4.826 2.789a4.506 4.506 0 0 1-.697 8.128V12.52a.776.776 0 0 0-.387-.676zM20.95 10.7l-.143-.085-4.773-2.757a.77.77 0 0 0-.787 0L9.418 11.23V8.894a.074.074 0 0 1 .029-.06l4.826-2.789a4.505 4.505 0 0 1 6.676 4.658zM8.306 12.77l-2.017-1.168a.071.071 0 0 1-.039-.054V6.02a4.506 4.506 0 0 1 7.389-3.466l-.143.081-4.773 2.757a.776.776 0 0 0-.395.675l-.022 6.703zm1.095-2.36L12 8.836l2.6 1.506v3.009L12 14.856l-2.6-1.506z"),
        "opencode": ProcessIconData(title: "opencode", color: Color(hex: "B7B1B1"), svgPath: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"),
        "go": ProcessIconData(title: "Go", color: Color(hex: "00ADD8"), svgPath: "M2.67 10.48c-.04 0-.07-.02-.05-.06l.27-.34c.02-.03.07-.05.11-.05h4.6c.04 0 .06.03.04.07l-.22.31c-.02.03-.06.06-.1.06l-4.65.01zm-1.76 1.07c-.04 0-.06-.03-.05-.07l.27-.33c.02-.03.07-.06.11-.06h5.88c.04 0 .07.04.05.07l-.11.29c-.01.04-.05.07-.1.07H.91zM4.34 12.62c-.04 0-.06-.03-.04-.07l.17-.33c.02-.03.05-.06.1-.06h2.58c.04 0 .06.03.06.07l-.02.31c0 .04-.04.07-.08.07H4.34z"),
        "openjdk": ProcessIconData(title: "Java", color: Color(hex: "437291"), svgPath: "M8.851 18.56s-.917.534.653.714c.575.085 1.239.134 1.912.134 1.607 0 2.687-.197 3.856-.634l.308.133c-1.525.652-6.425 1.018-6.729-.347zm-.564-1.513s-1.03.762.542.924c.732.076 1.546.076 2.726-.104.41.116.861.337.861.337-1.845.657-7.863.212-5.13-.157zm3.472-2.589c1.01 1.16-.265 2.2-.265 2.2s2.554-1.32 1.382-2.97c-1.094-1.543-1.933-2.31 2.607-4.953 0 0-7.124 1.78-3.724 5.723z"),
        "tmux": ProcessIconData(title: "tmux", color: Color(hex: "1BB91F"), svgPath: "M24 7.325V2.4h-4.925L12 9.475 4.925 2.4H0v4.925L7.025 14.4 0 21.425V24h2.525L12 14.925 21.475 24H24v-2.575L14.925 14.4 24 7.325z"),
        "typescript": ProcessIconData(title: "TypeScript", color: Color(hex: "3178C6"), svgPath: "M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z"),
        "redis": ProcessIconData(title: "Redis", color: Color(hex: "FF4438"), svgPath: "M23.99 14.26c-.012.636-1.039 1.27-3.402 2.152l-4.186 1.563L12.12 20.1c-.72.273-1.685.27-2.396-.005L5.46 18.0l-4.2-1.538C.012 15.83-.013 15.23.003 14.6l-.003.26v2.56c0 .639 1.025 1.27 3.4 2.152l4.2 1.538c.711.275 1.675.278 2.396.005l4.282-2.125 4.186-1.563c2.363-.883 3.414-1.516 3.402-2.152v-2.56l.127.486z"),
    ]
}

// MARK: - SwiftUI View

struct ProcessIconView: View {
    let processName: String?
    var size: CGFloat = 20

    var body: some View {
        let iconData = ProcessIconLookup.icon(for: processName) ?? ProcessIconLookup.folderIcon

        SVGPath(pathData: iconData.svgPath)
            .fill(iconData.color)
            .frame(width: size, height: size)
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let scanner = Scanner(string: hex)
        var rgbValue: UInt64 = 0
        scanner.scanHexInt64(&rgbValue)

        let r = Double((rgbValue & 0xFF0000) >> 16) / 255.0
        let g = Double((rgbValue & 0x00FF00) >> 8) / 255.0
        let b = Double(rgbValue & 0x0000FF) / 255.0

        self.init(red: r, green: g, blue: b)
    }
}
