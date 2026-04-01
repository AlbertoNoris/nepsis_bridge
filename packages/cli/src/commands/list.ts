import { Connection } from '../connection';
import { DaemonMessage, SessionInfo } from '@nepsis/shared';

export async function list(): Promise<void> {
  const conn = new Connection();
  await conn.connect();

  conn.setHandlers({
    onMessage: (msg: DaemonMessage) => {
      if (msg.type === 'sessions') {
        if (msg.list.length === 0) {
          console.log('No active sessions.');
        } else {
          console.log('Active sessions:\n');
          for (const s of msg.list) {
            const age = formatAge(Date.now() - s.createdAt);
            const cmd = [s.cmd, ...s.args].join(' ');
            const active = s.activeClientId ? ' (active)' : '';
            console.log(`  ${s.id.substring(0, 8)}  ${cmd}  ${s.cwd}  ${age}${active}`);
          }
          console.log('');
        }
        conn.close();
        process.exit(0);
      }
    },
    onClose: () => {
      process.exit(0);
    },
  });

  conn.sendControl({ type: 'list_sessions' });
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}
