// --- Frame types (the 1-byte discriminator after the length prefix) ---

export enum FrameType {
  Control = 0x00,   // JSON control message
  PtyOutput = 0x01, // daemon → client: raw PTY bytes
  PtyInput = 0x02,  // client → daemon: raw keystrokes
  Snapshot = 0x03,  // daemon → client: serialized terminal state
}

// --- Session metadata ---

export interface SessionInfo {
  id: string;
  cmd: string;
  args: string[];
  cwd: string;
  createdAt: number; // epoch ms
  activeClientId: string | null;
  cols: number;
  rows: number;
}

// --- Control messages: Client → Daemon ---

export interface SpawnMessage {
  type: 'spawn';
  cmd: string;
  args?: string[];
  cwd?: string;
  cols: number;
  rows: number;
}

export interface AttachMessage {
  type: 'attach';
  sessionId: string;
}

export interface DetachMessage {
  type: 'detach';
  sessionId: string;
}

export interface FocusMessage {
  type: 'focus';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface ResizeMessage {
  type: 'resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface ListSessionsMessage {
  type: 'list_sessions';
}

export interface KillMessage {
  type: 'kill';
  sessionId: string;
}

export type ClientMessage =
  | SpawnMessage
  | AttachMessage
  | DetachMessage
  | FocusMessage
  | ResizeMessage
  | ListSessionsMessage
  | KillMessage;

// --- Control messages: Daemon → Client ---

export interface SessionStartedMessage {
  type: 'session_started';
  session: SessionInfo;
}

export interface SessionEndedMessage {
  type: 'session_ended';
  sessionId: string;
  exitCode: number | null;
}

export interface SessionsListMessage {
  type: 'sessions';
  list: SessionInfo[];
}

export interface ActiveChangedMessage {
  type: 'active_changed';
  sessionId: string;
  clientId: string;
  cols: number;
  rows: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type DaemonMessage =
  | SessionStartedMessage
  | SessionEndedMessage
  | SessionsListMessage
  | ActiveChangedMessage
  | ErrorMessage;

export type ControlMessage = ClientMessage | DaemonMessage;

// --- Socket path ---

export const SOCKET_PATH = '/tmp/nepsis-daemon.sock';
