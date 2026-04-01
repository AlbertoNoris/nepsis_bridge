import { Connection } from '../connection';
import { DaemonMessage } from '@nepsis/shared';

export async function kill(sessionId: string): Promise<void> {
  const conn = new Connection();
  await conn.connect();

  conn.setHandlers({
    onMessage: (msg: DaemonMessage) => {
      if (msg.type === 'session_ended' && msg.sessionId === sessionId) {
        console.log(`Session ${sessionId.substring(0, 8)} terminated.`);
        conn.close();
        process.exit(0);
      } else if (msg.type === 'error') {
        console.error('Error:', msg.message);
        conn.close();
        process.exit(1);
      }
    },
    onClose: () => {
      process.exit(0);
    },
  });

  conn.sendControl({ type: 'kill', sessionId });
}
