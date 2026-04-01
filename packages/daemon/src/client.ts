import * as net from 'net';
import { EventEmitter } from 'events';
import {
  Frame,
  FrameDecoder,
  FrameType,
  ControlMessage,
  encodeFrame,
  encodeControl,
  encodePtyOutput,
  encodeSnapshot,
  parseControlPayload,
  parseBinaryPayload,
} from '@nepsis/shared';

/**
 * Abstract client interface — the daemon works with this.
 * SocketClient (Unix socket) and future WebSocketClient both implement it.
 */
export abstract class Client extends EventEmitter {
  abstract readonly id: string;
  abstract readonly deviceName: string;
  abstract send(frame: Buffer): void;
  abstract close(): void;

  sendControl(msg: ControlMessage): void {
    this.send(encodeControl(msg));
  }

  sendPtyOutput(sessionId: string, data: Buffer): void {
    this.send(encodePtyOutput(sessionId, data));
  }

  sendSnapshot(sessionId: string, data: Buffer): void {
    this.send(encodeSnapshot(sessionId, data));
  }
}

/**
 * Client connected via Unix socket.
 */
export class SocketClient extends Client {
  readonly id: string;
  readonly deviceName: string;
  private socket: net.Socket;
  private decoder: FrameDecoder;

  constructor(id: string, socket: net.Socket) {
    super();
    this.id = id;
    this.deviceName = 'local';
    this.socket = socket;

    this.decoder = new FrameDecoder((frame: Frame) => {
      this.handleFrame(frame);
    });

    socket.on('data', (chunk: Buffer) => {
      this.decoder.push(chunk);
    });

    socket.on('close', () => {
      this.emit('close');
    });

    socket.on('error', (err) => {
      console.error(`[client ${this.id}] socket error:`, err.message);
      this.emit('close');
    });
  }

  private handleFrame(frame: Frame): void {
    if (frame.type === FrameType.Control) {
      const msg = parseControlPayload(frame.payload);
      this.emit('message', msg);
    } else if (frame.type === FrameType.PtyInput) {
      const { sessionId, data } = parseBinaryPayload(frame.payload);
      this.emit('input', sessionId, data);
    }
  }

  send(frame: Buffer): void {
    if (!this.socket.destroyed) {
      this.socket.write(frame);
    }
  }

  close(): void {
    this.socket.destroy();
  }
}
