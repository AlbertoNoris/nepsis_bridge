import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { RelayClient } from './relay-client';

// Relay protocol types (duplicated from relay — intentionally decoupled)
interface BridgeWelcomeMessage {
  type: 'bridge_welcome';
  pairingCode: string;
  reconnectToken: string;
}

interface ClientJoinedMessage {
  type: 'client_joined';
  clientId: string;
  clientIndex: number;
  deviceName: string;
}

interface ClientLeftMessage {
  type: 'client_left';
  clientId: string;
}

interface RelayErrorMessage {
  type: 'error';
  message: string;
}

type RelayToBridgeMessage =
  | BridgeWelcomeMessage
  | ClientJoinedMessage
  | ClientLeftMessage
  | RelayErrorMessage;

export interface RelayConnectionOptions {
  relayUrl: string;
  bridgeId: string;
  onClient: (client: RelayClient) => void;
  onClientDisconnect: (client: RelayClient) => void;
}

/**
 * Manages the outbound WebSocket connection from the daemon to the relay.
 * Creates/destroys RelayClient instances as mobile devices join/leave.
 *
 * Events:
 *   'pairing_code' (code: string) — emitted when relay assigns a pairing code
 *   'connected' — connected and authenticated to relay
 *   'disconnected' — lost connection to relay
 */
export class RelayConnection extends EventEmitter {
  private opts: RelayConnectionOptions;
  private ws: WebSocket | null = null;
  private clients = new Map<number, RelayClient>(); // clientIndex → RelayClient
  private clientsById = new Map<string, RelayClient>(); // clientId → RelayClient
  private reconnectToken: string | null = null;
  private pairingCode: string | null = null;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: RelayConnectionOptions) {
    super();
    this.opts = opts;
  }

  get code(): string | null {
    return this.pairingCode;
  }

  connect(): void {
    this.stopped = false;
    this.doConnect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Daemon shutting down');
      this.ws = null;
    }
  }

  private doConnect(): void {
    if (this.stopped) return;

    const ws = new WebSocket(this.opts.relayUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1000; // Reset backoff on success

      if (this.reconnectToken) {
        ws.send(JSON.stringify({
          type: 'bridge_auth_reconnect',
          reconnectToken: this.reconnectToken,
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'bridge_auth',
          bridgeId: this.opts.bridgeId,
        }));
      }
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        this.handleBinary(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
      } else {
        this.handleText(JSON.parse(raw.toString()));
      }
    });

    ws.on('close', () => {
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[relay] connection error:', err.message);
      // 'close' event will fire after this
    });
  }

  private handleText(msg: RelayToBridgeMessage): void {
    switch (msg.type) {
      case 'bridge_welcome':
        this.reconnectToken = msg.reconnectToken;
        this.pairingCode = msg.pairingCode;
        this.emit('connected');
        this.emit('pairing_code', msg.pairingCode);
        break;

      case 'client_joined':
        this.handleClientJoined(msg);
        break;

      case 'client_left':
        this.handleClientLeft(msg);
        break;

      case 'error':
        console.error('[relay] error from server:', msg.message);
        break;
    }
  }

  private handleClientJoined(msg: ClientJoinedMessage): void {
    // Check if this is a reconnect (client already known)
    let client = this.clientsById.get(msg.clientId);
    if (client) {
      // Client reconnected — already wired into daemon
      return;
    }

    // New mobile client
    client = new RelayClient(
      msg.clientId,
      msg.deviceName,
      msg.clientIndex,
      (frame: Buffer) => this.sendFrameToRelay(msg.clientIndex, frame),
    );

    this.clients.set(msg.clientIndex, client);
    this.clientsById.set(msg.clientId, client);

    // Register with daemon
    this.opts.onClient(client);
  }

  private handleClientLeft(msg: ClientLeftMessage): void {
    const client = this.clientsById.get(msg.clientId);
    if (!client) return;

    this.clients.delete(client.clientIndex);
    this.clientsById.delete(msg.clientId);

    // Notify daemon — triggers handleClientDisconnect
    client.close();
    this.opts.onClientDisconnect(client);
  }

  private handleBinary(data: Buffer): void {
    if (data.length < 1) return;

    const clientIndex = data[0];
    const frame = data.subarray(1);

    const client = this.clients.get(clientIndex);
    if (client) {
      client.handleFrame(frame);
    }
  }

  private sendFrameToRelay(clientIndex: number, frame: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Prepend clientIndex byte
    const tagged = Buffer.allocUnsafe(1 + frame.length);
    tagged[0] = clientIndex;
    frame.copy(tagged, 1);

    this.ws.send(tagged);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`[relay] reconnecting to ${this.opts.relayUrl}...`);
      this.doConnect();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }
}
