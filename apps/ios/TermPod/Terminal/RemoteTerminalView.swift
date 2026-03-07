import SwiftTerm
import UIKit

/// A terminal view that receives data from a remote WebSocket relay
/// and sends user input back to it.
///
/// Feeds relay data immediately (no batching delay) for responsive typing,
/// and coalesces setNeedsDisplay() once per frame to fix cursor ghosting.
class RemoteTerminalView: TerminalView {

    private var connection: ConnectionManager?
    weak var settingsRef: TerminalSettings?

    // Track applied settings to avoid redundant updates
    private var appliedFontSize: Double = 0
    private var appliedFontFamily: String = ""
    private var appliedThemeId: String = ""

    // Coalesce setNeedsDisplay calls — one per frame is enough to fix
    // cursor ghosting without the latency cost of data batching.
    private var needsFullRedraw = false

    // Accumulated scroll delta for smooth line-by-line scrolling
    private var scrollAccumulator: CGFloat = 0

    // Pinch-to-zoom state
    private var pinchBaseFontSize: CGFloat = 13

    init(frame: CGRect, connection: ConnectionManager) {
        self.connection = connection
        super.init(frame: frame)
        _ = Self.swizzleOnce
        self.terminalDelegate = self
        self.optionAsMetaKey = true
        self.inputAccessoryView = nil

        setupScrollGesture()
        setupPinchGesture()
        setupDragArrowGesture()
        wireConnection(connection)
    }

    // MARK: - Settings

    func applySettings(_ settings: TerminalSettings) {
        let theme = settings.currentTheme

        let fontChanged = settings.fontSize != appliedFontSize
            || settings.fontFamily.rawValue != appliedFontFamily
        let themeChanged = settings.themeName != appliedThemeId

        if fontChanged {
            self.font = settings.uiFont
            appliedFontSize = settings.fontSize
            appliedFontFamily = settings.fontFamily.rawValue
        }

        if themeChanged {
            self.nativeForegroundColor = theme.foreground
            self.nativeBackgroundColor = theme.background
            if theme.ansiColors.count == 16 {
                self.installColors(theme.ansiColors.map { $0.toSwiftTermColor() })
            }
            appliedThemeId = settings.themeName
        }

        if fontChanged || themeChanged {
            setNeedsDisplay()
        }
    }

    // MARK: - Gestures

    private func setupScrollGesture() {
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleScrollPan(_:)))
        pan.minimumNumberOfTouches = 2
        pan.maximumNumberOfTouches = 2
        pan.delegate = self
        addGestureRecognizer(pan)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleFocusTap))
        tap.numberOfTapsRequired = 1
        addGestureRecognizer(tap)
    }

    private func setupPinchGesture() {
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        pinch.delegate = self
        addGestureRecognizer(pinch)
    }

    private func setupDragArrowGesture() {
        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleDragArrow(_:)))
        longPress.minimumPressDuration = 0.3
        longPress.delegate = self
        addGestureRecognizer(longPress)
    }

    @objc private func handleFocusTap() {
        NotificationCenter.default.post(name: .terminalTapped, object: nil)
        _ = becomeFirstResponder()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self, self.window != nil else { return }
            _ = self.becomeFirstResponder()
        }
        // Nudge resize triggers SIGWINCH on the desktop, causing a full
        // redraw so fresh output flows to this newly attached view.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, self.window != nil else { return }
            self.connection?.sendNudgeResize()
        }
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

    @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
        switch gesture.state {
        case .began:
            pinchBaseFontSize = CGFloat(settingsRef?.fontSize ?? 13)

        case .changed:
            let newSize = pinchBaseFontSize * gesture.scale
            let clamped = min(max(newSize, 8), 24)
            self.font = UIFont.monospacedSystemFont(ofSize: clamped, weight: .regular)
            appliedFontSize = Double(clamped)

        case .ended, .cancelled:
            let finalSize = Double(min(max(pinchBaseFontSize * gesture.scale, 8), 24)).rounded()
            settingsRef?.setFontSize(finalSize)
            self.font = settingsRef?.uiFont ?? UIFont.monospacedSystemFont(ofSize: finalSize, weight: .regular)
            appliedFontSize = finalSize
            appliedFontFamily = settingsRef?.fontFamily.rawValue ?? ""

        default:
            break
        }
    }

    // Hold-and-drag arrow gesture
    private var dragAccumulator: CGPoint = .zero
    private let dragThreshold: CGFloat = 20

    @objc private func handleDragArrow(_ gesture: UILongPressGestureRecognizer) {
        switch gesture.state {
        case .began:
            dragAccumulator = .zero
            HapticService.shared.playTap()

        case .changed:
            let location = gesture.location(in: self)

            if dragAccumulator == .zero {
                dragAccumulator = location
                return
            }

            let currentDelta = CGPoint(
                x: location.x - dragAccumulator.x,
                y: location.y - dragAccumulator.y
            )

            if abs(currentDelta.x) > dragThreshold {
                let arrow: [UInt8] = currentDelta.x > 0
                    ? [0x1B, 0x5B, 0x43]  // right
                    : [0x1B, 0x5B, 0x44]  // left
                connection?.sendInput(Data(arrow))
                HapticService.shared.playTap()
                dragAccumulator.x = location.x
            }

            if abs(currentDelta.y) > dragThreshold {
                let arrow: [UInt8] = currentDelta.y > 0
                    ? [0x1B, 0x5B, 0x42]  // down
                    : [0x1B, 0x5B, 0x41]  // up
                connection?.sendInput(Data(arrow))
                HapticService.shared.playTap()
                dragAccumulator.y = location.y
            }

        default:
            break
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

        // Replay buffered terminal data so re-entering a session
        // shows existing content instead of a blank screen.
        connection.replayScrollback()
    }

    // MARK: - Suppress iOS composing text preview

    /// Swizzle firstRect(for:) and caretRect(for:) at runtime to move the
    /// iOS inline composition overlay off-screen.  SwiftTerm marks these
    /// `public` (not `open`), so a normal `override` is not allowed.
    private static let swizzleOnce: Void = {
        let cls: AnyClass = RemoteTerminalView.self

        if let original = class_getInstanceMethod(cls, #selector(TerminalView.firstRect(for:))),
           let replacement = class_getInstanceMethod(cls, #selector(RemoteTerminalView._swizzled_firstRect(for:))) {
            method_exchangeImplementations(original, replacement)
        }

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

// MARK: - UIGestureRecognizerDelegate

extension RemoteTerminalView: UIGestureRecognizerDelegate {

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        // Allow pinch and pan to coexist
        if gestureRecognizer is UIPinchGestureRecognizer || otherGestureRecognizer is UIPinchGestureRecognizer {
            return true
        }
        return false
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
            object: self,
            userInfo: ["title": title]
        )
    }

    func bell(source: TerminalView) {
        NotificationCenter.default.post(name: .terminalBell, object: self)
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
    static let terminalBell = Notification.Name("terminalBell")
}
