/**
 * execCommand.ts tests
 *
 * Three exports, three test groups:
 *  - isSudoPermissionError: pure pattern matching — test every regex variant
 *  - sudoHelpMessage: pure string builder — test both layers
 *  - execSafe: uses real child_process with stable OS commands (echo/false)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  isSudoPermissionError,
  sudoHelpMessage,
  execSafe,
} from "../../src/core/shell/execCommand.js";

// ── isSudoPermissionError ─────────────────────────────────────────────────
//
// Tests every pattern in SUDO_ERROR_PATTERNS.  If a new pattern is added to
// the source, add a corresponding test here — the goal is that a broken
// pattern is caught immediately, not silently swallowed.

describe("isSudoPermissionError", () => {
  // Positive cases — each line should match exactly one pattern
  it("matches 'sudo: password is required'", () => {
    expect(isSudoPermissionError("sudo: password is required")).toBe(true);
  });

  it("matches 'sudo: a terminal is required'", () => {
    expect(
      isSudoPermissionError(
        "sudo: a terminal is required to read the password",
      ),
    ).toBe(true);
  });

  it("matches 'sudo: no tty present'", () => {
    expect(
      isSudoPermissionError(
        "sudo: no tty present and no askpass program specified",
      ),
    ).toBe(true);
  });

  it("matches 'is not in the sudoers file'", () => {
    expect(
      isSudoPermissionError(
        "minecraft is not in the sudoers file. This incident will be reported.",
      ),
    ).toBe(true);
  });

  it("matches 'not allowed to execute'", () => {
    expect(
      isSudoPermissionError(
        "Sorry, user minecraft is not allowed to execute '/usr/bin/screen' as root on server.",
      ),
    ).toBe(true);
  });

  it("matches 'authentication failure'", () => {
    expect(
      isSudoPermissionError(
        "sudo: 1 incorrect password attempt — authentication failure",
      ),
    ).toBe(true);
  });

  it("matches custom [SUDO ERROR] marker", () => {
    expect(isSudoPermissionError("[SUDO ERROR] permission denied")).toBe(true);
  });

  // Pattern matching is case-insensitive
  it("is case-insensitive", () => {
    expect(isSudoPermissionError("SUDO: PASSWORD IS REQUIRED")).toBe(true);
  });

  // Negative cases — regular command failures should not be flagged
  it("returns false for a plain 'command not found' error", () => {
    expect(isSudoPermissionError("bash: screen: command not found")).toBe(
      false,
    );
  });

  it("returns false for a non-zero exit code message", () => {
    expect(isSudoPermissionError("Process exited with code 1")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isSudoPermissionError("")).toBe(false);
  });

  it("returns false for unrelated output that contains 'sudo' as a word", () => {
    // The word 'sudo' alone should not trigger the check
    expect(isSudoPermissionError("Run sudo to elevate privileges")).toBe(false);
  });
});

// ── sudoHelpMessage ───────────────────────────────────────────────────────
//
// Pure string builder — verify the key phrases that users will see.
// We don't assert exact word-for-word output so minor wording tweaks
// in the source don't break the tests.

describe("sudoHelpMessage", () => {
  describe("user-switch layer", () => {
    const msg = sudoHelpMessage("user-switch", "minecraftbot");

    it("mentions the linuxUser name", () => {
      expect(msg).toContain("minecraftbot");
    });

    it("refers to sudo -u (user switch mechanism)", () => {
      expect(msg).toContain("sudo -u");
    });

    it("points to sudoers-setup docs", () => {
      expect(msg).toContain("sudoers-setup");
    });
  });

  describe("systemctl layer", () => {
    const msg = sudoHelpMessage("systemctl", "mc");

    it("mentions the linuxUser name", () => {
      expect(msg).toContain("mc");
    });

    it("mentions systemctl", () => {
      expect(msg).toContain("systemctl");
    });

    it("points to sudoers-setup docs", () => {
      expect(msg).toContain("sudoers-setup");
    });

    it("returns different content from the user-switch variant", () => {
      const switchMsg = sudoHelpMessage("user-switch", "mc");
      expect(msg).not.toBe(switchMsg);
    });
  });
});

// ── execSafe ──────────────────────────────────────────────────────────────
//
// Tests against real OS commands.  The Unix variants (echo, printf, false)
// require a Unix-like shell environment; they are skipped on Windows where
// these are CMD built-ins rather than executable files and cannot be
// launched via execFile.  The bot itself targets Linux, so the real-command
// integration tests are only meaningful there.

const isWindows = process.platform === "win32";

describe("execSafe", () => {
  it.skipIf(isWindows)("returns trimmed stdout on success", async () => {
    const result = await execSafe("echo", ["hello world"]);
    expect(result).toBe("hello world");
  });

  it("returns null when the command does not exist", async () => {
    const result = await execSafe("__this_command_does_not_exist__");
    expect(result).toBeNull();
  });

  it.skipIf(isWindows)(
    "returns null when the command exits non-zero",
    async () => {
      // `false` is a standard Unix command that always exits with code 1
      const result = await execSafe("false");
      expect(result).toBeNull();
    },
  );

  it.skipIf(isWindows)("trims trailing newlines from stdout", async () => {
    const result = await execSafe("printf", ["%s\n\n", "trimme"]);
    // printf "%s\n\n" outputs "trimme\n\n" — execSafe should strip the whitespace
    expect(result).toBe("trimme");
  });

  it.skipIf(isWindows)(
    "passes multiple arguments to the command without shell interpolation",
    async () => {
      // These args contain shell metacharacters — they must NOT be interpreted
      const result = await execSafe("echo", [
        "$HOME",
        "&&",
        "echo",
        "injected",
      ]);
      // If shell interpolation happened, $HOME would expand and the output
      // would differ.  With execFile, they're passed literally.
      expect(result).toBe("$HOME && echo injected");
    },
  );
});
