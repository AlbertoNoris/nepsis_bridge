import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startTestDaemon, TestDaemon } from '../helpers/test-daemon';
import { createTestClient, collectOutput, TestClient } from '../helpers/test-client';
import { SessionStartedMessage, SessionsListMessage } from '@nepsis/shared';

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

describe('session persistence flow', () => {
  it('session survives client disconnect', async () => {
    const c1 = client();
    await c1.connect();

    c1.sendControl({ type: 'spawn', cmd: 'sleep', args: ['60'], cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    // Disconnect c1
    c1.close();
    clients.length = 0;

    await new Promise((r) => setTimeout(r, 300));

    // New client checks session is still alive
    const c2 = client();
    await c2.connect();
    c2.sendControl({ type: 'list_sessions' });
    const list = (await c2.waitForMessage(
      (m) => m.type === 'sessions',
    )) as SessionsListMessage;

    expect(list.list.length).toBe(1);
    expect(list.list[0].id).toBe(sid);

    // Cleanup
    c2.sendControl({ type: 'kill', sessionId: sid });
    await c2.waitForMessage((m) => m.type === 'session_ended');
  });

  it('reattach after disconnect restores session with snapshot', async () => {
    const c1 = client();
    await c1.connect();

    c1.sendControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    await new Promise((r) => setTimeout(r, 200));

    // Write a marker
    c1.sendInput(sid, Buffer.from('echo before-disconnect-789\n'));
    await collectOutput(c1, sid, { untilContains: 'before-disconnect-789', timeoutMs: 3000 });

    // Disconnect
    c1.close();
    clients.length = 0;

    await new Promise((r) => setTimeout(r, 300));

    // Reattach
    const c2 = client();
    await c2.connect();
    c2.sendControl({ type: 'attach', sessionId: sid });

    const snapshot = await c2.waitForSnapshot(5000);
    expect(snapshot.data.toString()).toContain('before-disconnect-789');

    // Cleanup
    c2.sendControl({ type: 'kill', sessionId: sid });
  });

  it('session accepts input after reattach', async () => {
    const c1 = client();
    await c1.connect();

    c1.sendControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    // Disconnect
    c1.close();
    clients.length = 0;

    await new Promise((r) => setTimeout(r, 300));

    // Reattach
    const c2 = client();
    await c2.connect();
    c2.sendControl({ type: 'attach', sessionId: sid });
    await c2.waitForSnapshot(5000);

    await new Promise((r) => setTimeout(r, 200));

    // Send input after reattach
    c2.sendInput(sid, Buffer.from('echo after-reattach-456\n'));
    const output = await collectOutput(c2, sid, {
      untilContains: 'after-reattach-456',
      timeoutMs: 3000,
    });
    expect(output).toContain('after-reattach-456');

    // Cleanup
    c2.sendControl({ type: 'kill', sessionId: sid });
  });
});
