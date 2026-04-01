import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startTestDaemon, TestDaemon } from '../helpers/test-daemon';
import { createTestClient, TestClient } from '../helpers/test-client';
import {
  SessionStartedMessage,
  SessionEndedMessage,
  SessionsListMessage,
} from '@nepsis/shared';

let td: TestDaemon;
const clients: TestClient[] = [];

beforeAll(async () => {
  td = await startTestDaemon();
});

afterEach(() => {
  for (const c of clients) c.close();
  clients.length = 0;
});

afterAll(async () => {
  await td.cleanup();
});

function client(): TestClient {
  const c = createTestClient(td.socketPath);
  clients.push(c);
  return c;
}

describe('kill flow', () => {
  it('kill terminates a running session', async () => {
    const c = client();
    await c.connect();

    c.sendControl({ type: 'spawn', cmd: 'sleep', args: ['60'], cols: 80, rows: 24 });
    const started = (await c.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;

    c.sendControl({ type: 'kill', sessionId: started.session.id });
    const ended = (await c.waitForMessage(
      (m) => m.type === 'session_ended',
    )) as SessionEndedMessage;
    expect(ended.sessionId).toBe(started.session.id);

    // Verify session is gone from list
    c.sendControl({ type: 'list_sessions' });
    const list = (await c.waitForMessage(
      (m) => m.type === 'sessions',
    )) as SessionsListMessage;
    expect(list.list.length).toBe(0);
  });

  it('kill nonexistent session returns error', async () => {
    const c = client();
    await c.connect();

    c.sendControl({ type: 'kill', sessionId: '00000000-0000-0000-0000-000000000000' });
    const msg = await c.waitForMessage((m) => m.type === 'error');
    expect((msg as any).message).toContain('not found');
  });

  it('kill notifies all attached clients', async () => {
    const c1 = client();
    const c2 = client();
    await c1.connect();
    await c2.connect();

    // c1 spawns
    c1.sendControl({ type: 'spawn', cmd: 'sleep', args: ['60'], cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;

    // c2 also gets notified of session_started (broadcast)
    await c2.waitForMessage((m) => m.type === 'session_started');

    // c2 attaches
    c2.sendControl({ type: 'attach', sessionId: started.session.id });

    // c1 kills
    c1.sendControl({ type: 'kill', sessionId: started.session.id });

    // Both should receive session_ended
    const ended1 = await c1.waitForMessage((m) => m.type === 'session_ended');
    const ended2 = await c2.waitForMessage((m) => m.type === 'session_ended');
    expect((ended1 as SessionEndedMessage).sessionId).toBe(started.session.id);
    expect((ended2 as SessionEndedMessage).sessionId).toBe(started.session.id);
  });
});
