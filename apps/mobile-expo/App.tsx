import { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ConnectScreen } from './src/components/ConnectScreen';
import { TerminalView, TerminalViewHandle } from './src/components/TerminalView';
import { QuickActions } from './src/components/QuickActions';
import { PromptBar } from './src/components/PromptBar';
import { useRelay } from './src/useRelay';

export default function App() {
  const terminalRef = useRef<TerminalViewHandle>(null);
  const { status, prompt, connect, disconnect, sendInput, setOnData, setOnResize } = useRelay();
  const [showTerminal, setShowTerminal] = useState(false);
  const pendingSessionRef = useRef<string | null>(null);

  const handleConnect = useCallback((sessionId: string) => {
    // Show terminal first, wait for WebView to be ready before connecting WebSocket
    pendingSessionRef.current = sessionId;
    setShowTerminal(true);
  }, []);

  const handleDisconnect = useCallback(() => {
    pendingSessionRef.current = null;
    disconnect();
    setShowTerminal(false);
  }, [disconnect]);

  const handleTerminalReady = useCallback(() => {
    // Wire up data and resize handlers FIRST
    setOnData((data: Uint8Array) => {
      terminalRef.current?.write(data);
    });
    setOnResize((cols: number, rows: number) => {
      terminalRef.current?.resize(cols, rows);
    });

    // NOW connect WebSocket — ensures all relay data (ptySize, scrollback)
    // arrives after the WebView is ready to receive it
    const sessionId = pendingSessionRef.current;
    if (sessionId) {
      pendingSessionRef.current = null;
      connect(sessionId);
    }
  }, [setOnData, setOnResize, connect]);

  const handleTerminalData = useCallback((data: string) => {
    sendInput(data);
  }, [sendInput]);

  const handleQuickAction = useCallback((value: string) => {
    sendInput(value);
  }, [sendInput]);

  const handlePromptAccept = useCallback(() => {
    sendInput('y');
  }, [sendInput]);

  const handlePromptDeny = useCallback(() => {
    sendInput('n');
  }, [sendInput]);

  if (!showTerminal) {
    return (
      <>
        <StatusBar style="light" />
        <ConnectScreen
          onConnect={handleConnect}
          connecting={status === 'connecting'}
        />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, status === 'connected' && styles.dotConnected]} />
          <Text style={styles.statusText}>
            {status === 'connected' ? 'Connected' :
             status === 'reconnecting' ? 'Reconnecting...' :
             status === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleDisconnect} activeOpacity={0.7}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      <TerminalView
        ref={terminalRef}
        onData={handleTerminalData}
        onReady={handleTerminalReady}
      />

      {prompt && (
        <PromptBar
          prompt={prompt}
          onAccept={handlePromptAccept}
          onDeny={handlePromptDeny}
        />
      )}

      <QuickActions onAction={handleQuickAction} />
    </SafeAreaView>
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
    paddingVertical: 8,
    backgroundColor: '#16161e',
    borderBottomWidth: 1,
    borderBottomColor: '#292e42',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#565f89',
  },
  dotConnected: {
    backgroundColor: '#50c878',
  },
  statusText: {
    color: '#a9b1d6',
    fontSize: 13,
  },
  disconnectText: {
    color: '#e05050',
    fontSize: 13,
    fontWeight: '500',
  },
});
