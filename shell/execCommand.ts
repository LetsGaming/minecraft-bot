import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Executes a shell command via `bash -c`.
 * Returns trimmed stdout on success, or null on failure.
 */
export async function execCommand(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      timeout: 15000,
    });
    if (stderr) console.warn(`[stderr] ${stderr.trim()}`);
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[execCommand error]", message);
    return null;
  }
}

/**
 * Execute a command with explicit args (no shell interpolation — safe).
 */
export async function execSafe(
  cmd: string,
  args: string[] = [],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15000 });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[execSafe error]", message);
    return null;
  }
}

// ── Sudo error detection ──

const SUDO_ERROR_PATTERNS = [
  /sudo:.*password is required/i,
  /sudo:.*a terminal is required/i,
  /sudo:.*no tty present/i,
  /is not in the sudoers file/i,
  /not allowed to execute/i,
  /authentication failure/i,
  /\[SUDO ERROR\]/i, // custom marker from server scripts' systemctl_cmd wrapper
];

/**
 * Checks whether a stderr/error string indicates a sudo permission failure
 * (as opposed to the command itself failing for other reasons).
 */
export function isSudoPermissionError(output: string): boolean {
  return SUDO_ERROR_PATTERNS.some((p) => p.test(output));
}

/**
 * Build a user-facing error string when sudo is not configured.
 * `layer` distinguishes between the two sudo hops:
 *   - "user-switch" → bot user cannot `sudo -u <linuxUser>`
 *   - "systemctl"   → linuxUser cannot `sudo systemctl`
 */
export function sudoHelpMessage(
  layer: "user-switch" | "systemctl",
  linuxUser: string,
): string {
  if (layer === "user-switch") {
    return (
      "**Sudo is not configured correctly.**\n" +
      `The bot's OS user cannot switch to \`${linuxUser}\` via \`sudo -u\`.\n` +
      "A passwordless sudoers rule is required for this to work.\n\n" +
      "→ Run `/server` again after fixing the sudoers configuration.\n" +
      "→ See `docs/sudoers-setup.md` in the bot project for instructions."
    );
  }
  return (
    "**Sudo is not configured correctly.**\n" +
    `The \`${linuxUser}\` user cannot run \`systemctl\` via sudo.\n` +
    "A passwordless sudoers rule is required for the server scripts.\n\n" +
    "→ Run `/server` again after fixing the sudoers configuration.\n" +
    "→ See `docs/sudoers-setup.md` in the bot project for instructions."
  );
}
