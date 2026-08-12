/**
 * Reading a Minecraft server log line well enough to colour it.
 *
 * The console pane rendered every line in the same grey, so
 * `[Server thread/WARN]: Can't keep up! Running 2003ms or 40 ticks behind`
 * sat at exactly the weight of a routine join message. The one line worth
 * noticing in a screenful was the one line nothing pointed at.
 *
 * Vanilla and most loaders emit `[HH:MM:SS] [thread/LEVEL]: message`, so the
 * level is in the second bracket group. Mods that log through their own
 * appender do not always follow it, which is why an unrecognised line is
 * `info` rather than a guess: colouring by keyword-anywhere would paint every
 * chat message containing the word "error".
 *
 * Pure and framework-free, so it can be unit-tested without mounting anything.
 */

export const LOG_LEVELS = ["error", "warn", "info"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** `[12:34:56] [Server thread/WARN]: …` → the level in the thread bracket. */
const LEVEL_IN_BRACKET = /\[[^\]]*\/(FATAL|ERROR|SEVERE|WARN(?:ING)?|INFO|DEBUG|TRACE)\]/i;

/**
 * The level a line should be rendered at.
 *
 * `fatal` and `severe` fold into `error`, and `debug`/`trace` into `info`:
 * the pane needs three weights (something broke, something to check,
 * everything else), not the full logger taxonomy.
 */
export function logLevel(line: string): LogLevel {
  const match = LEVEL_IN_BRACKET.exec(line);
  if (!match) return "info";
  const level = match[1]!.toUpperCase();
  if (level === "FATAL" || level === "ERROR" || level === "SEVERE") return "error";
  if (level === "WARN" || level === "WARNING") return "warn";
  return "info";
}

/** Does this line pass the pane's filters? Level floor first, then free text. */
export function lineMatches(
  line: string,
  opts: { minLevel?: LogLevel; query?: string } = {},
): boolean {
  const { minLevel = "info", query = "" } = opts;
  // LOG_LEVELS runs most-severe first, so a lower index is a louder line.
  if (LOG_LEVELS.indexOf(logLevel(line)) > LOG_LEVELS.indexOf(minLevel)) {
    return false;
  }
  const q = query.trim().toLowerCase();
  return q === "" || line.toLowerCase().includes(q);
}
