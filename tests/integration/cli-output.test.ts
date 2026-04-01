import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';

const CLI_PATH = path.resolve(__dirname, '../../packages/cli/dist/index.js');

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('CLI help and error output', () => {
  it('nepsis help prints usage', () => {
    const { stdout, exitCode } = runCli(['help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nepsis');
    expect(stdout).toContain('nepsis ls');
    expect(stdout).toContain('nepsis attach');
    expect(stdout).toContain('nepsis kill');
    expect(stdout).toContain('nepsis daemon');
  });

  it('nepsis --help prints usage', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nepsis');
  });

  it('nepsis -h prints usage', () => {
    const { stdout, exitCode } = runCli(['-h']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nepsis');
  });

  it('nepsis <unknown> shows error and help', () => {
    const { stdout, stderr, exitCode } = runCli(['foobar_nonexistent_cmd']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown command: "foobar_nonexistent_cmd"');
    expect(stdout).toContain('Usage: nepsis');
  });
});
