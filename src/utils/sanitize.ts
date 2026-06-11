/**
 * Console-input sanitization shared by every path that interpolates
 * user-controlled text into a Minecraft server console command
 * (chat bridge, /say, whitelist commands, in-game commands).
 *
 * H-02: extracted from the chat bridge (B-08) so the protection lands in
 * one tested place instead of being re-implemented (or forgotten) per caller.
 *
 * M-07: the original B-08 filter stripped all non-ASCII, mangling normal
 * messages ("Grüße" → "Gre"). Minecraft chat renders UTF-8 fine — only
 * Unicode control/format characters are dangerous (a \r or \n in input can
 * inject a second command via the screen `stuff` path), so strip exactly
 * those and keep printable Unicode.
 */

const MAX_NAME_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 160; // 32 (name) + 7 ("/say []") + 160 + margin ≤ 256

/** Strip Unicode control/format characters (incl. \r, \n) from a string. */
export function stripControlChars(input: string): string {
  return input.replace(/\p{C}/gu, "");
}

export interface SanitizedConsoleInput {
  name: string;
  message: string;
}

/**
 * Sanitize a display name + message pair for safe interpolation into a
 * console command such as `/say [name] message`.
 * Removes control characters, escapes double quotes in the message, and
 * caps lengths so the resulting command stays within Minecraft's
 * 256-char limit.
 */
export function sanitizeForConsole(
  name: string,
  message: string,
): SanitizedConsoleInput {
  const safeName = stripControlChars(name).slice(0, MAX_NAME_LENGTH);
  const safeMessage = stripControlChars(message)
    .replace(/"/g, '\\"')
    .slice(0, MAX_MESSAGE_LENGTH);
  return { name: safeName, message: safeMessage };
}

/**
 * Validate a Minecraft username before interpolating it into a console
 * command or a Mojang API URL.
 *
 * Java edition names are 1–16 chars of [A-Za-z0-9_]. Geyser/Floodgate
 * prefixes Bedrock players with "." (B-11), so dots are allowed and the
 * length cap is raised to 17 to cover the prefix.
 */
const MC_NAME_REGEX = /^[\w.]{1,17}$/;

export function isValidMcName(name: string): boolean {
  return MC_NAME_REGEX.test(name);
}
