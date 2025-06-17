import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Executes a shell command and returns when it's done.
 *
 * @param {string} command - The shell command to run.
 * @returns {Promise<void>} Resolves on success, rejects on error with stderr.
 */
export async function execCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command);

    if (stdout) console.log(`[stdout] ${stdout.trim()}`);
    if (stderr) console.warn(`[stderr] ${stderr.trim()}`);

    return stdout.trim();
  } catch (error) {
    console.error(`[execCommand error]`, error);
    return null;
  }
}
