#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { spawn } from './commands/spawn';
import { attach } from './commands/attach';
import { list } from './commands/list';
import { kill } from './commands/kill';
import { startDaemon } from './commands/daemon';

const BUILTIN_COMMANDS = ['daemon', 'ls', 'attach', 'kill', 'help'] as const;

function getDefaultShell(): string {
  // Prefer SHELL env var
  if (process.env.SHELL) return process.env.SHELL;
  // On macOS, query the directory service for the user's configured shell
  if (process.platform === 'darwin') {
    try {
      const result = execFileSync('dscl', ['.', '-read', `/Users/${process.env.USER}`, 'UserShell'], { encoding: 'utf-8' });
      const match = result.match(/UserShell:\s*(\S+)/);
      if (match) return match[1];
    } catch {}
  }
  return '/bin/zsh';
}

const args = process.argv.slice(2);

if (args.length === 0) {
  // No args: spawn user's default shell
  const shell = getDefaultShell();
  spawn(shell, []).catch(fatal);
} else {
  const cmd = args[0];

  switch (cmd) {
    case 'daemon':
      startDaemon();
      break;

    case 'ls':
      list().catch(fatal);
      break;

    case 'attach': {
      const sessionId = args[1];
      if (!sessionId) {
        console.error('Usage: nepsis attach <session-id>');
        process.exit(1);
      }
      attach(resolveSessionId(sessionId)).catch(fatal);
      break;
    }

    case 'kill': {
      const sessionId = args[1];
      if (!sessionId) {
        console.error('Usage: nepsis kill <session-id>');
        process.exit(1);
      }
      kill(resolveSessionId(sessionId)).catch(fatal);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      if (!commandExists(cmd)) {
        console.error(`Unknown command: "${cmd}"\n`);
        printHelp();
        process.exit(1);
      }
      spawn(cmd, args.slice(1)).catch(fatal);
      break;
  }
}

function fatal(err: Error): void {
  console.error(err.message);
  process.exit(1);
}

function printHelp(): void {
  console.log(`Usage: nepsis [command]

Commands:
  nepsis                   Spawn a new session with your default shell
  nepsis <program> [args]  Spawn a new session running <program>
  nepsis ls                List active sessions
  nepsis attach <id>       Attach to a session
  nepsis kill <id>         Kill a session
  nepsis daemon start      Start the daemon

Options:
  nepsis help              Show this help message`);
}

function commandExists(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Allow users to pass short session ID prefixes (e.g., first 8 chars).
 * For now, just pass through — the daemon will need full IDs.
 * Future: query daemon for prefix match.
 */
function resolveSessionId(id: string): string {
  return id;
}
