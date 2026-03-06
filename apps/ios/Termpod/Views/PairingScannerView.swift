import SwiftUI
import AVFoundation

/// QR code scanner for pairing with a desktop session.
struct PairingScannerView: View {

    let onPaired: (PairingToken) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var cameraPermission: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        NavigationStack {
            Group {
                switch cameraPermission {
                case .authorized:
                    scannerContent

                case .notDetermined:
                    ProgressView("Requesting camera access...")
                        .task {
                            let granted = await AVCaptureDevice.requestAccess(for: .video)
                            cameraPermission = granted ? .authorized : .denied
                        }

                default:
                    cameraPermissionDenied
                }
            }
            .navigationTitle("Scan QR Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var scannerContent: some View {
        ZStack {
            QRScannerRepresentable { scannedString in
                if let token = PairingToken(from: scannedString) {
                    HapticService.shared.playTap()
                    onPaired(token)
                } else {
                    errorMessage = "Invalid QR code. Open Termpod on your Mac and scan the pairing code."
                }
            }
            .ignoresSafeArea()

            VStack {
                Spacer()

                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundColor(.white)
                        .padding()
                        .background(.ultraThinMaterial)
                        .cornerRadius(12)
                        .padding()
                        .transition(.opacity)
                }

                Text("Point your camera at the QR code on your Mac")
                    .font(.callout)
                    .foregroundColor(.white)
                    .padding()
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                    .padding(.bottom, 40)
            }
        }
    }

    private var cameraPermissionDenied: some View {
        ContentUnavailableView {
            Label("Camera Access Required", systemImage: "camera.fill")
        } description: {
            Text("Termpod needs camera access to scan QR codes. Enable it in Settings.")
        } actions: {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

// MARK: - QR Scanner UIKit Bridge

struct QRScannerRepresentable: UIViewControllerRepresentable {

    let onScanned: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let vc = QRScannerViewController()
        vc.onScanned = onScanned
        return vc
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {

    var onScanned: ((String) -> Void)?

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasScanned = false

    override func viewDidLoad() {
        super.viewDidLoad()
        setupCamera()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func setupCamera() {
        let session = AVCaptureSession()

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input)
        else { return }

        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }

        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        self.previewLayer = preview

        self.captureSession = session

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasScanned,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr,
              let value = object.stringValue
        else { return }

        hasScanned = true
        captureSession?.stopRunning()
        onScanned?(value)
    }
}
