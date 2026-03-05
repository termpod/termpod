import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { QRScanner } from './QRScanner';

interface ConnectScreenProps {
  onConnect: (sessionId: string) => void;
  connecting: boolean;
}

export function ConnectScreen({ onConnect, connecting }: ConnectScreenProps) {
  const [sessionId, setSessionId] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const handleConnect = () => {
    const id = sessionId.trim();

    if (id) {
      onConnect(id);
    }
  };

  const handlePaste = async () => {
    setPasteError(null);
    const text = await Clipboard.getStringAsync();
    const match = text.match(/[a-f0-9-]{36}/);

    if (match) {
      onConnect(match[0]);
    } else if (text) {
      setPasteError('No session ID found in clipboard');
    } else {
      setPasteError('Clipboard is empty');
    }
  };

  const handleScan = (id: string) => {
    setShowScanner(false);
    onConnect(id);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Termpod</Text>
        <Text style={styles.subtitle}>Connect to a terminal session</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={() => setShowScanner(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.scanText}>Scan QR Code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pasteBtn}
            onPress={handlePaste}
            activeOpacity={0.7}
          >
            <Text style={styles.pasteText}>Paste from Clipboard</Text>
          </TouchableOpacity>

          {pasteError && <Text style={styles.error}>{pasteError}</Text>}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or enter session ID</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            style={styles.input}
            placeholder="Session ID"
            placeholderTextColor="#565f89"
            value={sessionId}
            onChangeText={setSessionId}
            onSubmitEditing={handleConnect}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
          />

          <TouchableOpacity
            style={[styles.connectBtn, connecting && styles.connectBtnDisabled]}
            onPress={handleConnect}
            disabled={connecting || !sessionId.trim()}
            activeOpacity={0.7}
          >
            <Text style={styles.connectText}>
              {connecting ? 'Connecting...' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <QRScanner
        visible={showScanner}
        onScan={handleScan}
        onClose={() => setShowScanner(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1b26',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#c0caf5',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#565f89',
    marginBottom: 32,
  },
  actions: {
    width: '100%',
    maxWidth: 320,
    gap: 12,
  },
  scanBtn: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#7aa2f7',
    alignItems: 'center',
  },
  scanText: {
    color: '#1a1b26',
    fontSize: 16,
    fontWeight: '600',
  },
  pasteBtn: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#292e42',
    alignItems: 'center',
  },
  pasteText: {
    color: '#c0caf5',
    fontSize: 15,
    fontWeight: '500',
  },
  error: {
    color: '#e05050',
    fontSize: 12,
    textAlign: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#292e42',
  },
  dividerText: {
    color: '#565f89',
    fontSize: 12,
  },
  input: {
    padding: 12,
    backgroundColor: '#16161e',
    borderWidth: 1,
    borderColor: '#292e42',
    borderRadius: 10,
    color: '#c0caf5',
    fontSize: 14,
    fontFamily: 'Menlo',
    textAlign: 'center',
  },
  connectBtn: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#3d59a1',
    alignItems: 'center',
  },
  connectBtnDisabled: {
    opacity: 0.5,
  },
  connectText: {
    color: '#c0caf5',
    fontSize: 15,
    fontWeight: '600',
  },
});
