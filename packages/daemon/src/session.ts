import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { SessionInfo } from '@nepsis/shared';
import * as path from 'path';

const KNOWN_SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'tcsh', 'csh', 'dash', 'ksh']);

function isShell(cmd: string): boolean {
  return KNOWN_SHELLS.has(path.basename(cmd));
}

export interface SessionOptions {
  id: string;
  cmd: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
}

export class Session extends EventEmitter {
  readonly id: string;
  readonly cmd: string;
  readonly args: string[];
  readonly cwd: string;
  readonly createdAt: number;

  private ptyProcess: pty.IPty;
  private term: Terminal;
  private serializer: SerializeAddon;
  private _cols: number;
  private _rows: number;
  private _exitCode: number | null = null;
  private _exited = false;
  activeClientId: string | null = null;

  constructor(opts: SessionOptions) {
    super();
    this.id = opts.id;
    this.cmd = opts.cmd;
    this.args = opts.args;
    this.cwd = opts.cwd;
    this.createdAt = Date.now();
    this._cols = opts.cols;
    this._rows = opts.rows;

    // Create headless terminal for virtual state tracking
    this.term = new Terminal({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: 1000,
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.term.loadAddon(this.serializer);

    // Build clean env (node-pty requires all values to be strings)
    const env: { [key: string]: string } = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }

    // Spawn as login shell so profile/rc files (aliases, PATH) are loaded
    const spawnArgs = isShell(opts.cmd) && opts.args.length === 0
      ? ['-l']
      : opts.args;

    // Spawn PTY
    this.ptyProcess = pty.spawn(opts.cmd, spawnArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env,
    });

    // Pipe PTY output → xterm/headless + emit for clients
    this.ptyProcess.onData((data: string) => {
      const buf = Buffer.from(data, 'utf-8');
      // Feed xterm/headless (fire-and-forget — it buffers internally)
      this.term.write(data);
      // Emit raw bytes for live-streaming to clients
      this.emit('data', buf);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this._exitCode = exitCode;
      this._exited = true;
      this.emit('exit', exitCode);
    });
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  write(data: string | Buffer): void {
    if (this._exited) return;
    const str = typeof data === 'string' ? data : data.toString('utf-8');
    this.ptyProcess.write(str);
  }

  resize(cols: number, rows: number): void {
    if (this._exited) return;
    this._cols = cols;
    this._rows = rows;
    this.ptyProcess.resize(cols, rows);
    this.term.resize(cols, rows);
  }

  getSnapshot(): Buffer {
    const serialized = this.serializer.serialize();
    return Buffer.from(serialized, 'utf-8');
  }

  kill(): void {
    if (this._exited) return;
    this.ptyProcess.kill();
  }

  toInfo(): SessionInfo {
    return {
      id: this.id,
      cmd: this.cmd,
      args: this.args,
      cwd: this.cwd,
      createdAt: this.createdAt,
      activeClientId: this.activeClientId,
      cols: this._cols,
      rows: this._rows,
    };
  }

  dispose(): void {
    this.kill();
    this.term.dispose();
    this.removeAllListeners();
  }
}
