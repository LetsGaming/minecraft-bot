import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Executes a shell command safely using execFile.
 * For complex commands with pipes/redirects, wraps in bash -c.
 */
export async function execCommand(command) {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      timeout: 15000,
    });
    if (stderr) console.warn(`[stderr] ${stderr.trim()}`);
    return stdout.trim();
  } catch (error) {
    console.error(`[execCommand error]`, error.message);
    return null;
  }
}

/**
 * Execute a command with explicit args (no shell interpolation — safe).
 */
export async function execSafe(cmd, args = []) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15000 });
    return stdout.trim();
  } catch (error) {
    console.error(`[execSafe error]`, error.message);
    return null;
  }
}
