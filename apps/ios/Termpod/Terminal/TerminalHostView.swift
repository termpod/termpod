import SwiftUI
import SwiftTerm

/// SwiftUI wrapper around the native SwiftTerm TerminalView.
struct TerminalHostView: UIViewRepresentable {

    let relay: RelayClient

    func makeUIView(context: Context) -> RemoteTerminalView {
        let terminalView = RemoteTerminalView(frame: .zero, relay: relay)
        // Resize to match desktop PTY dimensions
        let size = relay.ptySize
        terminalView.getTerminal().resize(cols: size.cols, rows: size.rows)
        // Become first responder so keyboard input works immediately
        DispatchQueue.main.async {
            _ = terminalView.becomeFirstResponder()
        }
        return terminalView
    }

    func updateUIView(_ uiView: RemoteTerminalView, context: Context) {
        // Data flows via relay callbacks, no SwiftUI-driven updates needed
    }
}
