import SwiftTerm
import UIKit

/// A terminal view that receives data from a remote WebSocket relay
/// and sends user input back to it.
///
/// Feeds relay data immediately (no batching delay) for responsive typing,
/// and coalesces setNeedsDisplay() once per frame to fix cursor ghosting.
class RemoteTerminalView: TerminalView {

    private var connection: ConnectionManager?

    // Coalesce setNeedsDisplay calls — one per frame is enough to fix
    // cursor ghosting without the latency cost of data batching.
    private var needsFullRedraw = false

    // Accumulated scroll delta for smooth line-by-line scrolling
    private var scrollAccumulator: CGFloat = 0

    init(frame: CGRect, connection: ConnectionManager) {
        self.connection = connection
        super.init(frame: frame)
        _ = Self.swizzleOnce
        self.terminalDelegate = self

        // Appearance
        let fontSize: CGFloat = 13
        self.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        self.nativeForegroundColor = UIColor(red: 0.80, green: 0.83, blue: 0.90, alpha: 1)
        self.nativeBackgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.13, alpha: 1)
        self.optionAsMetaKey = true
        self.inputAccessoryView = nil

        setupScrollGesture()
        wireConnection(connection)
    }

    private func setupScrollGesture() {
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleScrollPan(_:)))
        pan.minimumNumberOfTouches = 2
        pan.maximumNumberOfTouches = 2
        addGestureRecognizer(pan)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleFocusTap))
        tap.numberOfTapsRequired = 1
        addGestureRecognizer(tap)
    }

    @objc private func handleFocusTap() {
        NotificationCenter.default.post(name: .terminalTapped, object: nil)
    }

    @objc private func handleScrollPan(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: self)
        gesture.setTranslation(.zero, in: self)

        let cellHeight = self.font.lineHeight
        scrollAccumulator += -translation.y

        let lines = Int(scrollAccumulator / cellHeight)
        if lines != 0 {
            scrollAccumulator -= CGFloat(lines) * cellHeight
            if lines > 0 {
                scrollUp(lines: lines)
            } else {
                scrollDown(lines: abs(lines))
            }
        }

        if gesture.state == .ended || gesture.state == .cancelled {
            scrollAccumulator = 0
        }
    }

    // Prevent terminal from stealing keyboard focus — input goes
    // through the CommandInputBar text field instead.
    override var canBecomeFirstResponder: Bool { true }


    required init?(coder: NSCoder) {
        fatalError("init(coder:) not implemented")
    }

    func updateConnection(_ connection: ConnectionManager) {
        self.connection = connection
        wireConnection(connection)
    }

    private func wireConnection(_ connection: ConnectionManager) {
        connection.onTerminalData = { [weak self] data in
            guard let self else { return }
            self.feed(byteArray: ArraySlice<UInt8>(data))
            self.scheduleFullRedraw()
        }

        // Don't set connection.onResize — mobile manages its own dimensions.
        // SwiftTerm auto-sizes from the physical frame in layoutSubviews,
        // then sizeChanged sends the mobile dimensions to the connection.
    }

    // MARK: - Suppress iOS composing text preview

    /// Swizzle firstRect(for:) and caretRect(for:) at runtime to move the
    /// iOS inline composition overlay off-screen.  SwiftTerm marks these
    /// `public` (not `open`), so a normal `override` is not allowed.
    private static let swizzleOnce: Void = {
        let cls: AnyClass = RemoteTerminalView.self

        // firstRect(for:)
        if let original = class_getInstanceMethod(cls, #selector(TerminalView.firstRect(for:))),
           let replacement = class_getInstanceMethod(cls, #selector(RemoteTerminalView._swizzled_firstRect(for:))) {
            method_exchangeImplementations(original, replacement)
        }

        // caretRect(for:)
        if let original = class_getInstanceMethod(cls, #selector(TerminalView.caretRect(for:))),
           let replacement = class_getInstanceMethod(cls, #selector(RemoteTerminalView._swizzled_caretRect(for:))) {
            method_exchangeImplementations(original, replacement)
        }
    }()

    @objc private func _swizzled_firstRect(for range: UITextRange) -> CGRect {
        return CGRect(x: 0, y: -1000, width: 0, height: 0)
    }

    @objc private func _swizzled_caretRect(for position: UITextPosition) -> CGRect {
        return CGRect(x: 0, y: -1000, width: 0, height: 0)
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

    /// Called when the user types — send input through best transport
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        connection?.sendInput(Data(data))
    }

    func scrolled(source: TerminalView, position: Double) {}

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
        connection?.sendResize(cols: newCols, rows: newRows)
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
    static let terminalTapped = Notification.Name("terminalTapped")
}
