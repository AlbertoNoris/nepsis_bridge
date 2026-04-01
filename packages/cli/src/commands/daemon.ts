import { spawn } from 'child_process';
import * as path from 'path';

export function startDaemon(): void {
  // Just run the daemon entry point directly in the foreground
  const daemonEntry = path.resolve(__dirname, '../../../daemon/dist/index.js');

  const child = spawn('node', [daemonEntry], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
