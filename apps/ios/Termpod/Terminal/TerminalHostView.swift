import SwiftUI
import SwiftTerm

/// SwiftUI wrapper around the native SwiftTerm TerminalView.
/// Lets SwiftTerm auto-size cols/rows from the physical frame — the mobile
/// device sends its dimensions to the relay so the PTY adapts.
struct TerminalHostView: UIViewRepresentable {

    let relay: RelayClient

    func makeUIView(context: Context) -> RemoteTerminalView {
        let terminalView = RemoteTerminalView(frame: .zero, relay: relay)
        // Don't force desktop PTY dimensions — SwiftTerm calculates cols/rows
        // from layoutSubviews → processSizeChange, then sizeChanged delegate
        // sends resize to relay so the PTY adapts to mobile screen.
        DispatchQueue.main.async {
            _ = terminalView.becomeFirstResponder()
        }
        return terminalView
    }

    func updateUIView(_ uiView: RemoteTerminalView, context: Context) {
        // Data flows via relay callbacks, no SwiftUI-driven updates needed
    }
}
