import { Connection } from '../connection';
import { enterRawMode, cleanup, getTerminalSize, onResize } from '../tty';
import { DaemonMessage } from '@nepsis/shared';

export async function spawn(cmd: string, args: string[]): Promise<void> {
  const conn = new Connection();
  await conn.connect();

  const { cols, rows } = getTerminalSize();

  let sessionId: string | null = null;

  conn.setHandlers({
    onMessage: (msg: DaemonMessage) => {
      switch (msg.type) {
        case 'session_started':
          sessionId = msg.session.id;
          enterRawMode();

          // Pipe stdin → daemon
          process.stdin.on('data', (data: Buffer) => {
            conn.sendInput(sessionId!, data);
          });

          // Handle terminal resize
          onResize((c, r) => {
            if (sessionId) {
              conn.sendControl({ type: 'resize', sessionId, cols: c, rows: r });
            }
          });
          break;

        case 'session_ended':
          if (msg.sessionId === sessionId) {
            cleanup();
            conn.close();
            process.exit(msg.exitCode ?? 0);
          }
          break;

        case 'error':
          console.error('Error:', msg.message);
          cleanup();
          conn.close();
          process.exit(1);
          break;
      }
    },

    onOutput: (_sid: string, data: Buffer) => {
      process.stdout.write(data);
    },

    onClose: () => {
      cleanup();
      process.exit(0);
    },
  });

  conn.sendControl({
    type: 'spawn',
    cmd,
    args,
    cwd: process.cwd(),
    cols,
    rows,
  });
}
