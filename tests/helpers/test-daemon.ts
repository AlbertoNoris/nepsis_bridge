import { randomUUID } from 'crypto';
import { Daemon } from '@nepsis/daemon/daemon';

export interface TestDaemon {
  daemon: Daemon;
  socketPath: string;
  cleanup: () => Promise<void>;
}

export interface TestDaemonOptions {
  relayUrl?: string;
  bridgeId?: string;
}

export async function startTestDaemon(opts?: TestDaemonOptions): Promise<TestDaemon> {
  const socketPath = `/tmp/rr-test-${randomUUID()}.sock`;
  const daemon = new Daemon({
    socketPath,
    relayUrl: opts?.relayUrl,
    bridgeId: opts?.bridgeId,
  });
  await daemon.start();

  return {
    daemon,
    socketPath,
    cleanup: async () => {
      await daemon.stop();
    },
  };
}
