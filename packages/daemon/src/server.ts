import * as net from 'net';
import * as fs from 'fs';
import { v4 as uuid } from 'uuid';
import { SOCKET_PATH } from '@nepsis/shared';
import { SocketClient } from './client';

export class SocketServer {
  private server: net.Server;
  private onClient: (client: SocketClient) => void;
  private socketPath: string;

  constructor(onClient: (client: SocketClient) => void, socketPath?: string) {
    this.onClient = onClient;
    this.socketPath = socketPath || SOCKET_PATH;
    this.server = net.createServer((socket) => {
      const clientId = uuid();
      const client = new SocketClient(clientId, socket);
      this.onClient(client);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove stale socket file
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }

      this.server.on('error', reject);
      this.server.listen(this.socketPath, () => {
        console.log(`[daemon] listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
        resolve();
      });
    });
  }
}
