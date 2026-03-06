import Foundation

/// Decoded from a QR code scanned on the mobile device.
/// QR payload is a URL: termpod://pair?relay=wss://termpod.swapnil.dev&session=<sessionId>
struct PairingToken {

    let wsURL: URL
    let sessionId: String
    let sessionName: String?

    init?(from qrString: String) {
        guard let components = URLComponents(string: qrString),
              components.scheme == "termpod",
              components.host == "pair",
              let queryItems = components.queryItems,
              let relay = queryItems.first(where: { $0.name == "relay" })?.value,
              let sessionId = queryItems.first(where: { $0.name == "session" })?.value
        else {
            return nil
        }

        // Build WebSocket URL: relay + /sessions/<sessionId>/ws
        guard let wsURL = URL(string: "\(relay)/sessions/\(sessionId)/ws") else {
            return nil
        }

        self.wsURL = wsURL
        self.sessionId = sessionId
        self.sessionName = queryItems.first(where: { $0.name == "name" })?.value
    }
}
