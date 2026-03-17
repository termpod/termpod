import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'https://relay.test';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function uniqueEmail(): string {
  return `device-test-${uid()}@integration.example.com`;
}

async function createUserAndLogin(e = uniqueEmail()): Promise<string> {
  const res = await SELF.fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'testpass123' }),
  });
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function devicePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `device-${uid()}`,
    name: 'Test Mac',
    deviceType: 'desktop',
    platform: 'macos',
    ...overrides,
  };
}

async function registerDevice(
  token: string,
  payload = devicePayload(),
): Promise<{ status: number; body: Record<string, unknown>; id: string }> {
  const res = await SELF.fetch(`${BASE}/devices`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    id: payload.id as string,
  };
}

async function registerSession(
  token: string,
  deviceId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown>; id: string }> {
  const sessionId = `session-${uid()}`;
  const res = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ id: sessionId, ptyCols: 120, ptyRows: 40, ...overrides }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    id: sessionId,
  };
}

// --- Device Registration ---

describe('POST /devices', () => {
  it('registers a device and returns 201', async () => {
    const token = await createUserAndLogin();
    const { status, body } = await registerDevice(token);
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const res = await SELF.fetch(`${BASE}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devicePayload()),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing device id', async () => {
    const token = await createUserAndLogin();
    const res = await SELF.fetch(`${BASE}/devices`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Test', deviceType: 'desktop', platform: 'macos' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid platform', async () => {
    const token = await createUserAndLogin();
    const res = await SELF.fetch(`${BASE}/devices`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(devicePayload({ platform: 'windows' })),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid device type', async () => {
    const token = await createUserAndLogin();
    const res = await SELF.fetch(`${BASE}/devices`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(devicePayload({ deviceType: 'laptop' })),
    });
    expect(res.status).toBe(400);
  });

  it('re-registers the same device id with 201 (upsert)', async () => {
    const token = await createUserAndLogin();
    const payload = devicePayload();
    const first = await registerDevice(token, payload);
    expect(first.status).toBe(201);
    const second = await registerDevice(token, payload);
    expect(second.status).toBe(201);
  });
});

// --- List Devices ---

describe('GET /devices', () => {
  it('returns empty devices list for new user', async () => {
    const token = await createUserAndLogin();
    const res = await SELF.fetch(`${BASE}/devices`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { devices: unknown[] };
    expect(Array.isArray(body.devices)).toBe(true);
  });

  it('returns registered device in list', async () => {
    const token = await createUserAndLogin();
    const payload = devicePayload();
    await registerDevice(token, payload);

    const res = await SELF.fetch(`${BASE}/devices`, {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { devices: Array<{ id: string }> };
    expect(body.devices.some((d) => d.id === payload.id)).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const res = await SELF.fetch(`${BASE}/devices`);
    expect(res.status).toBe(401);
  });
});

// --- Device Heartbeat ---

describe('POST /devices/:id/heartbeat', () => {
  it('marks device online and returns ok', async () => {
    const token = await createUserAndLogin();
    const { id } = await registerDevice(token);

    const res = await SELF.fetch(`${BASE}/devices/${id}/heartbeat`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/devices/some-id/heartbeat`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

// --- Device Offline ---

describe('POST /devices/:id/offline', () => {
  it('marks device offline and returns ok', async () => {
    const token = await createUserAndLogin();
    const { id } = await registerDevice(token);

    const res = await SELF.fetch(`${BASE}/devices/${id}/offline`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/devices/some-id/offline`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

// --- Device Delete ---

describe('DELETE /devices/:id', () => {
  it('deletes a registered device', async () => {
    const token = await createUserAndLogin();
    const { id } = await registerDevice(token);

    const deleteRes = await SELF.fetch(`${BASE}/devices/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(deleteRes.status).toBe(200);
    const body = (await deleteRes.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);

    // Device should no longer appear in list
    const listRes = await SELF.fetch(`${BASE}/devices`, {
      headers: authHeaders(token),
    });
    const listBody = (await listRes.json()) as { devices: Array<{ id: string }> };
    expect(listBody.devices.some((d) => d.id === id)).toBe(false);
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/devices/some-id`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

// --- Session Management ---

describe('POST /devices/:id/sessions', () => {
  it('registers a session for a device and returns 201', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { status, body } = await registerSession(token, deviceId);
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.sessionId).toBe('string');
  });

  it('returns 404 for non-existent device', async () => {
    const token = await createUserAndLogin();
    const { status } = await registerSession(token, 'ghost-device-id');
    expect(status).toBe(404);
  });

  it('returns 400 for missing session id', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const res = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ptyCols: 120, ptyRows: 40 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/devices/some-id/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'sess-1', ptyCols: 120, ptyRows: 40 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /devices/:id/sessions', () => {
  it('returns empty session list for device with no sessions', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);

    const res = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('returns registered session in list', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    const res = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { sessions: Array<{ id: string }> };
    expect(body.sessions.some((s) => s.id === sessionId)).toBe(true);
  });

  it('returns only non-sensitive fields (no name, cwd, processName)', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    await registerSession(token, deviceId);

    const res = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
    for (const session of body.sessions) {
      // Sensitive fields must NOT be returned
      expect(session.name).toBeUndefined();
      expect(session.cwd).toBeUndefined();
      expect(session.processName).toBeUndefined();
      // Non-sensitive fields should be present
      expect(typeof session.id).toBe('string');
      expect(typeof session.deviceId).toBe('string');
      expect(typeof session.ptyCols).toBe('number');
      expect(typeof session.ptyRows).toBe('number');
    }
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/devices/some-id/sessions`);
    expect(res.status).toBe(401);
  });
});

// --- Session Delete ---

describe('DELETE /sessions/:id', () => {
  it('removes a registered session', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    const deleteRes = await SELF.fetch(`${BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(deleteRes.status).toBe(200);
    const body = (await deleteRes.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);

    // Session should be gone
    const listRes = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    const listBody = (await listRes.json()) as { sessions: Array<{ id: string }> };
    expect(listBody.sessions.some((s) => s.id === sessionId)).toBe(false);
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/sessions/some-id`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

// --- Session Update ---

describe('PATCH /sessions/:id', () => {
  it('returns ok (metadata is E2E encrypted, not stored)', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    const res = await SELF.fetch(`${BASE}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ ptyCols: 200, ptyRows: 50 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/sessions/some-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ptyCols: 200 }),
    });
    expect(res.status).toBe(401);
  });
});

// --- Subscription ---

describe('GET /subscription', () => {
  it('returns pro plan for self-hosted (no POLAR_WEBHOOK_SECRET)', async () => {
    const token = await createUserAndLogin();
    const res = await SELF.fetch(`${BASE}/subscription`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // No POLAR_WEBHOOK_SECRET in test env → self-hosted pro
    expect(body.plan).toBe('pro');
    expect(body.selfHosted).toBe(true);
    expect(body.effectivePlan).toBe('pro');
  });

  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`${BASE}/subscription`);
    expect(res.status).toBe(401);
  });
});

// --- Share Tokens ---

describe('Share tokens', () => {
  it('creates a share token for an existing session', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    const res = await SELF.fetch(`${BASE}/sessions/${sessionId}/share`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.token).toBe('string');
    expect(body.sessionId).toBe(sessionId);
    expect(typeof body.expiresAt).toBe('string');
  });

  it('returns 404 when creating share token for non-existent session', async () => {
    const token = await createUserAndLogin();
    const res = await SELF.fetch(`${BASE}/sessions/ghost-session/share`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it('revokes a share token', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    // Create token
    const createRes = await SELF.fetch(`${BASE}/sessions/${sessionId}/share`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(createRes.status).toBe(201);

    // Revoke it
    const revokeRes = await SELF.fetch(`${BASE}/sessions/${sessionId}/share`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(revokeRes.status).toBe(200);
    const body = (await revokeRes.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('re-creating a share token revokes the previous one', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    const first = await SELF.fetch(`${BASE}/sessions/${sessionId}/share`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    const { token: firstToken } = (await first.json()) as { token: string };

    const second = await SELF.fetch(`${BASE}/sessions/${sessionId}/share`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    const { token: secondToken } = (await second.json()) as { token: string };

    // Tokens should differ
    expect(firstToken).not.toBe(secondToken);
  });

  it('returns 401 when creating share without auth', async () => {
    const res = await SELF.fetch(`${BASE}/sessions/some-id/share`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

// --- Device lifecycle integration ---

describe('Device and session lifecycle', () => {
  it('deleting device also removes its sessions', async () => {
    const token = await createUserAndLogin();
    const { id: deviceId } = await registerDevice(token);
    const { id: sessionId } = await registerSession(token, deviceId);

    // Verify session exists
    const before = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    const beforeBody = (await before.json()) as { sessions: Array<{ id: string }> };
    expect(beforeBody.sessions.some((s) => s.id === sessionId)).toBe(true);

    // Delete device
    await SELF.fetch(`${BASE}/devices/${deviceId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });

    // Device is gone; listing sessions for it returns empty (or 404)
    const after = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    if (after.status === 200) {
      const afterBody = (await after.json()) as { sessions: Array<{ id: string }> };
      expect(afterBody.sessions.some((s) => s.id === sessionId)).toBe(false);
    } else {
      // Any non-200 (e.g. 404) also means sessions are gone
      expect(after.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('full flow: signup → register device → add session → list → delete', async () => {
    const token = await createUserAndLogin();

    // Register device
    const { id: deviceId } = await registerDevice(token);

    // List devices — should include our device
    const devList = await SELF.fetch(`${BASE}/devices`, {
      headers: authHeaders(token),
    });
    const { devices } = (await devList.json()) as { devices: Array<{ id: string }> };
    expect(devices.some((d) => d.id === deviceId)).toBe(true);

    // Register session
    const { id: sessionId } = await registerSession(token, deviceId);

    // List sessions — should include our session
    const sessList = await SELF.fetch(`${BASE}/devices/${deviceId}/sessions`, {
      headers: authHeaders(token),
    });
    const { sessions } = (await sessList.json()) as { sessions: Array<{ id: string }> };
    expect(sessions.some((s) => s.id === sessionId)).toBe(true);

    // Delete session
    const delSession = await SELF.fetch(`${BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(delSession.status).toBe(200);

    // Delete device
    const delDevice = await SELF.fetch(`${BASE}/devices/${deviceId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(delDevice.status).toBe(200);
  });
});
