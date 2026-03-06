import SwiftTerm
import UIKit

/// A terminal view that receives data from a remote WebSocket relay
/// and sends user input back to it.
///
/// Uses data batching to prevent cursor ghosting in TUI apps: incoming data
/// is accumulated and fed to SwiftTerm once per display frame, avoiding
/// intermediate cursor positions that leave white artifacts.
class RemoteTerminalView: TerminalView {

    private var relay: RelayClient?

    // Data batching to prevent cursor ghosting in TUI apps.
    // Without batching, rapid small chunks (e.g. cursor movement sequences)
    // cause intermediate cursor positions that aren't fully redrawn before
    // the next update, leaving white artifacts at old positions.
    private var pendingData = Data()
    private var flushScheduled = false

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
            self?.enqueueData(data)
        }

        relay.onResize = { [weak self] cols, rows in
            DispatchQueue.main.async {
                self?.getTerminal().resize(cols: cols, rows: rows)
            }
        }
    }

    /// Accumulate incoming data and schedule a single flush per run loop cycle.
    /// This coalesces rapid small messages (cursor moves, partial redraws) into
    /// one feed() call, so SwiftTerm only processes one set of cursor updates
    /// per display frame.
    private func enqueueData(_ data: Data) {
        pendingData.append(data)

        if !flushScheduled {
            flushScheduled = true
            DispatchQueue.main.async { [weak self] in
                self?.flushPendingData()
            }
        }
    }

    private func flushPendingData() {
        flushScheduled = false
        guard !pendingData.isEmpty else { return }

        let batch = pendingData
        pendingData = Data()

        feed(byteArray: ArraySlice<UInt8>(batch))

        // Force full redraw to clear ghost cursor artifacts.
        // SwiftTerm's updateDisplay() skips setNeedsDisplay when only the cursor
        // moved (getUpdateRange() returns nil), leaving stale CaretView imprints.
        setNeedsDisplay()
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
        // Don't send resize to relay — desktop PTY dimensions are authoritative
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
