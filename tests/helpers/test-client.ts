import * as net from 'net';
import {
  Frame,
  FrameType,
  FrameDecoder,
  DaemonMessage,
  ControlMessage,
  encodeControl,
  encodePtyInput,
  parseControlPayload,
  parseBinaryPayload,
} from '@nepsis/shared';

export interface OutputChunk {
  sessionId: string;
  data: Buffer;
}

export interface TestClient {
  connect: () => Promise<void>;
  sendControl: (msg: ControlMessage) => void;
  sendInput: (sessionId: string, data: Buffer) => void;
  waitForMessage: (
    predicate: (msg: DaemonMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<DaemonMessage>;
  waitForOutput: (timeoutMs?: number) => Promise<OutputChunk>;
  waitForSnapshot: (timeoutMs?: number) => Promise<OutputChunk>;
  close: () => void;
  messages: DaemonMessage[];
  outputChunks: OutputChunk[];
  snapshotChunks: OutputChunk[];
}

export function createTestClient(socketPath: string): TestClient {
  const socket = new net.Socket();
  const decoder = new FrameDecoder((frame: Frame) => handleFrame(frame));

  const messages: DaemonMessage[] = [];
  const outputChunks: OutputChunk[] = [];
  const snapshotChunks: OutputChunk[] = [];

  // Queues for pending waiters
  const messageWaiters: Array<{
    predicate: (msg: DaemonMessage) => boolean;
    resolve: (msg: DaemonMessage) => void;
  }> = [];
  const outputWaiters: Array<{ resolve: (chunk: OutputChunk) => void }> = [];
  const snapshotWaiters: Array<{ resolve: (chunk: OutputChunk) => void }> = [];

  function handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Control: {
        const msg = parseControlPayload(frame.payload) as DaemonMessage;
        messages.push(msg);
        // Check if any waiter matches
        for (let i = 0; i < messageWaiters.length; i++) {
          if (messageWaiters[i].predicate(msg)) {
            const waiter = messageWaiters.splice(i, 1)[0];
            waiter.resolve(msg);
            break;
          }
        }
        break;
      }
      case FrameType.PtyOutput: {
        const { sessionId, data } = parseBinaryPayload(frame.payload);
        const chunk = { sessionId, data };
        outputChunks.push(chunk);
        if (outputWaiters.length > 0) {
          outputWaiters.shift()!.resolve(chunk);
        }
        break;
      }
      case FrameType.Snapshot: {
        const { sessionId, data } = parseBinaryPayload(frame.payload);
        const chunk = { sessionId, data };
        snapshotChunks.push(chunk);
        if (snapshotWaiters.length > 0) {
          snapshotWaiters.shift()!.resolve(chunk);
        }
        break;
      }
    }
  }

  socket.on('data', (chunk: Buffer) => decoder.push(chunk));

  return {
    messages,
    outputChunks,
    snapshotChunks,

    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.connect(socketPath, () => {
          socket.removeListener('error', reject);
          resolve();
        });
      });
    },

    sendControl(msg: ControlMessage): void {
      socket.write(encodeControl(msg));
    },

    sendInput(sessionId: string, data: Buffer): void {
      socket.write(encodePtyInput(sessionId, data));
    },

    waitForMessage(
      predicate: (msg: DaemonMessage) => boolean,
      timeoutMs = 5000,
    ): Promise<DaemonMessage> {
      // Check already-received messages first
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = messageWaiters.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) messageWaiters.splice(idx, 1);
          reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        messageWaiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },

    waitForOutput(timeoutMs = 5000): Promise<OutputChunk> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`waitForOutput timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        outputWaiters.push({
          resolve: (chunk) => {
            clearTimeout(timer);
            resolve(chunk);
          },
        });
      });
    },

    waitForSnapshot(timeoutMs = 5000): Promise<OutputChunk> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`waitForSnapshot timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        snapshotWaiters.push({
          resolve: (chunk) => {
            clearTimeout(timer);
            resolve(chunk);
          },
        });
      });
    },

    close(): void {
      socket.destroy();
    },
  };
}

/**
 * Helper: collect all PTY output for a session until a timeout or predicate match.
 */
export function collectOutput(
  client: TestClient,
  sessionId: string,
  opts: { untilContains?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { untilContains, timeoutMs = 3000 } = opts;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Return whatever we collected so far
      const collected = client.outputChunks
        .filter((c) => c.sessionId === sessionId)
        .map((c) => c.data.toString())
        .join('');
      resolve(collected);
    }, timeoutMs);

    if (untilContains) {
      const check = setInterval(() => {
        const collected = client.outputChunks
          .filter((c) => c.sessionId === sessionId)
          .map((c) => c.data.toString())
          .join('');
        if (collected.includes(untilContains)) {
          clearTimeout(timer);
          clearInterval(check);
          resolve(collected);
        }
      }, 50);
    }
  });
}
