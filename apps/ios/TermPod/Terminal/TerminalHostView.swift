import SwiftUI
import SwiftTerm

/// SwiftUI wrapper around the native SwiftTerm TerminalView.
/// Lets SwiftTerm auto-size cols/rows from the physical frame — the mobile
/// device sends its dimensions to the relay so the PTY adapts.
struct TerminalHostView: UIViewRepresentable {

    let connection: ConnectionManager
    @EnvironmentObject private var settings: TerminalSettings

    func makeUIView(context: Context) -> RemoteTerminalView {
        let terminalView = RemoteTerminalView(frame: .zero, connection: connection)
        terminalView.settingsRef = settings
        terminalView.applySettings(settings)
        connection.terminalView = terminalView
        return terminalView
    }

    func updateUIView(_ uiView: RemoteTerminalView, context: Context) {
        uiView.settingsRef = settings
        uiView.applySettings(settings)
    }
}
