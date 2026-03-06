import SwiftTerm
import UIKit

/// A terminal view that receives data from a remote WebSocket relay
/// and sends user input back to it.
///
/// Feeds relay data immediately (no batching delay) for responsive typing,
/// and coalesces setNeedsDisplay() once per frame to fix cursor ghosting.
class RemoteTerminalView: TerminalView {

    private var relay: RelayClient?

    // Coalesce setNeedsDisplay calls — one per frame is enough to fix
    // cursor ghosting without the latency cost of data batching.
    private var needsFullRedraw = false

    init(frame: CGRect, relay: RelayClient) {
        self.relay = relay
        super.init(frame: frame)
        self.terminalDelegate = self

        // Appearance
        let fontSize: CGFloat = 13
        self.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        self.nativeForegroundColor = UIColor(red: 0.80, green: 0.83, blue: 0.90, alpha: 1)
        self.nativeBackgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.13, alpha: 1)
        self.optionAsMetaKey = true

        wireRelay(relay)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) not implemented")
    }

    func updateRelay(_ relay: RelayClient) {
        self.relay = relay
        wireRelay(relay)
    }

    private func wireRelay(_ relay: RelayClient) {
        relay.onTerminalData = { [weak self] data in
            guard let self else { return }
            // Feed immediately — no batching delay. This is critical for typing
            // responsiveness: echoed keystrokes appear without waiting an extra
            // run loop cycle.
            self.feed(byteArray: ArraySlice<UInt8>(data))
            self.scheduleFullRedraw()
        }

        // Don't set relay.onResize — mobile manages its own dimensions.
        // SwiftTerm auto-sizes from the physical frame in layoutSubviews,
        // then sizeChanged sends the mobile dimensions to the relay.
    }

    /// Schedule a single setNeedsDisplay() per frame to fix cursor ghosting.
    /// SwiftTerm's updateDisplay() skips setNeedsDisplay when only the cursor
    /// moved (getUpdateRange() returns nil), leaving stale CaretView imprints.
    /// Coalescing avoids redundant redraws when many messages arrive per frame.
    private func scheduleFullRedraw() {
        guard !needsFullRedraw else { return }
        needsFullRedraw = true

        DispatchQueue.main.async { [weak self] in
            guard let self, self.needsFullRedraw else { return }
            self.needsFullRedraw = false
            self.setNeedsDisplay()
        }
    }
}

// MARK: - TerminalViewDelegate

extension RemoteTerminalView: TerminalViewDelegate {

    /// Called when the user types — send input to relay
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        relay?.sendInput(Data(data))
    }

    func scrolled(source: TerminalView, position: Double) {
        // Optional: track scroll position
    }

    func setTerminalTitle(source: TerminalView, title: String) {
        NotificationCenter.default.post(
            name: .terminalTitleChanged,
            object: nil,
            userInfo: ["title": title]
        )
    }

    func bell(source: TerminalView) {
        HapticService.shared.playBell()
    }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        // Send mobile dimensions to relay so the PTY adapts.
        // This lets TUI apps (Claude Code, vim, htop) render correctly
        // for the mobile screen size.
        relay?.sendResize(cols: newCols, rows: newRows)
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        if let url = URL(string: link) {
            UIApplication.shared.open(url)
        }
    }

    func clipboardCopy(source: TerminalView, content: Data) {
        if let text = String(data: content, encoding: .utf8) {
            UIPasteboard.general.string = text
        }
    }

    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}

    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

extension Notification.Name {
    static let terminalTitleChanged = Notification.Name("terminalTitleChanged")
}
