import { FrameType, ControlMessage } from './types';

// Wire format: [4 bytes BE uint32 = payload length][1 byte FrameType][payload]
// Total frame size = 5 + payload.length

const HEADER_SIZE = 5; // 4 (length) + 1 (type)

// --- Encoding ---

export function encodeFrame(type: FrameType, payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  frame[4] = type;
  payload.copy(frame, HEADER_SIZE);
  return frame;
}

export function encodeControl(msg: ControlMessage): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf-8');
  return encodeFrame(FrameType.Control, json);
}

export function encodePtyOutput(sessionId: string, data: Buffer): Buffer {
  const payload = Buffer.allocUnsafe(36 + data.length);
  payload.write(sessionId, 0, 36, 'utf-8');
  data.copy(payload, 36);
  return encodeFrame(FrameType.PtyOutput, payload);
}

export function encodePtyInput(sessionId: string, data: Buffer): Buffer {
  const payload = Buffer.allocUnsafe(36 + data.length);
  payload.write(sessionId, 0, 36, 'utf-8');
  data.copy(payload, 36);
  return encodeFrame(FrameType.PtyInput, payload);
}

export function encodeSnapshot(sessionId: string, data: Buffer): Buffer {
  const payload = Buffer.allocUnsafe(36 + data.length);
  payload.write(sessionId, 0, 36, 'utf-8');
  data.copy(payload, 36);
  return encodeFrame(FrameType.Snapshot, payload);
}

// --- Decoding ---

export interface Frame {
  type: FrameType;
  payload: Buffer;
}

export interface BinaryFrame {
  sessionId: string;
  data: Buffer;
}

export function parseControlPayload(payload: Buffer): ControlMessage {
  return JSON.parse(payload.toString('utf-8'));
}

export function parseBinaryPayload(payload: Buffer): BinaryFrame {
  const sessionId = payload.subarray(0, 36).toString('utf-8');
  const data = payload.subarray(36);
  return { sessionId, data };
}

/**
 * Streaming frame decoder for TCP/Unix socket streams.
 * Feed it chunks via push(), it emits complete frames via the callback.
 */
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private onFrame: (frame: Frame) => void;

  constructor(onFrame: (frame: Frame) => void) {
    this.onFrame = onFrame;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    this.drain();
  }

  private drain(): void {
    while (true) {
      if (this.buffered < HEADER_SIZE) return;

      const head = this.peek(HEADER_SIZE);
      const payloadLen = head.readUInt32BE(0);
      const totalLen = HEADER_SIZE + payloadLen;

      if (this.buffered < totalLen) return;

      const frame = this.consume(totalLen);
      const type: FrameType = frame[4];
      const payload = frame.subarray(HEADER_SIZE);
      this.onFrame({ type, payload });
    }
  }

  private peek(n: number): Buffer {
    if (this.chunks.length === 1 && this.chunks[0].length >= n) {
      return this.chunks[0].subarray(0, n);
    }
    return Buffer.concat(this.chunks).subarray(0, n);
  }

  private consume(n: number): Buffer {
    const buf = Buffer.concat(this.chunks);
    this.chunks = buf.length > n ? [buf.subarray(n)] : [];
    this.buffered -= n;
    return buf.subarray(0, n);
  }
}
