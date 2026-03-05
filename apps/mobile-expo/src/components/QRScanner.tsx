import { useState } from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

interface QRScannerProps {
  visible: boolean;
  onScan: (sessionId: string) => void;
  onClose: () => void;
}

function parseSessionId(text: string): string | null {
  try {
    const url = new URL(text);

    if (url.protocol === 'termpod:') {
      return url.searchParams.get('session');
    }
  } catch {
    // not a URL
  }

  const match = text.match(/[a-f0-9-]{36}/);

  return match ? match[0] : null;
}

export function QRScanner({ visible, onScan, onClose }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!visible) {
    return null;
  }

  if (!permission?.granted) {
    requestPermission();
  }

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) {
      return;
    }

    const sessionId = parseSessionId(data);

    if (sessionId) {
      setScanned(true);
      onScan(sessionId);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan QR Code</Text>
          <Text style={styles.close} onPress={onClose}>Close</Text>
        </View>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarCodeScanned}
          >
            <View style={styles.overlay}>
              <View style={styles.frame} />
            </View>
          </CameraView>
        ) : (
          <View style={styles.denied}>
            <Text style={styles.deniedText}>Camera permission required to scan QR codes</Text>
          </View>
        )}
        <Text style={styles.hint}>Point at the QR code in the desktop app</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1b26',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#c0caf5',
  },
  close: {
    fontSize: 16,
    color: '#7aa2f7',
  },
  camera: {
    flex: 1,
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    width: 220,
    height: 220,
    borderWidth: 2,
    borderColor: 'rgba(122, 162, 247, 0.6)',
    borderRadius: 16,
  },
  denied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  deniedText: {
    color: '#565f89',
    fontSize: 14,
    textAlign: 'center',
  },
  hint: {
    color: '#565f89',
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: 32,
  },
});
