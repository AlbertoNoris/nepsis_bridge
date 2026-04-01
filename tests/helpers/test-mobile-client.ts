import WebSocket from 'ws';
import {
  FrameType,
  DaemonMessage,
  ClientMessage,
  encodeControl,
  encodePtyInput,
  parseControlPayload,
  parseBinaryPayload,
} from '@nepsis/shared';

const HEADER_SIZE = 5; // 4 (length) + 1 (type)

export interface OutputChunk {
  sessionId: string;
  data: Buffer;
}

export interface TestMobileClient {
  /** Send relay auth and await welcome + bridge_status */
  auth(pairingCode: string, deviceName?: string): Promise<{ clientId: string; reconnectToken: string }>;

  /** Raw JSON message from relay (for auth phase) */
  nextJson(timeoutMs?: number): Promise<any>;

  /** Send a nepsis Control frame as binary */
  sendControl(msg: ClientMessage): void;

  /** Send a nepsis PtyInput frame as binary */
  sendInput(sessionId: string, data: Buffer): void;

  /** Wait for a parsed Control message matching a predicate */
  waitForMessage(
    predicate: (msg: DaemonMessage) => boolean,
    timeoutMs?: number,
  ): Promise<DaemonMessage>;

  /** Wait for the next PtyOutput frame */
  waitForOutput(timeoutMs?: number): Promise<OutputChunk>;

  /** Collect PTY output until string appears or timeout */
  collectOutput(sessionId: string, opts?: { untilContains?: string; timeoutMs?: number }): Promise<string>;

  close(): void;
}

export function createTestMobileClient(relayUrl: string): Promise<TestMobileClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);

    // Raw message queues (for auth phase — JSON messages from relay)
    const jsonQueue: any[] = [];
    const jsonWaiters: ((msg: any) => void)[] = [];

    // Parsed nepsis frame queues (for after auth — binary messages)
    const messageQueue: DaemonMessage[] = [];
    const messageWaiters: Array<{
      predicate: (msg: DaemonMessage) => boolean;
      resolve: (msg: DaemonMessage) => void;
    }> = [];

    const outputQueue: OutputChunk[] = [];
    const outputWaiters: Array<{ resolve: (chunk: OutputChunk) => void }> = [];

    // All output chunks stored for collectOutput
    const allOutputChunks: OutputChunk[] = [];

    function handleBinaryMessage(raw: Buffer): void {
      if (raw.length < HEADER_SIZE) return;

      const payloadLen = raw.readUInt32BE(0);
      const type: FrameType = raw[4];
      const payload = raw.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);

      if (type === FrameType.Control) {
        const msg = parseControlPayload(payload) as DaemonMessage;
        messageQueue.push(msg);

        for (let i = 0; i < messageWaiters.length; i++) {
          if (messageWaiters[i].predicate(msg)) {
            const waiter = messageWaiters.splice(i, 1)[0];
            waiter.resolve(msg);
            break;
          }
        }
      } else if (type === FrameType.PtyOutput) {
        const { sessionId, data } = parseBinaryPayload(payload);
        const chunk = { sessionId, data };
        allOutputChunks.push(chunk);

        if (outputWaiters.length > 0) {
          outputWaiters.shift()!.resolve(chunk);
        } else {
          outputQueue.push(chunk);
        }
      }
      // Ignore Snapshot and PtyInput (shouldn't receive these as mobile)
    }

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        handleBinaryMessage(buf);
      } else {
        const msg = JSON.parse(raw.toString());
        const waiter = jsonWaiters.shift();
        if (waiter) waiter(msg);
        else jsonQueue.push(msg);
      }
    });

    ws.on('open', () => {
      resolve({
        async auth(pairingCode: string, deviceName = 'test-mobile'): Promise<{ clientId: string; reconnectToken: string }> {
          ws.send(JSON.stringify({
            type: 'client_auth',
            pairingCode,
            deviceName,
          }));

          const welcome = await this.nextJson();
          if (welcome.type !== 'client_welcome') {
            throw new Error(`Expected client_welcome, got ${welcome.type}: ${welcome.message || ''}`);
          }

          // Also consume bridge_status
          await this.nextJson();

          return { clientId: welcome.clientId, reconnectToken: welcome.reconnectToken };
        },

        nextJson(timeoutMs = 5000): Promise<any> {
          const queued = jsonQueue.shift();
          if (queued) return Promise.resolve(queued);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = jsonWaiters.indexOf(res);
              if (idx !== -1) jsonWaiters.splice(idx, 1);
              rej(new Error(`nextJson timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            jsonWaiters.push((msg) => {
              clearTimeout(timer);
              res(msg);
            });
          });
        },

        sendControl(msg: ClientMessage): void {
          ws.send(encodeControl(msg));
        },

        sendInput(sessionId: string, data: Buffer): void {
          ws.send(encodePtyInput(sessionId, data));
        },

        waitForMessage(
          predicate: (msg: DaemonMessage) => boolean,
          timeoutMs = 5000,
        ): Promise<DaemonMessage> {
          // Check already-received messages
          for (let i = 0; i < messageQueue.length; i++) {
            if (predicate(messageQueue[i])) {
              return Promise.resolve(messageQueue.splice(i, 1)[0]);
            }
          }

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
          const queued = outputQueue.shift();
          if (queued) return Promise.resolve(queued);

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

        collectOutput(
          sessionId: string,
          opts: { untilContains?: string; timeoutMs?: number } = {},
        ): Promise<string> {
          const { untilContains, timeoutMs = 3000 } = opts;

          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              const collected = allOutputChunks
                .filter((c) => c.sessionId === sessionId)
                .map((c) => c.data.toString())
                .join('');
              resolve(collected);
            }, timeoutMs);

            if (untilContains) {
              const check = setInterval(() => {
                const collected = allOutputChunks
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
        },

        close(): void {
          ws.close();
        },
      });
    });

    ws.on('error', reject);
  });
}
