// ── Console command policy ──────────────────────────────────────────────────
// DSH-02: the deny-list guarding the dashboard console, carried over from the
// server manager's BLOCKED_COMMANDS.
//
// Named here rather than in the route because two sides need the same answer:
// the backend, which enforces it, and the editor UI, which should grey a
// blocked command out before it is sent. A second copy of the matching rule is
// how a UI ends up promising something the backend refuses (or worse, the
// reverse).
//
// The normalisation is the part worth keeping from the old implementation. Its
// first version compared the raw string, so a deny entry of `stop` was bypassed
// by typing `/stop` — Minecraft accepts both. Leading slashes come off and the
// comparison is lowercase, so one entry covers every spelling.

/**
 * Sensible defaults when an operator configures nothing.
 *
 * `stop` is here because the console is not how a server should be stopped:
 * the managed path runs the shutdown script, which warns players, saves, and
 * lets the supervisor bring it back. A bare `stop` through RCON skips all of
 * that and looks like a crash.
 *
 * `op` and `deop` are here because granting operator is an escalation that
 * outlives the session and is invisible in Discord. Someone with
 * `server:console` should not be able to make themselves a server operator
 * in-game as a side effect.
 */
export const DEFAULT_BLOCKED_COMMANDS = ["stop", "op", "deop"] as const;

/** Longest command accepted, before the wrapper's own transport limits. */
export const MAX_CONSOLE_COMMAND_LENGTH = 512;

/**
 * Reduce a command to the form the deny-list matches against: no leading
 * slashes, no surrounding whitespace, lowercase.
 */
export function normalizeConsoleCommand(raw: string): string {
  return raw.trim().replace(/^\/+/, "").toLowerCase();
}

/**
 * The first word of a normalized command: what a deny entry names. A
 * namespace comes off (AUD-010): vanilla and Bukkit both accept
 * `minecraft:op` / `bukkit:stop` as the same command as `op` / `stop`, so
 * an entry of `op` has to cover them.
 */
export function consoleCommandVerb(raw: string): string {
  const word = normalizeConsoleCommand(raw).split(/\s+/, 1)[0] ?? "";
  return word.slice(word.lastIndexOf(":") + 1);
}

/**
 * Every command `raw` would run: itself, and for `execute ... run <cmd>` or
 * `return run <cmd>` the command after each `run` token
 * (`execute as @a run execute run op me`).
 */
export function consoleCommandVerbs(raw: string): string[] {
  const text = normalizeConsoleCommand(raw);
  const first = consoleCommandVerb(text);
  if (!first) return [];
  const verbs = [first];
  if (first !== "execute" && first !== "return") return verbs;
  // Every `run` token is a candidate: a selector or score may itself be named
  // `run`, so only the first one cannot be trusted to start the nested command.
  // Scanning each one flat also covers nested execute/return chains.
  const words = text.split(/\s+/);
  words.forEach((word, i) => {
    if (word !== "run") return;
    const verb = consoleCommandVerb(words.slice(i + 1).join(" "));
    if (verb) verbs.push(verb);
  });
  return verbs;
}

/**
 * Is this command blocked by `denyList`?
 *
 * Matching is on the verb, not a prefix. A prefix match (the old behaviour)
 * meant blocking `op` also blocked `opendoor`, and blocking `stop` also
 * blocked a plugin's `stopwatch` — surprising in a way that gets the deny-list
 * disabled rather than corrected. Entries are normalised too, so a deny-list
 * written as `["/stop", "OP"]` behaves the same as `["stop", "op"]`.
 *
 * Every command the line would run is checked: the verb with any
 * `namespace:` removed, and what follows `run` in an `execute` chain
 * (AUD-010). It is still a deny-list: a plugin that runs commands for its
 * caller (`sudo`, a scripting plugin) can reach a blocked command, so it
 * guards against mistakes and casual escalation, not a determined holder of
 * `server:console`.
 */
export function isBlockedConsoleCommand(
  raw: string,
  denyList: readonly string[] = DEFAULT_BLOCKED_COMMANDS,
): boolean {
  const blocked = new Set(denyList.map((entry) => consoleCommandVerb(entry)));
  blocked.delete("");
  return consoleCommandVerbs(raw).some((verb) => blocked.has(verb));
}
