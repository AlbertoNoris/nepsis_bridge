import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { startTestDaemon, TestDaemon } from '../helpers/test-daemon';
import { createTestMobileClient, TestMobileClient } from '../helpers/test-mobile-client';
import { patchDnsForRelay } from '../helpers/dns-workaround';

const RELAY_URL = 'wss://nepsis.stolenorbit.com';

let td: TestDaemon;
let pairingCode: string;

// Track mobile clients for cleanup
const mobiles: TestMobileClient[] = [];

async function waitForPairingCode(td: TestDaemon, timeoutMs = 10000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = td.daemon.pairingCode;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for pairing code from relay');
}

async function createPairedMobile(): Promise<TestMobileClient> {
  const mobile = await createTestMobileClient(RELAY_URL);
  mobiles.push(mobile);
  await mobile.auth(pairingCode);
  // Give daemon time to process client_joined
  await new Promise((r) => setTimeout(r, 200));
  return mobile;
}

beforeAll(async () => {
  // Workaround: iCloud Private Relay blocks system DNS for this domain
  await patchDnsForRelay();

  td = await startTestDaemon({
    relayUrl: RELAY_URL,
    bridgeId: `test-${randomUUID()}`,
  });
  pairingCode = await waitForPairingCode(td);
}, 15000);

afterEach(() => {
  // Close any mobile clients created during the test
  for (const mobile of mobiles) {
    mobile.close();
  }
  mobiles.length = 0;
});

afterAll(async () => {
  await td.cleanup();
}, 10000);

describe('bridge ↔ live relay', () => {
  it('daemon connects to live relay and gets a 6-char pairing code', () => {
    expect(pairingCode).toBeTruthy();
    expect(pairingCode).toHaveLength(6);
    expect(pairingCode).toMatch(/^[A-Z2-9]+$/); // excludes 0, 1, O, I, L
  });

  it('mobile pairs and can list sessions', async () => {
    const mobile = await createPairedMobile();

    mobile.sendControl({ type: 'list_sessions' });
    const msg = await mobile.waitForMessage((m) => m.type === 'sessions');

    expect(msg.type).toBe('sessions');
    expect((msg as any).list).toBeInstanceOf(Array);
  });

  it('mobile spawns a session and receives PTY output', async () => {
    const mobile = await createPairedMobile();

    mobile.sendControl({
      type: 'spawn',
      cmd: 'echo',
      args: ['relay-integration-test'],
      cols: 80,
      rows: 24,
    });

    const started = await mobile.waitForMessage((m) => m.type === 'session_started');
    expect(started.type).toBe('session_started');
    const sessionId = (started as any).session.id;

    // Collect PTY output until we see the echo'd string
    const output = await mobile.collectOutput(sessionId, {
      untilContains: 'relay-integration-test',
      timeoutMs: 5000,
    });
    expect(output).toContain('relay-integration-test');
  });

  it('mobile sends input to a session', async () => {
    const mobile = await createPairedMobile();

    // Spawn a shell
    mobile.sendControl({
      type: 'spawn',
      cmd: '/bin/sh',
      cols: 80,
      rows: 24,
    });

    const started = await mobile.waitForMessage((m) => m.type === 'session_started');
    const sessionId = (started as any).session.id;

    // Wait for shell prompt
    await new Promise((r) => setTimeout(r, 500));

    // Send a command via PTY input
    mobile.sendInput(sessionId, Buffer.from('echo relay-input-test\n'));

    // Verify the output arrives
    const output = await mobile.collectOutput(sessionId, {
      untilContains: 'relay-input-test',
      timeoutMs: 5000,
    });
    expect(output).toContain('relay-input-test');

    // Kill the session
    mobile.sendControl({ type: 'kill', sessionId });
    await mobile.waitForMessage((m) => m.type === 'session_ended');
  });

  it('mobile disconnect is handled cleanly', async () => {
    const mobile = await createPairedMobile();

    // Verify connected by listing sessions
    mobile.sendControl({ type: 'list_sessions' });
    await mobile.waitForMessage((m) => m.type === 'sessions');

    // Disconnect
    mobile.close();
    // Remove from tracked list since we closed it manually
    const idx = mobiles.indexOf(mobile);
    if (idx !== -1) mobiles.splice(idx, 1);

    // Give relay + daemon time to process disconnect
    await new Promise((r) => setTimeout(r, 500));

    // A new mobile can still pair and interact
    const mobile2 = await createPairedMobile();
    mobile2.sendControl({ type: 'list_sessions' });
    const msg = await mobile2.waitForMessage((m) => m.type === 'sessions');
    expect(msg.type).toBe('sessions');
  });

  it('second mobile can pair to the same code', async () => {
    const mobile1 = await createPairedMobile();
    const mobile2 = await createPairedMobile();

    // Both should be able to list sessions
    mobile1.sendControl({ type: 'list_sessions' });
    mobile2.sendControl({ type: 'list_sessions' });

    const [msg1, msg2] = await Promise.all([
      mobile1.waitForMessage((m) => m.type === 'sessions'),
      mobile2.waitForMessage((m) => m.type === 'sessions'),
    ]);

    expect(msg1.type).toBe('sessions');
    expect(msg2.type).toBe('sessions');
  });
});
