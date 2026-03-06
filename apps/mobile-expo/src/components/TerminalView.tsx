import { useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  Pressable,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

// Base64 lookup table for fast encoding
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    result += B64[a >> 2];
    result += B64[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < len ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < len ? B64[c & 63] : '=';
  }

  return result;
}

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
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.min.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; background: #1a1b26; overflow: auto; -webkit-overflow-scrolling: touch; }
  #terminal { width: max-content; min-width: 100%; }
  .xterm { padding: 2px; }
  .xterm textarea { display: none !important; }
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.12.0/lib/addon-web-links.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-webgl@0.19.0/lib/addon-webgl.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-unicode-graphemes@0.4.0/lib/addon-unicode-graphemes.min.js"></script>
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

// Addons
var fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.loadAddon(new WebLinksAddon.WebLinksAddon());

var unicodeAddon = new UnicodeGraphemesAddon.UnicodeGraphemesAddon();
term.loadAddon(unicodeAddon);
term.unicode.activeVersion = '15';

term.open(document.getElementById('terminal'));

// Try WebGL renderer, fall back to canvas silently
try {
  var webglAddon = new WebglAddon.WebglAddon();
  webglAddon.onContextLoss(function() {
    webglAddon.dispose();
  });
  term.loadAddon(webglAddon);
} catch(e) {}

function resizeToDesktop(cols, rows) {
  var neededWidth = cols * charWidth12;
  var newFontSize = Math.max(Math.floor(10 * 12 * availWidth / neededWidth) / 10, 4);
  term.options.fontSize = newFontSize;
  term.resize(cols, rows);
}

// Base64 decode LUT
var b64lut = new Uint8Array(128);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach(function(c,i){ b64lut[c.charCodeAt(0)]=i; });
function b64decode(s) {
  var n = s.length, pad = s[n-1]==='=' ? (s[n-2]==='=' ? 2 : 1) : 0;
  var len = (n * 3 / 4) - pad, buf = new Uint8Array(len), j = 0;
  for (var i = 0; i < n; i += 4) {
    var a=b64lut[s.charCodeAt(i)], b=b64lut[s.charCodeAt(i+1)],
        c=b64lut[s.charCodeAt(i+2)], d=b64lut[s.charCodeAt(i+3)];
    buf[j++]=(a<<2)|(b>>4);
    if(j<len) buf[j++]=((b&15)<<4)|(c>>2);
    if(j<len) buf[j++]=((c&3)<<6)|d;
  }
  return buf;
}

// Typeahead prediction — ghost chars shown instantly, erased before server writes
var _pred = ''; // predicted chars pending server confirmation
var _predTimer = null;
var GHOST_ON = '\\x1b[2m';  // dim
var GHOST_OFF = '\\x1b[22m'; // reset dim

function _erasePred() {
  if (_pred.length > 0) {
    // Backspace + space + backspace for each predicted char
    var erase = '';
    for (var i = 0; i < _pred.length; i++) erase += '\\b \\b';
    term.write(erase);
    _pred = '';
  }
  if (_predTimer) { clearTimeout(_predTimer); _predTimer = null; }
}

// Local echo: write ghost char + track
window._le = function(ch) {
  term.write(GHOST_ON + ch + GHOST_OFF);
  _pred += ch;
  if (_predTimer) clearTimeout(_predTimer);
  _predTimer = setTimeout(function() {
    // No server echo after 2s — erase ghosts (password field, etc.)
    _erasePred();
  }, 2000);
};

// Server write: always erase predictions first, then write server data
window._w = function(b64) {
  var bytes = b64decode(b64);
  _erasePred();
  term.write(bytes);
};
window._r = function(c,r) { resizeToDesktop(c,r); };

window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
</script>
</body>
</html>`;

// Map special keys to terminal escape sequences
const KEY_MAP: Record<string, string> = {
  Enter: '\r',
  Backspace: '\x7f',
  Escape: '\x1b',
  Tab: '\t',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
};

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ onData, onReady }, ref) => {
    const webViewRef = useRef<WebView>(null);
    const inputRef = useRef<TextInput>(null);
    // Keep a sentinel value in the TextInput so backspace always fires
    const [inputValue, setInputValue] = useState(' ');

    useImperativeHandle(ref, () => ({
      write: (data: Uint8Array) => {
        const b64 = uint8ToBase64(data);
        webViewRef.current?.injectJavaScript(`_w('${b64}');true;`);
      },
      focus: () => {
        inputRef.current?.focus();
      },
      clear: () => {
        webViewRef.current?.injectJavaScript('term.clear();true;');
      },
      resize: (cols: number, rows: number) => {
        webViewRef.current?.injectJavaScript(`_r(${cols},${rows});true;`);
      },
    }), []);

    const onDataRef = useRef(onData);
    const onReadyRef = useRef(onReady);
    onDataRef.current = onData;
    onReadyRef.current = onReady;

    const handleMessage = useCallback((event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);

        if (msg.type === 'ready') {
          onReadyRef.current?.();
          // Ensure keyboard stays up after WebView initializes
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      } catch {
        // ignore parse errors
      }
    }, []);

    // Native keyboard input — fires with zero WebView latency
    const handleKeyPress = useCallback(
      (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const { key } = e.nativeEvent;
        // Enter is handled via onSubmitEditing on iOS (keyPress doesn't fire reliably)
        if (key === 'Enter') return;

        const mapped = KEY_MAP[key];

        if (mapped) {
          onDataRef.current?.(mapped);
        } else if (key.length === 1) {
          // Local echo: inject char into xterm immediately
          const escaped = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          webViewRef.current?.injectJavaScript(`_le('${escaped}');true;`);
          onDataRef.current?.(key);
        }
      },
      [],
    );

    const handleSubmitEditing = useCallback(() => {
      onDataRef.current?.('\r');
    }, []);

    const handleChangeText = useCallback((text: string) => {
      // If text grew beyond sentinel, user typed a character
      // (handleKeyPress already sent it — just reset sentinel)
      // If text is empty, user pressed backspace (already handled by keyPress)
      setInputValue(' ');
    }, []);

    // Re-focus hidden input whenever WebView might steal focus
    const refocusInput = useCallback(() => {
      setTimeout(() => inputRef.current?.focus(), 50);
    }, []);

    const handleTapWebView = useCallback(() => {
      inputRef.current?.focus();
    }, []);

    return (
      <View style={styles.container}>
        <Pressable style={styles.pressable} onPress={handleTapWebView}>
          <WebView
            ref={webViewRef}
            source={{ html: TERMINAL_HTML }}
            style={styles.webview}
            onMessage={handleMessage}
            onLoad={refocusInput}
            onContentProcessDidTerminate={refocusInput}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled
            bounces={false}
            overScrollMode="never"
            originWhitelist={['*']}
            autoFocus={false}
            keyboardDisplayRequiresUserAction={false}
          />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={inputValue}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onSubmitEditing={handleSubmitEditing}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          returnKeyType="default"
          keyboardType="ascii-capable"
          keyboardAppearance="dark"
          style={styles.hiddenInput}
          blurOnSubmit={false}
          caretHidden
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1b26',
  },
  pressable: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#1a1b26',
  },
  hiddenInput: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
