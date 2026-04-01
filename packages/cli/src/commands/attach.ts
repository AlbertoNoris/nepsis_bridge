import { Connection } from '../connection';
import { enterRawMode, cleanup, getTerminalSize, onResize } from '../tty';
import { DaemonMessage } from '@nepsis/shared';

export async function attach(sessionId: string): Promise<void> {
  const conn = new Connection();
  await conn.connect();

  const { cols, rows } = getTerminalSize();

  conn.setHandlers({
    onMessage: (msg: DaemonMessage) => {
      switch (msg.type) {
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

    onSnapshot: (_sid: string, data: Buffer) => {
      // Write the serialized terminal state — restores screen
      process.stdout.write(data);

      // Now enter interactive mode
      enterRawMode();

      process.stdin.on('data', (data: Buffer) => {
        conn.sendInput(sessionId, data);
      });

      onResize((c, r) => {
        conn.sendControl({ type: 'resize', sessionId, cols: c, rows: r });
      });
    },

    onClose: () => {
      cleanup();
      process.exit(0);
    },
  });

  // Send attach + focus
  conn.sendControl({ type: 'attach', sessionId });
  conn.sendControl({ type: 'focus', sessionId, cols, rows });
}
