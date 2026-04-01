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

describe('multi-client flow', () => {
  it('two clients attached to same session both receive output', async () => {
    const c1 = client();
    const c2 = client();
    await c1.connect();
    await c2.connect();

    // c1 spawns bash
    c1.sendControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    // c2 attaches
    c2.sendControl({ type: 'attach', sessionId: sid });
    await c2.waitForSnapshot(5000);

    await new Promise((r) => setTimeout(r, 200));

    // c1 sends input
    c1.sendInput(sid, Buffer.from('echo shared-output-42\n'));

    // Both should receive it
    const [out1, out2] = await Promise.all([
      collectOutput(c1, sid, { untilContains: 'shared-output-42', timeoutMs: 3000 }),
      collectOutput(c2, sid, { untilContains: 'shared-output-42', timeoutMs: 3000 }),
    ]);

    expect(out1).toContain('shared-output-42');
    expect(out2).toContain('shared-output-42');

    c1.sendControl({ type: 'kill', sessionId: sid });
  });

  it('second client can send input visible to first', async () => {
    const c1 = client();
    const c2 = client();
    await c1.connect();
    await c2.connect();

    c1.sendControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });
    const started = (await c1.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    c2.sendControl({ type: 'attach', sessionId: sid });
    await c2.waitForSnapshot(5000);

    await new Promise((r) => setTimeout(r, 200));

    // c2 sends input
    c2.sendInput(sid, Buffer.from('echo from-client-b\n'));

    // c1 should see the output
    const out1 = await collectOutput(c1, sid, {
      untilContains: 'from-client-b',
      timeoutMs: 3000,
    });
    expect(out1).toContain('from-client-b');

    c1.sendControl({ type: 'kill', sessionId: sid });
  });
});
