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

describe('spawn flow', () => {
  it('spawn creates a session and returns session_started', async () => {
    const c = client();
    await c.connect();
    c.sendControl({ type: 'spawn', cmd: 'echo', args: ['hello'], cols: 80, rows: 24 });

    const msg = await c.waitForMessage((m) => m.type === 'session_started');
    expect(msg.type).toBe('session_started');
    const started = msg as SessionStartedMessage;
    expect(started.session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(started.session.cmd).toBe('echo');
    expect(started.session.cols).toBe(80);
    expect(started.session.rows).toBe(24);
  });

  it('spawn session streams PTY output to client', async () => {
    const c = client();
    await c.connect();
    c.sendControl({ type: 'spawn', cmd: 'echo', args: ['hello world'], cols: 80, rows: 24 });

    const started = (await c.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;

    const output = await collectOutput(c, started.session.id, {
      untilContains: 'hello world',
      timeoutMs: 3000,
    });
    expect(output).toContain('hello world');
  });

  it('client input reaches the PTY', async () => {
    const c = client();
    await c.connect();
    c.sendControl({ type: 'spawn', cmd: 'cat', cols: 80, rows: 24 });

    const started = (await c.waitForMessage(
      (m) => m.type === 'session_started',
    )) as SessionStartedMessage;
    const sid = started.session.id;

    // Small delay for PTY to be ready
    await new Promise((r) => setTimeout(r, 100));

    c.sendInput(sid, Buffer.from('typed text\n'));

    const output = await collectOutput(c, sid, {
      untilContains: 'typed text',
      timeoutMs: 3000,
    });
    expect(output).toContain('typed text');
  });

  it('session_ended fires when spawned process exits', async () => {
    const c = client();
    await c.connect();
    c.sendControl({ type: 'spawn', cmd: 'echo', args: ['bye'], cols: 80, rows: 24 });

    await c.waitForMessage((m) => m.type === 'session_started');
    const ended = await c.waitForMessage((m) => m.type === 'session_ended');
    expect(ended.type).toBe('session_ended');
    expect((ended as any).exitCode).toBe(0);
  });

  it('spawn with invalid command exits immediately', async () => {
    const c = client();
    await c.connect();
    c.sendControl({
      type: 'spawn',
      cmd: '/nonexistent/binary/xyz',
      cols: 80,
      rows: 24,
    });

    // node-pty spawns but the process exits immediately with a non-zero code
    await c.waitForMessage((m) => m.type === 'session_started');
    const ended = await c.waitForMessage((m) => m.type === 'session_ended');
    expect((ended as any).exitCode).not.toBe(0);
  });
});
