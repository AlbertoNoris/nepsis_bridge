import * as net from 'net';
import {
  SOCKET_PATH,
  Frame,
  FrameType,
  FrameDecoder,
  ControlMessage,
  DaemonMessage,
  encodeControl,
  encodePtyInput,
  parseControlPayload,
  parseBinaryPayload,
  BinaryFrame,
} from '@nepsis/shared';

export type MessageHandler = (msg: DaemonMessage) => void;
export type OutputHandler = (sessionId: string, data: Buffer) => void;
export type SnapshotHandler = (sessionId: string, data: Buffer) => void;

export class Connection {
  private socket: net.Socket;
  private decoder: FrameDecoder;
  private onMessage: MessageHandler = () => {};
  private onOutput: OutputHandler = () => {};
  private onSnapshot: SnapshotHandler = () => {};
  private onClose: () => void = () => {};

  constructor() {
    this.socket = new net.Socket();
    this.decoder = new FrameDecoder((frame: Frame) => {
      this.handleFrame(frame);
    });

    this.socket.on('data', (chunk: Buffer) => {
      this.decoder.push(chunk);
    });

    this.socket.on('close', () => {
      this.onClose();
    });

    this.socket.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
          (err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('Cannot connect to daemon. Is it running? Start it with: nepsis daemon');
      } else {
        console.error('Connection error:', err.message);
      }
      process.exit(1);
    });
  }

  connect(socketPath?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.connect(socketPath || SOCKET_PATH, () => {
        this.socket.removeListener('error', reject);
        resolve();
      });
    });
  }

  setHandlers(handlers: {
    onMessage?: MessageHandler;
    onOutput?: OutputHandler;
    onSnapshot?: SnapshotHandler;
    onClose?: () => void;
  }): void {
    if (handlers.onMessage) this.onMessage = handlers.onMessage;
    if (handlers.onOutput) this.onOutput = handlers.onOutput;
    if (handlers.onSnapshot) this.onSnapshot = handlers.onSnapshot;
    if (handlers.onClose) this.onClose = handlers.onClose;
  }

  sendControl(msg: ControlMessage): void {
    this.socket.write(encodeControl(msg));
  }

  sendInput(sessionId: string, data: Buffer): void {
    this.socket.write(encodePtyInput(sessionId, data));
  }

  close(): void {
    this.socket.destroy();
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Control: {
        const msg = parseControlPayload(frame.payload) as DaemonMessage;
        this.onMessage(msg);
        break;
      }
      case FrameType.PtyOutput: {
        const { sessionId, data } = parseBinaryPayload(frame.payload);
        this.onOutput(sessionId, data);
        break;
      }
      case FrameType.Snapshot: {
        const { sessionId, data } = parseBinaryPayload(frame.payload);
        this.onSnapshot(sessionId, data);
        break;
      }
    }
  }
}
