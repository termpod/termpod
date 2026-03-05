import { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

export interface TerminalViewHandle {
  write: (data: Uint8Array) => void;
  focus: () => void;
  clear: () => void;
  resize: (cols: number, rows: number) => void;
}

interface TerminalViewProps {
  onData?: (data: string) => void;
  onReady?: () => void;
}

const TERMINAL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; background: #1a1b26; overflow: auto; -webkit-overflow-scrolling: touch; }
  #terminal { width: max-content; min-width: 100%; }
  .xterm { padding: 2px; }
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
<script>
// Measure char width at 12px to calculate font scaling
var measureSpan = document.createElement('span');
measureSpan.style.cssText = 'font-family:Menlo,monospace;font-size:12px;position:absolute;visibility:hidden;white-space:pre';
measureSpan.textContent = 'XXXXXXXXXXXXXXXXXXXX';
document.body.appendChild(measureSpan);
var charWidth12 = measureSpan.offsetWidth / 20;
document.body.removeChild(measureSpan);

// Start with desktop-like defaults so scrollback renders correctly
var DEFAULT_COLS = 120;
var DEFAULT_ROWS = 40;
var PADDING = 8;
var availWidth = window.innerWidth - PADDING;
var initFontSize = Math.max(Math.floor(10 * 12 * availWidth / (DEFAULT_COLS * charWidth12)) / 10, 4);

var term = new Terminal({
  fontSize: initFontSize,
  fontFamily: 'Menlo, monospace',
  cols: DEFAULT_COLS,
  rows: DEFAULT_ROWS,
  cursorBlink: true,
  allowProposedApi: true,
  scrollback: 5000,
  theme: {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
  },
});

term.loadAddon(new WebLinksAddon.WebLinksAddon());
term.open(document.getElementById('terminal'));

function resizeToDesktop(cols, rows) {
  var neededWidth = cols * charWidth12;
  var newFontSize = Math.max(Math.floor(10 * 12 * availWidth / neededWidth) / 10, 4);
  term.options.fontSize = newFontSize;
  term.resize(cols, rows);
}

term.onData(function(data) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', data: data }));
});

window.addEventListener('message', function(event) {
  try {
    var msg = JSON.parse(event.data);
    if (msg.type === 'write') {
      term.write(new Uint8Array(msg.data));
    } else if (msg.type === 'focus') {
      term.focus();
    } else if (msg.type === 'clear') {
      term.clear();
    } else if (msg.type === 'resize') {
      resizeToDesktop(msg.cols, msg.rows);
    }
  } catch(e) {}
});

window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
</script>
</body>
</html>`;

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ onData, onReady }, ref) => {
    const webViewRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      write: (data: Uint8Array) => {
        const arr = Array.from(data);
        webViewRef.current?.postMessage(JSON.stringify({ type: 'write', data: arr }));
      },
      focus: () => {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'focus' }));
      },
      clear: () => {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'clear' }));
      },
      resize: (cols: number, rows: number) => {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'resize', cols, rows }));
      },
    }));

    const handleMessage = useCallback((event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);

        switch (msg.type) {
          case 'input':
            onData?.(msg.data);
            break;
          case 'ready':
            onReady?.();
            break;
        }
      } catch {
        // ignore parse errors
      }
    }, [onData, onReady]);

    return (
      <WebView
        ref={webViewRef}
        source={{ html: TERMINAL_HTML }}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled
        bounces={false}
        overScrollMode="never"
        keyboardDisplayRequiresUserAction={false}
        originWhitelist={['*']}
      />
    );
  },
);

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#1a1b26',
  },
});
