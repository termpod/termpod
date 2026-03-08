import { useCallback, useRef, useState } from 'react';
import { authFetch } from './useAuth';

const STUN_ONLY_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

export type WebRTCStatus = 'idle' | 'connecting' | 'connected' | 'failed';

interface UseWebRTCOptions {
  onViewerInput?: (data: string) => void;
  onViewerResize?: (cols: number, rows: number) => void;
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
      const { iceServers } = await res.json() as { iceServers: RTCIceServer[] };
      console.log('[WebRTC] Got TURN credentials:', iceServers.length, 'servers');
      return { iceServers };
    }
  } catch (err) {
    console.warn('[WebRTC] Failed to fetch TURN credentials, using STUN only:', err);
  }

  return STUN_ONLY_CONFIG;
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

      console.log('[WebRTC] createPeerConnection for', remoteClientId, 'iceServers:', iceConfigRef.current.iceServers?.length);
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

          if (data[0] === 0x00 && data.length > 1) {
            optionsRef.current.onViewerInput?.(
              new TextDecoder().decode(data.subarray(1)),
            );
          } else if (data[0] === 0x01 && data.length >= 5) {
            const cols = (data[1] << 8) | data[2];
            const rows = (data[3] << 8) | data[4];
            optionsRef.current.onViewerResize?.(cols, rows);
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
      if (pcRef.current && pcRef.current.connectionState !== 'closed' && pcRef.current.connectionState !== 'failed' && pcRef.current.connectionState !== 'disconnected') {
        if (remoteClientRef.current === remoteClientId) {
          console.log('[WebRTC] Skipping offer — connection already', pcRef.current.connectionState);
          return;
        }
        // Different client — close the stale connection
        console.log('[WebRTC] New client', remoteClientId, '— closing stale PC for', remoteClientRef.current);
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

  const sendTerminalData = useCallback((data: Uint8Array | number[]) => {
    const channel = channelRef.current;

    if (channel?.readyState === 'open') {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      // Prepend channel byte 0x00
      const frame = new Uint8Array(1 + bytes.length);
      frame[0] = 0x00;
      frame.set(bytes, 1);
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
    sendControlMessage,
    close,
    isConnected: status === 'connected',
  };
}
