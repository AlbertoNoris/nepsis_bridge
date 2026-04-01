import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startTestDaemon, TestDaemon } from '../helpers/test-daemon';
import { createTestClient, collectOutput, TestClient } from '../helpers/test-client';
import { SessionStartedMessage } from '@nepsis/shared';

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

describe('attach flow', () => {
  it('attach to existing session sends snapshot', async () => {
    const c1 = client();
    await c1.connect();

    // Spawn bash and write something
    c1.sendControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    // Write a marker that will appear in the terminal buffer
    await new Promise((r) => setTimeout(r, 200));
    c1.sendInput(sid, Buffer.from('echo snapshot-marker-12345\n'));
    await collectOutput(c1, sid, { untilContains: 'snapshot-marker-12345', timeoutMs: 3000 });

    // Second client attaches
    const c2 = client();
    await c2.connect();
    c2.sendControl({ type: 'attach', sessionId: sid });

    const snapshot = await c2.waitForSnapshot(5000);
    expect(snapshot.sessionId).toBe(sid);
    expect(snapshot.data.length).toBeGreaterThan(0);
    expect(snapshot.data.toString()).toContain('snapshot-marker-12345');

    // Cleanup
    c1.sendControl({ type: 'kill', sessionId: sid });
  });

  it('attach to nonexistent session returns error', async () => {
    const c = client();
    await c.connect();

    c.sendControl({
      type: 'attach',
      sessionId: '00000000-0000-0000-0000-000000000000',
    });

    const msg = await c.waitForMessage((m) => m.type === 'error');
    expect((msg as any).message).toContain('not found');
  });

  it('attached client receives ongoing output', async () => {
    const c1 = client();
    await c1.connect();

    c1.sendControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    await new Promise((r) => setTimeout(r, 200));

    // Second client attaches
    const c2 = client();
    await c2.connect();
    c2.sendControl({ type: 'attach', sessionId: sid });
    await c2.waitForSnapshot(5000);

    // Now c1 sends input — c2 should see the output
    c1.sendInput(sid, Buffer.from('echo live-output-test\n'));

    const output = await collectOutput(c2, sid, {
      untilContains: 'live-output-test',
      timeoutMs: 3000,
    });
    expect(output).toContain('live-output-test');

    // Cleanup
    c1.sendControl({ type: 'kill', sessionId: sid });
  });
});
