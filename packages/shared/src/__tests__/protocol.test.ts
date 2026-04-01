import { describe, it, expect } from 'vitest';
import {
  FrameType,
  encodeFrame,
  encodeControl,
  encodePtyOutput,
  encodePtyInput,
  encodeSnapshot,
  parseControlPayload,
  parseBinaryPayload,
  FrameDecoder,
  Frame,
} from '../index';

describe('encodeFrame / decode', () => {
  it('produces correct header: 4-byte BE length + 1-byte type', () => {
    const payload = Buffer.from('hello');
    const frame = encodeFrame(FrameType.Control, payload);

    expect(frame.length).toBe(5 + payload.length);
    expect(frame.readUInt32BE(0)).toBe(payload.length);
    expect(frame[4]).toBe(FrameType.Control);
    expect(frame.subarray(5).toString()).toBe('hello');
  });

  it('handles empty payload', () => {
    const frame = encodeFrame(FrameType.Control, Buffer.alloc(0));
    expect(frame.length).toBe(5);
    expect(frame.readUInt32BE(0)).toBe(0);
  });
});

describe('encodeControl / parseControlPayload round-trip', () => {
  it('round-trips a spawn message', () => {
    const msg = { type: 'spawn' as const, cmd: 'bash', args: ['-l'], cols: 80, rows: 24 };
    const frame = encodeControl(msg);
    const payload = frame.subarray(5);
    const decoded = parseControlPayload(payload);
    expect(decoded).toEqual(msg);
  });

  it('round-trips a sessions list', () => {
    const msg = { type: 'sessions' as const, list: [] };
    const frame = encodeControl(msg);
    const payload = frame.subarray(5);
    expect(parseControlPayload(payload)).toEqual(msg);
  });
});

describe('binary payload encode / parseBinaryPayload', () => {
  const sessionId = '12345678-1234-1234-1234-123456789012';

  it('encodePtyOutput round-trips', () => {
    const data = Buffer.from('terminal output');
    const frame = encodePtyOutput(sessionId, data);
    const payload = frame.subarray(5);
    const parsed = parseBinaryPayload(payload);
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.data.toString()).toBe('terminal output');
  });

  it('encodePtyInput round-trips', () => {
    const data = Buffer.from('keystrokes');
    const frame = encodePtyInput(sessionId, data);
    const payload = frame.subarray(5);
    const parsed = parseBinaryPayload(payload);
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.data.toString()).toBe('keystrokes');
  });

  it('encodeSnapshot round-trips', () => {
    const data = Buffer.from('serialized terminal state');
    const frame = encodeSnapshot(sessionId, data);
    const payload = frame.subarray(5);
    const parsed = parseBinaryPayload(payload);
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.data.toString()).toBe('serialized terminal state');
  });

  it('handles empty data', () => {
    const frame = encodePtyOutput(sessionId, Buffer.alloc(0));
    const payload = frame.subarray(5);
    const parsed = parseBinaryPayload(payload);
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.data.length).toBe(0);
  });
});

describe('FrameDecoder', () => {
  it('decodes a single complete frame', () => {
    const frames: Frame[] = [];
    const decoder = new FrameDecoder((f) => frames.push(f));

    const encoded = encodeControl({ type: 'list_sessions' });
    decoder.push(encoded);

    expect(frames.length).toBe(1);
    expect(frames[0].type).toBe(FrameType.Control);
    expect(parseControlPayload(frames[0].payload)).toEqual({ type: 'list_sessions' });
  });

  it('handles frame split across multiple chunks', () => {
    const frames: Frame[] = [];
    const decoder = new FrameDecoder((f) => frames.push(f));

    const encoded = encodeControl({ type: 'spawn', cmd: 'bash', cols: 80, rows: 24 });

    // Split at various points: mid-header, mid-payload
    decoder.push(encoded.subarray(0, 3)); // partial header
    expect(frames.length).toBe(0);

    decoder.push(encoded.subarray(3, 7)); // rest of header + partial payload
    expect(frames.length).toBe(0);

    decoder.push(encoded.subarray(7)); // rest of payload
    expect(frames.length).toBe(1);
    expect(parseControlPayload(frames[0].payload)).toMatchObject({ type: 'spawn', cmd: 'bash' });
  });

  it('decodes multiple frames in a single chunk', () => {
    const frames: Frame[] = [];
    const decoder = new FrameDecoder((f) => frames.push(f));

    const f1 = encodeControl({ type: 'list_sessions' });
    const f2 = encodeControl({ type: 'sessions', list: [] });
    const f3 = encodeControl({ type: 'error', message: 'test' });

    const combined = Buffer.concat([f1, f2, f3]);
    decoder.push(combined);

    expect(frames.length).toBe(3);
    expect(parseControlPayload(frames[0].payload)).toEqual({ type: 'list_sessions' });
    expect(parseControlPayload(frames[1].payload)).toEqual({ type: 'sessions', list: [] });
    expect(parseControlPayload(frames[2].payload)).toEqual({ type: 'error', message: 'test' });
  });

  it('handles byte-by-byte feeding', () => {
    const frames: Frame[] = [];
    const decoder = new FrameDecoder((f) => frames.push(f));

    const encoded = encodeControl({ type: 'list_sessions' });
    for (let i = 0; i < encoded.length; i++) {
      decoder.push(encoded.subarray(i, i + 1));
    }

    expect(frames.length).toBe(1);
  });

  it('decodes interleaved control and binary frames', () => {
    const frames: Frame[] = [];
    const decoder = new FrameDecoder((f) => frames.push(f));

    const sessionId = '12345678-1234-1234-1234-123456789012';
    const f1 = encodeControl({ type: 'list_sessions' });
    const f2 = encodePtyOutput(sessionId, Buffer.from('output'));
    const f3 = encodePtyInput(sessionId, Buffer.from('input'));

    decoder.push(Buffer.concat([f1, f2, f3]));

    expect(frames.length).toBe(3);
    expect(frames[0].type).toBe(FrameType.Control);
    expect(frames[1].type).toBe(FrameType.PtyOutput);
    expect(frames[2].type).toBe(FrameType.PtyInput);
  });
});
