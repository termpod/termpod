import Foundation

#if canImport(LiveKitWebRTC)
import LiveKitWebRTC

/// WebRTC DataChannel transport for cross-network P2P communication.
/// Signaling flows through the relay; data flows directly peer-to-peer.
@MainActor
final class WebRTCTransport: NSObject, Transport {

    let transportType: TransportType = .webrtc

    var isConnected: Bool { dataChannel?.readyState == .open }

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?
    var onControlMessage: (([String: Any]) -> Void)?

    /// Called when we need to send signaling messages through the relay.
    var sendSignaling: (([String: Any]) -> Void)?

    private var peerConnection: LKRTCPeerConnection?
    private var dataChannel: LKRTCDataChannel?
    private let clientId: String
    private var remoteClientId: String?

    private static let factory: LKRTCPeerConnectionFactory = {
        LKRTCInitializeSSL()
        return LKRTCPeerConnectionFactory()
    }()

    init(clientId: String) {
        self.clientId = clientId
        super.init()
    }

    // MARK: - Signaling

    func handleSignaling(_ json: [String: Any]) {
        guard let type = json["type"] as? String else { return }

        switch type {
        case "webrtc_offer":
            guard let sdp = json["sdp"] as? String,
                  let from = json["fromClientId"] as? String
            else { return }

            remoteClientId = from
            handleOffer(sdp: sdp, from: from)

        case "webrtc_answer":
            guard let sdp = json["sdp"] as? String else { return }
            handleAnswer(sdp: sdp)

        case "webrtc_ice":
            guard let candidate = json["candidate"] as? String else { return }
            let sdpMid = json["sdpMid"] as? String
            let sdpMLineIndex = json["sdpMLineIndex"] as? Int32 ?? 0
            handleIceCandidate(candidate: candidate, sdpMid: sdpMid, sdpMLineIndex: sdpMLineIndex)

        default:
            break
        }
    }

    private func handleOffer(sdp: String, from: String) {
        let pc = createPeerConnection()
        let remoteSdp = LKRTCSessionDescription(type: .offer, sdp: sdp)

        pc.setRemoteDescription(remoteSdp) { [weak self] error in
            guard let self, error == nil else { return }

            pc.answer(for: Self.defaultConstraints()) { [weak self] answer, error in
                guard let self, let answer, error == nil else { return }

                pc.setLocalDescription(answer) { [weak self] error in
                    guard let self, error == nil else { return }

                    Task { @MainActor in
                        self.sendSignaling?([
                            "type": "webrtc_answer",
                            "sdp": answer.sdp,
                            "fromClientId": self.clientId,
                            "toClientId": from,
                        ])
                    }
                }
            }
        }
    }

    private func handleAnswer(sdp: String) {
        let remoteSdp = LKRTCSessionDescription(type: .answer, sdp: sdp)
        peerConnection?.setRemoteDescription(remoteSdp) { error in
            let _ = error
        }
    }

    private func handleIceCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        let iceCandidate = LKRTCIceCandidate(sdp: candidate, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        peerConnection?.add(iceCandidate)
    }

    private func createPeerConnection() -> LKRTCPeerConnection {
        peerConnection?.close()

        let config = LKRTCConfiguration()
        config.iceServers = [
            LKRTCIceServer(urlStrings: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun.cloudflare.com:3478",
            ]),
        ]
        config.sdpSemantics = .unifiedPlan

        let constraints = LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let pc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self)!
        peerConnection = pc

        return pc
    }

    private static func defaultConstraints() -> LKRTCMediaConstraints {
        LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
    }

    // MARK: - Control Messages

    func sendControlMessage(_ msg: [String: Any]) {
        guard let dc = dataChannel, dc.readyState == .open,
              let data = try? JSONSerialization.data(withJSONObject: msg),
              let str = String(data: data, encoding: .utf8)
        else { return }

        dc.sendData(LKRTCDataBuffer(data: Data(str.utf8), isBinary: false))
    }

    // MARK: - Transport

    func sendInput(_ data: Data) {
        guard let dc = dataChannel, dc.readyState == .open else { return }

        var frame = Data([0x00])
        frame.append(data)
        dc.sendData(LKRTCDataBuffer(data: frame, isBinary: true))
    }

    func sendResize(cols: Int, rows: Int) {
        guard let dc = dataChannel, dc.readyState == .open else { return }

        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)
        dc.sendData(LKRTCDataBuffer(data: frame, isBinary: true))
    }

    func disconnect() {
        dataChannel?.close()
        peerConnection?.close()
        dataChannel = nil
        peerConnection = nil
    }
}

extension WebRTCTransport: LKRTCPeerConnectionDelegate {
    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didChange state: LKRTCSignalingState) {}
    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didAdd stream: LKRTCMediaStream) {}
    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didRemove stream: LKRTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ pc: LKRTCPeerConnection) {}

    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didChange newState: LKRTCIceConnectionState) {
        Task { @MainActor in
            switch newState {
            case .connected: self.onConnected?()
            case .disconnected, .failed, .closed: self.onDisconnected?()
            default: break
            }
        }
    }

    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didChange state: LKRTCIceGatheringState) {}

    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didGenerate candidate: LKRTCIceCandidate) {
        Task { @MainActor in
            guard let remote = self.remoteClientId else { return }
            self.sendSignaling?([
                "type": "webrtc_ice",
                "candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid as Any,
                "sdpMLineIndex": candidate.sdpMLineIndex,
                "fromClientId": self.clientId,
                "toClientId": remote,
            ])
        }
    }

    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didRemove candidates: [LKRTCIceCandidate]) {}

    nonisolated func peerConnection(_ pc: LKRTCPeerConnection, didOpen dataChannel: LKRTCDataChannel) {
        Task { @MainActor in
            self.dataChannel = dataChannel
            dataChannel.delegate = self
        }
    }
}

extension WebRTCTransport: LKRTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: LKRTCDataChannel) {
        Task { @MainActor in
            switch dataChannel.readyState {
            case .open: self.onConnected?()
            case .closed: self.onDisconnected?()
            default: break
            }
        }
    }

    nonisolated func dataChannel(_ dataChannel: LKRTCDataChannel, didReceiveMessageWith buffer: LKRTCDataBuffer) {
        let data = buffer.data

        if !buffer.isBinary {
            // JSON control message
            Task { @MainActor in
                guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
                self.onControlMessage?(json)
            }
            return
        }

        Task { @MainActor in
            guard let channel = data.first else { return }
            switch channel {
            case 0x00:
                self.onTerminalData?(Data(data.dropFirst()))
            case 0x01 where data.count >= 5:
                let cols = Int(data[1]) << 8 | Int(data[2])
                let rows = Int(data[3]) << 8 | Int(data[4])
                self.onResize?(cols, rows)
            default: break
            }
        }
    }
}

#else

/// Stub WebRTC transport — LiveKitWebRTC framework is not available in this build.
/// All methods are no-ops. Enable by adding the LiveKitWebRTC SPM dependency in project.yml.
@MainActor
final class WebRTCTransport: Transport {

    let transportType: TransportType = .webrtc
    var isConnected: Bool { false }

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?
    var onControlMessage: (([String: Any]) -> Void)?
    var sendSignaling: (([String: Any]) -> Void)?

    private let clientId: String

    init(clientId: String) {
        self.clientId = clientId
    }

    func handleSignaling(_ json: [String: Any]) {}
    func sendControlMessage(_ msg: [String: Any]) {}
    func sendInput(_ data: Data) {}
    func sendResize(cols: Int, rows: Int) {}
    func disconnect() {}
}

#endif
