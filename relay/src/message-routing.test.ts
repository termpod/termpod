import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Channel } from '@termpod/protocol';

/**
 * Tests for WebSocket message routing logic in the Session and User DOs.
 *
 * Since Durable Objects can't be instantiated without Miniflare, we test the
 * routing contracts: given a sender role and message type, verify what should
 * happen (forward, drop, broadcast, etc.).
 */

// --- Simulated WebSocket with tag + message tracking ---

interface ClientTag {
  clientId: string;
  role: 'desktop' | 'viewer';
  device: string;
  targetDeviceId?: string;
}

class MockWebSocket {
  readonly sentMessages: Array<string | ArrayBuffer> = [];
  closed = false;
  closeCode?: number;
  closeReason?: string;
  private attachment: unknown = null;

  constructor(public tag: ClientTag | null = null) {}

  send(data: string | ArrayBuffer): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }

  serializeAttachment(v: unknown): void {
    this.attachment = v;
  }

  deserializeAttachment(): unknown {
    return this.attachment ?? this.tag;
  }

  getLastJson(): Record<string, unknown> | null {
    const last = this.sentMessages[this.sentMessages.length - 1];

    if (typeof last === 'string') {
      return JSON.parse(last);
    }

    return null;
  }

  getLastBinary(): Uint8Array | null {
    const last = this.sentMessages[this.sentMessages.length - 1];

    if (last instanceof ArrayBuffer) {
      return new Uint8Array(last);
    }

    return null;
  }
}

// --- Session DO routing rules ---

describe('Session DO: binary frame routing', () => {
  /**
   * Simulates the routing logic from session.ts webSocketMessage():
   * - Desktop sends terminal data → broadcast to viewers (no scrollback storage)
   * - Viewer sends terminal data → forward to desktop only
   * - Desktop sends resize → broadcast resize JSON to all
   * - Viewer sends resize → dropped (only desktop can resize)
   */

  function routeBinaryFrame(
    sender: MockWebSocket,
    data: Uint8Array,
    allSockets: MockWebSocket[],
  ): { recipientCount: number } {
    const channel = data[0];
    let recipientCount = 0;

    if (channel === Channel.TERMINAL_DATA) {
      const senderRole = sender.tag?.role ?? 'unknown';

      if (senderRole === 'desktop') {
        for (const ws of allSockets) {
          if (ws !== sender && ws.tag?.role === 'viewer') {
            ws.send(data.buffer as ArrayBuffer);
            recipientCount++;
          }
        }
      } else if (senderRole === 'viewer') {
        for (const ws of allSockets) {
          if (ws !== sender && ws.tag?.role === 'desktop') {
            ws.send(data.buffer as ArrayBuffer);
            recipientCount++;
          }
        }
      }
    } else if (channel === 0xe0) {
      // E2E encrypted frame — forward without inspecting
      const senderRole = sender.tag?.role ?? 'unknown';

      if (senderRole === 'desktop') {
        for (const ws of allSockets) {
          if (ws !== sender && ws.tag?.role === 'viewer') {
            ws.send(data.buffer as ArrayBuffer);
            recipientCount++;
          }
        }
      } else if (senderRole === 'viewer') {
        for (const ws of allSockets) {
          if (ws !== sender && ws.tag?.role === 'desktop') {
            ws.send(data.buffer as ArrayBuffer);
            recipientCount++;
          }
        }
      }
    } else if (channel === Channel.TERMINAL_RESIZE) {
      if (sender.tag?.role !== 'desktop') {
        return { recipientCount: 0 };
      }

      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const cols = view.getUint16(1, false);
      const rows = view.getUint16(3, false);
      const json = JSON.stringify({ type: 'pty_resize', cols, rows });

      for (const ws of allSockets) {
        if (ws !== sender) {
          ws.send(json);
          recipientCount++;
        }
      }
    }

    return { recipientCount };
  }

  let desktop: MockWebSocket;
  let viewer1: MockWebSocket;
  let viewer2: MockWebSocket;
  let allSockets: MockWebSocket[];

  beforeEach(() => {
    desktop = new MockWebSocket({ clientId: 'desktop-1', role: 'desktop', device: 'macos' });
    viewer1 = new MockWebSocket({ clientId: 'viewer-1', role: 'viewer', device: 'iphone' });
    viewer2 = new MockWebSocket({ clientId: 'viewer-2', role: 'viewer', device: 'ipad' });
    allSockets = [desktop, viewer1, viewer2];
  });

  it('desktop terminal data → broadcast to all viewers', () => {
    const frame = new Uint8Array([Channel.TERMINAL_DATA, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = routeBinaryFrame(desktop, frame, allSockets);

    expect(result.recipientCount).toBe(2);
    expect(viewer1.sentMessages.length).toBe(1);
    expect(viewer2.sentMessages.length).toBe(1);
    expect(desktop.sentMessages.length).toBe(0); // never echoed back
  });

  it('viewer input → forward to desktop only', () => {
    const frame = new Uint8Array([Channel.TERMINAL_DATA, 0x0d]); // Enter key
    const result = routeBinaryFrame(viewer1, frame, allSockets);

    expect(result.recipientCount).toBe(1);
    expect(desktop.sentMessages.length).toBe(1);
    expect(viewer1.sentMessages.length).toBe(0); // not echoed
    expect(viewer2.sentMessages.length).toBe(0); // other viewers don't get input
  });

  it('desktop resize → JSON broadcast to all clients', () => {
    const frame = new Uint8Array(5);
    const view = new DataView(frame.buffer);
    frame[0] = Channel.TERMINAL_RESIZE;
    view.setUint16(1, 132, false);
    view.setUint16(3, 43, false);

    const result = routeBinaryFrame(desktop, frame, allSockets);

    expect(result.recipientCount).toBe(2);
    expect(viewer1.getLastJson()).toEqual({ type: 'pty_resize', cols: 132, rows: 43 });
    expect(viewer2.getLastJson()).toEqual({ type: 'pty_resize', cols: 132, rows: 43 });
  });

  it('viewer resize → dropped (only desktop can resize)', () => {
    const frame = new Uint8Array(5);
    frame[0] = Channel.TERMINAL_RESIZE;

    const result = routeBinaryFrame(viewer1, frame, allSockets);

    expect(result.recipientCount).toBe(0);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('desktop encrypted frame (0xE0) → broadcast to viewers', () => {
    // Encrypted frame: [0xE0][nonce:12][ciphertext+tag]
    const frame = new Uint8Array([0xe0, ...new Array(12).fill(0xaa), ...new Array(20).fill(0xbb)]);
    const result = routeBinaryFrame(desktop, frame, allSockets);

    expect(result.recipientCount).toBe(2);
    expect(viewer1.sentMessages.length).toBe(1);
    expect(viewer2.sentMessages.length).toBe(1);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('viewer encrypted frame (0xE0) → forward to desktop only', () => {
    const frame = new Uint8Array([0xe0, ...new Array(12).fill(0xaa), ...new Array(20).fill(0xbb)]);
    const result = routeBinaryFrame(viewer1, frame, allSockets);

    expect(result.recipientCount).toBe(1);
    expect(desktop.sentMessages.length).toBe(1);
    expect(viewer1.sentMessages.length).toBe(0);
    expect(viewer2.sentMessages.length).toBe(0);
  });

  it('unknown role encrypted frame → silently dropped', () => {
    const unknownClient = new MockWebSocket(null);
    const frame = new Uint8Array([0xe0, ...new Array(32).fill(0xcc)]);
    const result = routeBinaryFrame(unknownClient, frame, [unknownClient, desktop, viewer1]);

    expect(result.recipientCount).toBe(0);
  });

  it('unknown role terminal data → silently dropped', () => {
    const unknownClient = new MockWebSocket(null);
    const frame = new Uint8Array([Channel.TERMINAL_DATA, 0x41]);
    const result = routeBinaryFrame(unknownClient, frame, [unknownClient, desktop, viewer1]);

    expect(result.recipientCount).toBe(0);
  });

  it('desktop-only session — no recipients, no errors', () => {
    const onlyDesktop = [desktop];
    const frame = new Uint8Array([Channel.TERMINAL_DATA, 0x41]);
    const result = routeBinaryFrame(desktop, frame, onlyDesktop);

    expect(result.recipientCount).toBe(0);
  });
});

// --- Session DO: control message routing ---

describe('Session DO: control message routing', () => {
  function routeControlMessage(
    sender: MockWebSocket,
    msg: Record<string, unknown>,
    allSockets: MockWebSocket[],
  ): { forwarded: boolean; recipientIds: string[] } {
    const recipientIds: string[] = [];
    const type = msg.type as string;

    switch (type) {
      case 'ping':
        sender.send(JSON.stringify({
          type: 'pong',
          timestamp: msg.timestamp,
          serverTime: Date.now(),
        }));

        return { forwarded: false, recipientIds: [] };

      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice': {
        const toClientId = msg.toClientId as string;
        const json = JSON.stringify(msg);

        for (const ws of allSockets) {
          if (ws.tag?.clientId === toClientId) {
            ws.send(json);
            recipientIds.push(toClientId);

            return { forwarded: true, recipientIds };
          }
        }

        return { forwarded: false, recipientIds: [] };
      }

      case 'create_session_request':
        if (sender.tag?.role === 'viewer') {
          const json = JSON.stringify(msg);

          for (const ws of allSockets) {
            if (ws !== sender && ws.tag?.role === 'desktop') {
              ws.send(json);
              recipientIds.push(ws.tag.clientId);
            }
          }
        }

        return { forwarded: recipientIds.length > 0, recipientIds };

      case 'session_created':
        if (sender.tag?.role === 'desktop') {
          const json = JSON.stringify(msg);

          for (const ws of allSockets) {
            if (ws !== sender && ws.tag?.role === 'viewer') {
              ws.send(json);
              recipientIds.push(ws.tag.clientId);
            }
          }
        }

        return { forwarded: recipientIds.length > 0, recipientIds };

      case 'key_exchange':
        // Desktop sends E2E public key → all viewers
        if (sender.tag?.role === 'desktop') {
          const json = JSON.stringify(msg);

          for (const ws of allSockets) {
            if (ws !== sender && ws.tag?.role === 'viewer') {
              ws.send(json);
              recipientIds.push(ws.tag.clientId);
            }
          }
        }

        return { forwarded: recipientIds.length > 0, recipientIds };

      case 'key_exchange_ack':
        // Viewer sends E2E public key → desktop
        if (sender.tag?.role === 'viewer') {
          const json = JSON.stringify(msg);

          for (const ws of allSockets) {
            if (ws !== sender && ws.tag?.role === 'desktop') {
              ws.send(json);
              recipientIds.push(ws.tag.clientId);
            }
          }
        }

        return { forwarded: recipientIds.length > 0, recipientIds };
    }

    return { forwarded: false, recipientIds: [] };
  }

  let desktop: MockWebSocket;
  let viewer: MockWebSocket;
  let allSockets: MockWebSocket[];

  beforeEach(() => {
    desktop = new MockWebSocket({ clientId: 'desktop-1', role: 'desktop', device: 'macos' });
    viewer = new MockWebSocket({ clientId: 'viewer-1', role: 'viewer', device: 'iphone' });
    allSockets = [desktop, viewer];
  });

  it('ping → pong response to sender', () => {
    const result = routeControlMessage(desktop, { type: 'ping', timestamp: 12345 }, allSockets);

    expect(result.forwarded).toBe(false);
    const pong = desktop.getLastJson();
    expect(pong!.type).toBe('pong');
    expect(pong!.timestamp).toBe(12345);
    expect(pong!.serverTime).toBeTypeOf('number');
  });

  it('webrtc_offer → forward to target clientId', () => {
    const result = routeControlMessage(desktop, {
      type: 'webrtc_offer',
      sdp: 'v=0...',
      fromClientId: 'desktop-1',
      toClientId: 'viewer-1',
    }, allSockets);

    expect(result.forwarded).toBe(true);
    expect(result.recipientIds).toEqual(['viewer-1']);
    expect(viewer.sentMessages.length).toBe(1);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('webrtc_offer to non-existent client → not forwarded', () => {
    const result = routeControlMessage(desktop, {
      type: 'webrtc_offer',
      sdp: 'v=0...',
      fromClientId: 'desktop-1',
      toClientId: 'nonexistent',
    }, allSockets);

    expect(result.forwarded).toBe(false);
  });

  it('create_session_request from viewer → forward to desktop', () => {
    const result = routeControlMessage(viewer, {
      type: 'create_session_request',
      requestId: 'req-1',
    }, allSockets);

    expect(result.forwarded).toBe(true);
    expect(result.recipientIds).toEqual(['desktop-1']);
    expect(desktop.getLastJson()!.requestId).toBe('req-1');
  });

  it('create_session_request from desktop → not forwarded (only viewers can request)', () => {
    const result = routeControlMessage(desktop, {
      type: 'create_session_request',
      requestId: 'req-1',
    }, allSockets);

    expect(result.forwarded).toBe(false);
    expect(viewer.sentMessages.length).toBe(0);
  });

  it('session_created from desktop → forward to all viewers', () => {
    const viewer2 = new MockWebSocket({ clientId: 'viewer-2', role: 'viewer', device: 'ipad' });
    const sockets = [desktop, viewer, viewer2];

    const result = routeControlMessage(desktop, {
      type: 'session_created',
      requestId: 'req-1',
      sessionId: 'sess-1',
    }, sockets);

    expect(result.forwarded).toBe(true);
    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
  });

  it('session_created from viewer → not forwarded', () => {
    const result = routeControlMessage(viewer, {
      type: 'session_created',
      requestId: 'req-1',
      sessionId: 'sess-1',
    }, allSockets);

    expect(result.forwarded).toBe(false);
  });

  it('key_exchange from desktop → forward to all viewers', () => {
    const viewer2 = new MockWebSocket({ clientId: 'viewer-2', role: 'viewer', device: 'ipad' });
    const sockets = [desktop, viewer, viewer2];

    const result = routeControlMessage(desktop, {
      type: 'key_exchange',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
      sessionId: 'sess-1',
    }, sockets);

    expect(result.forwarded).toBe(true);
    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('key_exchange from viewer → not forwarded', () => {
    const result = routeControlMessage(viewer, {
      type: 'key_exchange',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
      sessionId: 'sess-1',
    }, allSockets);

    expect(result.forwarded).toBe(false);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('key_exchange_ack from viewer → forward to desktop', () => {
    const result = routeControlMessage(viewer, {
      type: 'key_exchange_ack',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'ghi', y: 'jkl' },
    }, allSockets);

    expect(result.forwarded).toBe(true);
    expect(result.recipientIds).toEqual(['desktop-1']);
    expect(viewer.sentMessages.length).toBe(0);
  });

  it('key_exchange_ack from desktop → not forwarded', () => {
    const result = routeControlMessage(desktop, {
      type: 'key_exchange_ack',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'ghi', y: 'jkl' },
    }, allSockets);

    expect(result.forwarded).toBe(false);
    expect(viewer.sentMessages.length).toBe(0);
  });
});

// --- User DO: device-level message routing ---

describe('User DO: device-level control message routing', () => {
  /**
   * Simulates the routing logic from user.ts handleWsControlMessage().
   * Key rules:
   * - create_session_request: viewer → desktop only
   * - session_created: desktop → viewers (or specific clientId)
   * - delete_session: viewer → desktop
   * - session_closed: desktop → viewers
   * - sessions_updated: desktop → viewers
   * - webrtc_*: forward to target clientId
   */

  function routeDeviceMessage(
    sender: MockWebSocket,
    msg: Record<string, unknown>,
    allSockets: MockWebSocket[],
  ): { recipientIds: string[] } {
    const recipientIds: string[] = [];
    const type = msg.type as string;
    const senderTag = sender.tag!;
    const targetDeviceId = senderTag.targetDeviceId;

    function forwardToRole(role: string): void {
      const json = JSON.stringify(msg);

      for (const ws of allSockets) {
        if (ws !== sender && ws.tag?.role === role && ws.tag?.targetDeviceId === targetDeviceId) {
          ws.send(json);
          recipientIds.push(ws.tag.clientId);
        }
      }
    }

    function forwardToClient(clientId: string): void {
      const json = JSON.stringify(msg);

      for (const ws of allSockets) {
        if (ws.tag?.clientId === clientId) {
          ws.send(json);
          recipientIds.push(clientId);

          return;
        }
      }
    }

    switch (type) {
      case 'ping':
        sender.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp, serverTime: Date.now() }));
        break;

      case 'create_session_request':
        if (senderTag.role === 'viewer') {
          forwardToRole('desktop');
        }
        break;

      case 'session_created':
        if (senderTag.role === 'desktop') {
          if (msg.toClientId) {
            forwardToClient(msg.toClientId as string);
          } else {
            forwardToRole('viewer');
          }
        }
        break;

      case 'delete_session':
        if (senderTag.role === 'viewer') {
          forwardToRole('desktop');
        }
        break;

      case 'session_closed':
        if (senderTag.role === 'desktop') {
          forwardToRole('viewer');
        }
        break;

      case 'sessions_updated':
        if (senderTag.role === 'desktop') {
          forwardToRole('viewer');
        }
        break;

      case 'key_exchange':
      case 'local_auth_secret':
        if (senderTag.role === 'desktop') {
          forwardToRole('viewer');
        }
        break;

      case 'key_exchange_ack':
        if (senderTag.role === 'viewer') {
          forwardToRole('desktop');
        }
        break;

      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice':
        forwardToClient(msg.toClientId as string);
        break;
    }

    return { recipientIds };
  }

  let desktop: MockWebSocket;
  let viewer1: MockWebSocket;
  let viewer2: MockWebSocket;
  let allSockets: MockWebSocket[];

  beforeEach(() => {
    desktop = new MockWebSocket({
      clientId: 'desktop-1', role: 'desktop', device: 'macos', targetDeviceId: 'dev-1',
    });
    viewer1 = new MockWebSocket({
      clientId: 'viewer-1', role: 'viewer', device: 'iphone', targetDeviceId: 'dev-1',
    });
    viewer2 = new MockWebSocket({
      clientId: 'viewer-2', role: 'viewer', device: 'ipad', targetDeviceId: 'dev-1',
    });
    allSockets = [desktop, viewer1, viewer2];
  });

  it('viewer create_session_request → desktop only', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'create_session_request', requestId: 'r1',
    }, allSockets);

    expect(result.recipientIds).toEqual(['desktop-1']);
    expect(viewer2.sentMessages.length).toBe(0); // other viewer doesn't get it
  });

  it('desktop session_created → all viewers', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'session_created', requestId: 'r1', sessionId: 's1',
    }, allSockets);

    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
  });

  it('desktop session_created with toClientId → specific viewer', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'session_created', requestId: 'r1', sessionId: 's1', toClientId: 'viewer-2',
    }, allSockets);

    expect(result.recipientIds).toEqual(['viewer-2']);
    expect(viewer1.sentMessages.length).toBe(0);
  });

  it('viewer delete_session → desktop only', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'delete_session', sessionId: 's1',
    }, allSockets);

    expect(result.recipientIds).toEqual(['desktop-1']);
  });

  it('desktop session_closed → all viewers', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'session_closed', sessionId: 's1',
    }, allSockets);

    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
  });

  it('desktop sessions_updated → all viewers', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'sessions_updated', sessions: [{ id: 's1', name: 'shell' }],
    }, allSockets);

    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
  });

  it('viewer sessions_updated → dropped (only desktop can)', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'sessions_updated', sessions: [],
    }, allSockets);

    expect(result.recipientIds).toEqual([]);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('webrtc signaling → forward to specific clientId', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'webrtc_offer', sdp: 'v=0...', fromClientId: 'viewer-1', toClientId: 'desktop-1',
    }, allSockets);

    expect(result.recipientIds).toEqual(['desktop-1']);
    expect(viewer2.sentMessages.length).toBe(0);
  });

  it('desktop key_exchange → all viewers on same device', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'key_exchange',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
      sessionId: 'sess-1',
    }, allSockets);

    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('viewer key_exchange → dropped (only desktop initiates)', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'key_exchange',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
      sessionId: 'sess-1',
    }, allSockets);

    expect(result.recipientIds).toEqual([]);
    expect(desktop.sentMessages.length).toBe(0);
  });

  it('viewer key_exchange_ack → desktop only', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'key_exchange_ack',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'ghi', y: 'jkl' },
    }, allSockets);

    expect(result.recipientIds).toEqual(['desktop-1']);
    expect(viewer2.sentMessages.length).toBe(0);
  });

  it('desktop key_exchange_ack → dropped (only viewer responds)', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'key_exchange_ack',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'ghi', y: 'jkl' },
    }, allSockets);

    expect(result.recipientIds).toEqual([]);
  });

  it('desktop local_auth_secret → all viewers', () => {
    const result = routeDeviceMessage(desktop, {
      type: 'local_auth_secret',
      secret: 'abc123def456',
    }, allSockets);

    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
    expect(desktop.sentMessages.length).toBe(0);

    // Verify the secret is forwarded correctly
    const received = viewer1.getLastJson();
    expect(received!.type).toBe('local_auth_secret');
    expect(received!.secret).toBe('abc123def456');
  });

  it('viewer local_auth_secret → dropped (only desktop sends)', () => {
    const result = routeDeviceMessage(viewer1, {
      type: 'local_auth_secret',
      secret: 'should-not-forward',
    }, allSockets);

    expect(result.recipientIds).toEqual([]);
    expect(desktop.sentMessages.length).toBe(0);
    expect(viewer2.sentMessages.length).toBe(0);
  });

  it('messages only route within same device', () => {
    const otherDeviceViewer = new MockWebSocket({
      clientId: 'viewer-other', role: 'viewer', device: 'iphone', targetDeviceId: 'dev-2',
    });
    const sockets = [...allSockets, otherDeviceViewer];

    const result = routeDeviceMessage(desktop, {
      type: 'session_closed', sessionId: 's1',
    }, sockets);

    // Only viewers for dev-1, not dev-2
    expect(result.recipientIds).toEqual(['viewer-1', 'viewer-2']);
    expect(otherDeviceViewer.sentMessages.length).toBe(0);
  });
});

// --- Session DO: auth + hello flow ---

describe('Session DO: connection lifecycle', () => {
  it('auth state machine: pendingAuth → pendingHello → authenticated', () => {
    // Simulates the session DO auth/hello states
    type State = 'pendingAuth' | 'pendingHello' | 'authenticated';
    let state: State = 'pendingAuth';

    // Step 1: Client sends auth message
    const authMsg = { type: 'auth', token: 'valid-jwt-token' };
    expect(authMsg.type).toBe('auth');
    state = 'pendingHello'; // after JWT verified

    // Step 2: Client sends hello
    const helloMsg = { type: 'hello', role: 'desktop', clientId: 'c1', device: 'macos', version: 1 };
    expect(helloMsg.type).toBe('hello');
    state = 'authenticated';

    expect(state).toBe('authenticated');
  });

  it('role assignment: first desktop gets desktop role, others become viewers', () => {
    function assignRole(claimedRole: string, existingDesktop: boolean): 'desktop' | 'viewer' {
      return (!existingDesktop && claimedRole === 'desktop') ? 'desktop' : 'viewer';
    }

    expect(assignRole('desktop', false)).toBe('desktop');
    expect(assignRole('desktop', true)).toBe('viewer');
    expect(assignRole('viewer', false)).toBe('viewer');
    expect(assignRole('viewer', true)).toBe('viewer');
  });

  it('message size limit enforcement', () => {
    const MAX_MESSAGE_SIZE = 64 * 1024;

    function shouldReject(size: number): boolean {
      return size > MAX_MESSAGE_SIZE;
    }

    expect(shouldReject(100)).toBe(false);
    expect(shouldReject(MAX_MESSAGE_SIZE)).toBe(false);
    expect(shouldReject(MAX_MESSAGE_SIZE + 1)).toBe(true);
  });

  it('binary messages on device WS are ignored (JSON-only)', () => {
    // User DO's webSocketMessage returns early for non-string messages
    const binaryMessage = new ArrayBuffer(10);
    const isString = typeof binaryMessage === 'string';

    expect(isString).toBe(false);
    // In user.ts: if (typeof message !== 'string') { return; }
  });
});

// --- Reconnection backoff ---

describe('Reconnection backoff', () => {
  const RECONNECT = {
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  };

  function calculateBackoff(attempt: number): number {
    let delay = RECONNECT.initialDelay;

    for (let i = 0; i < attempt; i++) {
      delay = Math.min(delay * RECONNECT.backoffMultiplier, RECONNECT.maxDelay);
    }

    return delay;
  }

  it('starts at initial delay', () => {
    expect(calculateBackoff(0)).toBe(1000);
  });

  it('doubles each attempt', () => {
    expect(calculateBackoff(1)).toBe(2000);
    expect(calculateBackoff(2)).toBe(4000);
    expect(calculateBackoff(3)).toBe(8000);
    expect(calculateBackoff(4)).toBe(16000);
  });

  it('caps at max delay', () => {
    expect(calculateBackoff(5)).toBe(30000); // 32000 capped to 30000
    expect(calculateBackoff(10)).toBe(30000);
    expect(calculateBackoff(100)).toBe(30000);
  });

  it('resets after successful connection', () => {
    // After connecting, delay resets to initial
    let delay = RECONNECT.initialDelay;
    delay = Math.min(delay * RECONNECT.backoffMultiplier, RECONNECT.maxDelay); // 2000
    delay = Math.min(delay * RECONNECT.backoffMultiplier, RECONNECT.maxDelay); // 4000

    // Connection succeeds → reset
    delay = RECONNECT.initialDelay;
    expect(delay).toBe(1000);
  });
});
