import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Executes a shell command via `bash -c`.
 * Returns trimmed stdout on success, or null on failure.
 */
export async function execCommand(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
      timeout: 15000,
    });
    if (stderr) console.warn(`[stderr] ${stderr.trim()}`);
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[execCommand error]', message);
    return null;
  }
}

/**
 * Execute a command with explicit args (no shell interpolation — safe).
 */
export async function execSafe(cmd: string, args: string[] = []): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15000 });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[execSafe error]', message);
    return null;
  }
}
