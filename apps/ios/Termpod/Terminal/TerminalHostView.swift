import SwiftUI
import SwiftTerm

/// SwiftUI wrapper around the native SwiftTerm TerminalView.
/// Lets SwiftTerm auto-size cols/rows from the physical frame — the mobile
/// device sends its dimensions to the relay so the PTY adapts.
struct TerminalHostView: UIViewRepresentable {

    let connection: ConnectionManager

    func makeUIView(context: Context) -> RemoteTerminalView {
        let terminalView = RemoteTerminalView(frame: .zero, connection: connection)
        // Don't auto-focus terminal — keyboard input goes to the
        // CommandInputBar text field for instant typing feedback.
        return terminalView
    }

    func updateUIView(_ uiView: RemoteTerminalView, context: Context) {
        // Data flows via connection callbacks, no SwiftUI-driven updates needed
    }
}
