import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startTestDaemon, TestDaemon } from '../helpers/test-daemon';
import { createTestClient, TestClient } from '../helpers/test-client';
import { SessionStartedMessage, SessionsListMessage } from '@nepsis/shared';

let td: TestDaemon;
const clients: TestClient[] = [];

beforeAll(async () => {
  td = await startTestDaemon();
});

afterEach(() => {
  // Kill any lingering sessions by closing clients — sessions persist,
  // but each test file gets its own daemon so it's fine
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

describe('list sessions flow', () => {
  it('returns empty list when no sessions exist', async () => {
    const c = client();
    await c.connect();
    c.sendControl({ type: 'list_sessions' });

    const msg = await c.waitForMessage((m) => m.type === 'sessions');
    const sessions = msg as SessionsListMessage;
    expect(sessions.list).toEqual([]);
  });

  it('returns spawned session in list', async () => {
    const c = client();
    await c.connect();

    // Spawn a long-running session
    c.sendControl({ type: 'spawn', cmd: 'sleep', args: ['60'], cols: 80, rows: 24 });
    const started = (await c.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;

    // Now list
    c.sendControl({ type: 'list_sessions' });
    const msg = await c.waitForMessage((m) => m.type === 'sessions');
    const sessions = msg as SessionsListMessage;

    expect(sessions.list.length).toBe(1);
    expect(sessions.list[0].id).toBe(started.session.id);
    expect(sessions.list[0].cmd).toBe('sleep');
    expect(sessions.list[0].createdAt).toBeLessThanOrEqual(Date.now());

    // Cleanup
    c.sendControl({ type: 'kill', sessionId: started.session.id });
    await c.waitForMessage((m) => m.type === 'session_ended');
  });

  it('returns multiple sessions', async () => {
    const c = client();
    await c.connect();

    c.sendControl({ type: 'spawn', cmd: 'sleep', args: ['60'], cols: 80, rows: 24 });
    const s1 = (await c.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;

    c.sendControl({ type: 'spawn', cmd: 'sleep', args: ['61'], cols: 80, rows: 24 });
    const s2 = (await c.waitForMessage(
      (m) => m.type === 'session_started' && (m as SessionStartedMessage).session.id !== s1.session.id,
    )) as SessionStartedMessage;

    c.sendControl({ type: 'list_sessions' });
    const msg = await c.waitForMessage((m) => m.type === 'sessions');
    const sessions = msg as SessionsListMessage;

    expect(sessions.list.length).toBe(2);
    const ids = sessions.list.map((s) => s.id).sort();
    expect(ids).toEqual([s1.session.id, s2.session.id].sort());

    // Cleanup
    c.sendControl({ type: 'kill', sessionId: s1.session.id });
    c.sendControl({ type: 'kill', sessionId: s2.session.id });
    await c.waitForMessage((m) => m.type === 'session_ended');
    await c.waitForMessage(
      (m) => m.type === 'session_ended' && (m as any).sessionId !== s1.session.id,
    );
  });
});
