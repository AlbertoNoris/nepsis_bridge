import {
  FrameType,
  parseControlPayload,
  parseBinaryPayload,
} from '@nepsis/shared';
import { Client } from './client';

const HEADER_SIZE = 5; // 4 (length) + 1 (type)

/**
 * Virtual client representing a mobile device connected through the relay.
 * Each WebSocket binary message is one complete nepsis frame.
 */
export class RelayClient extends Client {
  readonly id: string;
  readonly deviceName: string;
  readonly clientIndex: number;
  private sendFn: (frame: Buffer) => void;

  constructor(
    id: string,
    deviceName: string,
    clientIndex: number,
    sendFn: (frame: Buffer) => void,
  ) {
    super();
    this.id = id;
    this.deviceName = deviceName;
    this.clientIndex = clientIndex;
    this.sendFn = sendFn;
  }

  send(frame: Buffer): void {
    this.sendFn(frame);
  }

  close(): void {
    this.emit('close');
  }

  /**
   * Feed a complete nepsis frame (received from relay as one WS message).
   * Parses and emits the appropriate event for the daemon.
   */
  handleFrame(frame: Buffer): void {
    if (frame.length < HEADER_SIZE) return;

    const type: FrameType = frame[4];
    const payload = frame.subarray(HEADER_SIZE);

    if (type === FrameType.Control) {
      const msg = parseControlPayload(payload);
      this.emit('message', msg);
    } else if (type === FrameType.PtyInput) {
      const { sessionId, data } = parseBinaryPayload(payload);
      this.emit('input', sessionId, data);
    }
  }
}
