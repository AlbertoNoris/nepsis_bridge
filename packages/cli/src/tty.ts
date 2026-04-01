/**
 * Raw TTY mode handling for terminal passthrough.
 */

let wasRaw = false;

export function enterRawMode(): void {
  if (process.stdin.isTTY) {
    wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
}

export function exitRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  }
}

export function getTerminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

export function onResize(callback: (cols: number, rows: number) => void): void {
  process.stdout.on('resize', () => {
    const { cols, rows } = getTerminalSize();
    callback(cols, rows);
  });
}

export function cleanup(): void {
  exitRawMode();
  // Ensure cursor is visible and terminal is in normal mode
  process.stdout.write('\x1b[?25h'); // show cursor
}
