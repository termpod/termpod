import { useCallback, useRef, useState } from 'react';
const WEBRTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export type WebRTCStatus = 'idle' | 'connecting' | 'connected' | 'failed';

interface UseWebRTCOptions {
  onViewerInput?: (data: string) => void;
  onStatusChange?: (status: WebRTCStatus) => void;
  sendSignaling: (msg: Record<string, unknown>) => void;
  localClientId: string;
}

export function useWebRTC(options: UseWebRTCOptions) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
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

      const pc = new RTCPeerConnection(WEBRTC_CONFIG);
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          optionsRef.current.sendSignaling({
            type: 'webrtc_ice',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            fromClientId: optionsRef.current.localClientId,
            toClientId: remoteClientId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
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
          }
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
      updateStatus('connecting');
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
    close,
    isConnected: status === 'connected',
  };
}
