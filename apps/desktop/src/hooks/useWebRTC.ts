import { useCallback, useRef, useState } from 'react';
import { authFetch } from './useAuth';
import { compressPayload, decompressPayload } from '@termpod/protocol';

const STUN_ONLY_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

export type WebRTCStatus = 'idle' | 'connecting' | 'connected' | 'failed';

interface UseWebRTCOptions {
  /** Legacy non-multiplexed input (channel 0x00). */
  onViewerInput?: (data: string) => void;
  /** Legacy non-multiplexed resize (channel 0x01). */
  onViewerResize?: (cols: number, rows: number) => void;
  /** Multiplexed input (channel 0x10) — includes sessionId. */
  onMuxViewerInput?: (sessionId: string, data: string) => void;
  /** Multiplexed resize (channel 0x11) — includes sessionId. */
  onMuxViewerResize?: (sessionId: string, cols: number, rows: number) => void;
  onControlMessage?: (msg: Record<string, unknown>) => Record<string, unknown> | void;
  onStatusChange?: (status: WebRTCStatus) => void;
  sendSignaling: (msg: Record<string, unknown>) => void;
  localClientId: string;
}

/** Fetch TURN credentials from relay, falling back to STUN-only. */
async function fetchIceServers(): Promise<RTCConfiguration> {
  try {
    const res = await authFetch('/turn-credentials');

    if (res.ok) {
      const { iceServers } = (await res.json()) as { iceServers: RTCIceServer[] };
      console.log('[WebRTC] Got TURN credentials:', iceServers.length, 'servers');
      return { iceServers };
    }
  } catch (err) {
    console.warn('[WebRTC] Failed to fetch TURN credentials, using STUN only:', err);
  }

  return STUN_ONLY_CONFIG;
}

/** Parse a multiplexed binary frame: [channel][sid_len][sid_bytes][payload...] */
function parseMuxFrame(data: Uint8Array): { sessionId: string; payload: Uint8Array } | null {
  if (data.length < 2) return null;
  const sidLen = data[1];
  if (sidLen === 0 || data.length < 2 + sidLen) return null;
  const sessionId = new TextDecoder().decode(data.subarray(2, 2 + sidLen));
  const payload = data.subarray(2 + sidLen);
  return { sessionId, payload };
}

export function useWebRTC(options: UseWebRTCOptions) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const remoteClientRef = useRef<string | null>(null);
  const iceConfigRef = useRef<RTCConfiguration>(STUN_ONLY_CONFIG);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const updateStatus = useCallback((s: WebRTCStatus) => {
    setStatus(s);
    optionsRef.current.onStatusChange?.(s);
  }, []);

  const createPeerConnection = useCallback(
    (remoteClientId: string) => {
      if (pcRef.current) {
        pcRef.current.close();
      }

      console.log(
        '[WebRTC] createPeerConnection for',
        remoteClientId,
        'iceServers:',
        iceConfigRef.current.iceServers?.length,
      );
      const pc = new RTCPeerConnection(iceConfigRef.current);
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const typ = event.candidate.candidate.match(/typ (\w+)/)?.[1] ?? '?';
          console.log('[WebRTC] local candidate:', typ);
          optionsRef.current.sendSignaling({
            type: 'webrtc_ice',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            fromClientId: optionsRef.current.localClientId,
            toClientId: remoteClientId,
          });
        } else {
          console.log('[WebRTC] ICE gathering complete');
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] ICE state:', pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] connection state:', pc.connectionState);
        switch (pc.connectionState) {
          case 'connected':
            updateStatus('connected');
            break;
          case 'failed':
          case 'disconnected':
          case 'closed':
            updateStatus('failed');
            break;
        }
      };

      // Desktop creates the data channel (desktop is always the offerer)
      const channel = pc.createDataChannel('terminal', {
        ordered: true,
      });

      channel.binaryType = 'arraybuffer';

      channel.onopen = () => {
        channelRef.current = channel;
        updateStatus('connected');
      };

      channel.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const data = new Uint8Array(event.data);
          if (data.length === 0) return;

          switch (data[0]) {
            // Legacy non-multiplexed frames
            case 0x00:
              if (data.length > 1) {
                optionsRef.current.onViewerInput?.(new TextDecoder().decode(data.subarray(1)));
              }
              break;

            case 0x01:
              if (data.length >= 5) {
                const cols = (data[1] << 8) | data[2];
                const rows = (data[3] << 8) | data[4];
                optionsRef.current.onViewerResize?.(cols, rows);
              }
              break;

            // Multiplexed frames with session ID
            case 0x10: {
              const mux = parseMuxFrame(data);
              if (mux) {
                optionsRef.current.onMuxViewerInput?.(
                  mux.sessionId,
                  new TextDecoder().decode(mux.payload),
                );
              }
              break;
            }

            // Compressed multiplexed terminal data
            case 0x12: {
              const mux = parseMuxFrame(data);
              if (mux) {
                decompressPayload(mux.payload)
                  .then((decompressed) => {
                    optionsRef.current.onMuxViewerInput?.(
                      mux.sessionId,
                      new TextDecoder().decode(decompressed),
                    );
                  })
                  .catch(() => {});
              }
              break;
            }

            case 0x11: {
              const mux = parseMuxFrame(data);
              if (mux && mux.payload.length >= 4) {
                const cols = (mux.payload[0] << 8) | mux.payload[1];
                const rows = (mux.payload[2] << 8) | mux.payload[3];
                optionsRef.current.onMuxViewerResize?.(mux.sessionId, cols, rows);
              }
              break;
            }
          }
        } else if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;
            const response = optionsRef.current.onControlMessage?.(msg);

            if (response && channel.readyState === 'open') {
              channel.send(JSON.stringify(response));
            }
          } catch {}
        }
      };

      channel.onclose = () => {
        channelRef.current = null;
        updateStatus('idle');
      };

      return pc;
    },
    [updateStatus],
  );

  const initiateOffer = useCallback(
    async (remoteClientId: string) => {
      // Don't tear down an in-progress or established connection to the SAME client
      if (
        pcRef.current &&
        pcRef.current.connectionState !== 'closed' &&
        pcRef.current.connectionState !== 'failed' &&
        pcRef.current.connectionState !== 'disconnected'
      ) {
        if (remoteClientRef.current === remoteClientId) {
          console.log(
            '[WebRTC] Skipping offer — connection already',
            pcRef.current.connectionState,
          );
          return;
        }
        // Different client — close the stale connection
        console.log(
          '[WebRTC] New client',
          remoteClientId,
          '— closing stale PC for',
          remoteClientRef.current,
        );
        pcRef.current.close();
        pcRef.current = null;
        channelRef.current = null;
      }
      remoteClientRef.current = remoteClientId;

      updateStatus('connecting');

      // Fetch TURN credentials before creating the connection
      iceConfigRef.current = await fetchIceServers();
      const pc = createPeerConnection(remoteClientId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      optionsRef.current.sendSignaling({
        type: 'webrtc_offer',
        sdp: offer.sdp,
        fromClientId: optionsRef.current.localClientId,
        toClientId: remoteClientId,
      });
    },
    [createPeerConnection, updateStatus],
  );

  const handleSignaling = useCallback(
    async (msg: Record<string, unknown>) => {
      const type = msg.type as string;
      const fromClientId = msg.fromClientId as string;

      if (type === 'webrtc_answer') {
        const pc = pcRef.current;

        if (pc) {
          await pc.setRemoteDescription({
            type: 'answer',
            sdp: msg.sdp as string,
          });
        }
      } else if (type === 'webrtc_ice') {
        const pc = pcRef.current;

        if (pc) {
          await pc.addIceCandidate({
            candidate: msg.candidate as string,
            sdpMid: msg.sdpMid as string | null,
            sdpMLineIndex: msg.sdpMLineIndex as number | null,
          });
        }
      } else if (type === 'webrtc_offer') {
        // Desktop received an offer (shouldn't normally happen, but handle it)
        updateStatus('connecting');
        iceConfigRef.current = await fetchIceServers();
        const pc = createPeerConnection(fromClientId);
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp as string });

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        optionsRef.current.sendSignaling({
          type: 'webrtc_answer',
          sdp: answer.sdp,
          fromClientId: optionsRef.current.localClientId,
          toClientId: fromClientId,
        });
      }
    },
    [createPeerConnection, updateStatus],
  );

  // Sequential send queue to maintain frame ordering with async compression
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());

  /** Send multiplexed terminal data with compression: [0x12][sid_len][sid][deflate] or [0x10] if small */
  const sendTerminalData = useCallback((sessionId: string, data: Uint8Array | number[]) => {
    const channel = channelRef.current;

    if (channel?.readyState !== 'open') {
      return;
    }

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const sidBytes = new TextEncoder().encode(sessionId);

    sendQueueRef.current = sendQueueRef.current.then(async () => {
      if (channelRef.current?.readyState !== 'open') {
        return;
      }

      const compressed = await compressPayload(bytes);

      if (compressed) {
        // Send compressed frame (0x12)
        const frame = new Uint8Array(2 + sidBytes.length + compressed.length);
        frame[0] = 0x12;
        frame[1] = sidBytes.length;
        frame.set(sidBytes, 2);
        frame.set(compressed, 2 + sidBytes.length);
        channelRef.current?.send(frame.buffer);
      } else {
        // Send uncompressed frame (0x10)
        const frame = new Uint8Array(2 + sidBytes.length + bytes.length);
        frame[0] = 0x10;
        frame[1] = sidBytes.length;
        frame.set(sidBytes, 2);
        frame.set(bytes, 2 + sidBytes.length);
        channelRef.current?.send(frame.buffer);
      }
    });
  }, []);

  /** Send multiplexed resize: [0x11][sid_len][sid][cols_hi][cols_lo][rows_hi][rows_lo] */
  const sendResize = useCallback((sessionId: string, cols: number, rows: number) => {
    const channel = channelRef.current;

    if (channel?.readyState === 'open') {
      const sidBytes = new TextEncoder().encode(sessionId);
      const frame = new Uint8Array(2 + sidBytes.length + 4);
      frame[0] = 0x11;
      frame[1] = sidBytes.length;
      frame.set(sidBytes, 2);
      const payloadStart = 2 + sidBytes.length;
      frame[payloadStart] = (cols >> 8) & 0xff;
      frame[payloadStart + 1] = cols & 0xff;
      frame[payloadStart + 2] = (rows >> 8) & 0xff;
      frame[payloadStart + 3] = rows & 0xff;
      channel.send(frame.buffer);
    }
  }, []);

  const sendControlMessage = useCallback((msg: Record<string, unknown>) => {
    const channel = channelRef.current;

    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(msg));
    }
  }, []);

  const close = useCallback(() => {
    channelRef.current?.close();
    pcRef.current?.close();
    channelRef.current = null;
    pcRef.current = null;
    updateStatus('idle');
  }, [updateStatus]);

  return {
    status,
    initiateOffer,
    handleSignaling,
    sendTerminalData,
    sendResize,
    sendControlMessage,
    close,
    isConnected: status === 'connected',
  };
}
