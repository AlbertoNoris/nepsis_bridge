import { v4 as uuid } from 'uuid';
import {
  ClientMessage,
  ControlMessage,
} from '@nepsis/shared';
import { Session, SessionOptions } from './session';
import { Registry } from './registry';
import { Client } from './client';
import { SocketServer } from './server';
import { RelayConnection } from './relay-connection';
import { RelayClient } from './relay-client';

export interface DaemonOptions {
  socketPath?: string;
  relayUrl?: string;
  bridgeId?: string;
}

export class Daemon {
  private registry = new Registry();
  private server: SocketServer;
  /** All connected clients (for broadcasting session list updates) */
  private clients = new Set<Client>();
  /** Which sessions each client is attached to */
  private clientSessions = new Map<Client, Set<string>>();
  /** Relay connection (if configured) */
  private relay: RelayConnection | null = null;
  private relayUrl?: string;
  private bridgeId?: string;

  constructor(opts: DaemonOptions = {}) {
    this.server = new SocketServer((client) => this.handleNewClient(client), opts.socketPath);
    this.relayUrl = opts.relayUrl;
    this.bridgeId = opts.bridgeId;
  }

  get pairingCode(): string | null {
    return this.relay?.code ?? null;
  }

  async start(): Promise<void> {
    await this.server.start();

    if (this.relayUrl) {
      const bridgeId = this.bridgeId || uuid();
      this.relay = new RelayConnection({
        relayUrl: this.relayUrl,
        bridgeId,
        onClient: (client) => this.handleNewClient(client),
        onClientDisconnect: (client) => this.handleClientDisconnect(client),
      });

      this.relay.on('pairing_code', (code: string) => {
        console.log(`[daemon] pairing code: ${code}`);
      });

      this.relay.connect();
    }

    console.log('[daemon] started');
  }

  async stop(): Promise<void> {
    // Stop relay
    if (this.relay) {
      this.relay.stop();
      this.relay = null;
    }
    // Kill all sessions
    for (const session of this.registry.all()) {
      session.dispose();
    }
    await this.server.stop();
    console.log('[daemon] stopped');
  }

  private handleNewClient(client: Client): void {
    this.clients.add(client);
    this.clientSessions.set(client, new Set());

    client.on('message', (msg: ClientMessage) => {
      this.handleControlMessage(client, msg);
    });

    client.on('input', (sessionId: string, data: Buffer) => {
      this.handlePtyInput(client, sessionId, data);
    });

    client.on('close', () => {
      this.handleClientDisconnect(client);
    });
  }

  private handleControlMessage(client: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case 'spawn':
        this.handleSpawn(client, msg);
        break;
      case 'attach':
        this.handleAttach(client, msg.sessionId);
        break;
      case 'detach':
        this.handleDetach(client, msg.sessionId);
        break;
      case 'focus':
        this.handleFocus(client, msg.sessionId, msg.cols, msg.rows);
        break;
      case 'resize':
        this.handleResize(client, msg.sessionId, msg.cols, msg.rows);
        break;
      case 'list_sessions':
        this.handleListSessions(client);
        break;
      case 'kill':
        this.handleKill(client, msg.sessionId);
        break;
    }
  }

  private handleSpawn(
    client: Client,
    msg: { cmd: string; args?: string[]; cwd?: string; cols: number; rows: number }
  ): void {
    const opts: SessionOptions = {
      id: uuid(),
      cmd: msg.cmd,
      args: msg.args || [],
      cwd: msg.cwd || process.cwd(),
      cols: msg.cols,
      rows: msg.rows,
    };

    let session: Session;
    try {
      session = new Session(opts);
    } catch (err: any) {
      client.sendControl({ type: 'error', message: `Failed to spawn: ${err.message}` });
      return;
    }
    this.registry.add(session);

    // Set this client as active
    session.activeClientId = client.id;

    // Attach the client to this session
    this.attachClientToSession(client, session);

    // Notify spawning client
    client.sendControl({ type: 'session_started', session: session.toInfo() });

    // Broadcast to other clients
    this.broadcastExcept(client, {
      type: 'session_started',
      session: session.toInfo(),
    });

    // Wire up session events
    session.on('data', (data: Buffer) => {
      this.broadcastPtyOutput(session.id, data);
    });

    session.on('exit', (exitCode: number | null) => {
      this.handleSessionExit(session, exitCode);
    });
  }

  private handleAttach(client: Client, sessionId: string): void {
    const session = this.registry.get(sessionId);
    if (!session) {
      client.sendControl({ type: 'error', message: `Session ${sessionId} not found` });
      return;
    }

    this.attachClientToSession(client, session);

    // Send snapshot for instant screen restoration
    const snapshot = session.getSnapshot();
    client.sendSnapshot(sessionId, snapshot);
  }

  private handleDetach(client: Client, sessionId: string): void {
    const attached = this.clientSessions.get(client);
    if (attached) {
      attached.delete(sessionId);
    }
  }

  private handleFocus(client: Client, sessionId: string, cols: number, rows: number): void {
    const session = this.registry.get(sessionId);
    if (!session) return;

    session.activeClientId = client.id;
    session.resize(cols, rows);

    this.broadcastToSession(sessionId, {
      type: 'active_changed',
      sessionId,
      clientId: client.id,
      cols,
      rows,
    });
  }

  private handleResize(client: Client, sessionId: string, cols: number, rows: number): void {
    const session = this.registry.get(sessionId);
    if (!session) return;

    // Only active client can resize
    if (session.activeClientId === client.id) {
      session.resize(cols, rows);
    }
  }

  private handleListSessions(client: Client): void {
    client.sendControl({ type: 'sessions', list: this.registry.list() });
  }

  private handleKill(client: Client, sessionId: string): void {
    const session = this.registry.get(sessionId);
    if (!session) {
      client.sendControl({ type: 'error', message: `Session ${sessionId} not found` });
      return;
    }
    session.kill();
  }

  private handlePtyInput(client: Client, sessionId: string, data: Buffer): void {
    const session = this.registry.get(sessionId);
    if (!session) return;

    // Input makes this client the active one
    session.activeClientId = client.id;
    session.write(data);
  }

  private handleSessionExit(session: Session, exitCode: number | null): void {
    const msg: ControlMessage = {
      type: 'session_ended',
      sessionId: session.id,
      exitCode,
    };

    // Notify all connected clients
    this.broadcastToAll(msg);

    // Clean up attachments
    for (const [, attached] of this.clientSessions) {
      attached.delete(session.id);
    }

    this.registry.remove(session.id);
  }

  private handleClientDisconnect(client: Client): void {
    this.clients.delete(client);
    this.clientSessions.delete(client);
    client.removeAllListeners();
  }

  private attachClientToSession(client: Client, session: Session): void {
    let attached = this.clientSessions.get(client);
    if (!attached) {
      attached = new Set();
      this.clientSessions.set(client, attached);
    }
    attached.add(session.id);
  }

  private broadcastPtyOutput(sessionId: string, data: Buffer): void {
    for (const [client, attached] of this.clientSessions) {
      if (attached.has(sessionId)) {
        client.sendPtyOutput(sessionId, data);
      }
    }
  }

  private broadcastToSession(sessionId: string, msg: ControlMessage): void {
    for (const [client, attached] of this.clientSessions) {
      if (attached.has(sessionId)) {
        client.sendControl(msg);
      }
    }
  }

  private broadcastToAll(msg: ControlMessage): void {
    for (const client of this.clients) {
      client.sendControl(msg);
    }
  }

  private broadcastExcept(exclude: Client, msg: ControlMessage): void {
    for (const client of this.clients) {
      if (client !== exclude) {
        client.sendControl(msg);
      }
    }
  }
}
