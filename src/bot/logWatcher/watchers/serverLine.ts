/**
 * SEC-01 — event authenticity for server-emitted log lines.
 *
 * Watchers that react to lines the *server* emits (join/leave, deaths,
 * advancements, start/stop) must never match a line a *player* typed.
 * The old shared prefix `\[.+?\].*:` let `.*:` consume a chat line's
 * `<name>` wrapper up to any embedded colon, so
 *
 *   [00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Victim has made the advancement [Hax]
 *
 * matched the advancement regex — forged Discord notifications, and a
 * forged challenge win paid out a real item bonus via give().
 *
 * Two complementary guards (defense in depth — each alone already stops
 * every known forgery shape):
 *
 * 1. SERVER_LINE_PREFIX anchors on the log *thread tag*. Vanilla, Spigot
 *    and Paper emit these events on `[Server thread/INFO]` (Forge inserts
 *    an extra `[minecraft/MinecraftServer]` tag after it, which the
 *    optional tag group absorbs); Paper chat runs on
 *    `[Async Chat Thread - #N/INFO]` and can no longer match. Because the
 *    prefix is `^`-anchored with no wildcard-to-colon, the event body must
 *    start immediately after the first colon following the tags — so even
 *    on servers that log chat on the Server thread (vanilla), the
 *    `<name>` wrapper occupies the position the player name must match at.
 *
 * 2. isChatWrapped() rejects any line whose message segment opens with a
 *    chat wrapper `<name>` (optionally behind markers like `[Not Secure]`
 *    or plugin channel tags). This is the portable backstop for forks with
 *    unusual thread names — per the audit, gate on the thread tag but keep
 *    a `<>`-rejection that works everywhere.
 *
 * Chat-driven watchers (chatBridge, sleepWatcher, defineCommand) do NOT
 * use these helpers — they must keep matching chat and already anchor on
 * the `<name>` wrapper itself.
 */
import type { ILogWatcher, LogHandler } from "@mcbot/core/types/index.js";

/**
 * Prefix a server-emitted event line must carry:
 *   [HH:MM:SS] [Server thread/INFO]: …
 *   [HH:MM:SS] [Server thread/INFO] [minecraft/MinecraftServer]: …   (Forge)
 * Anchored at line start; no `.*` — the event body starts right after
 * the first colon that follows the bracketed tags.
 */
export const SERVER_LINE_PREFIX = String.raw`^\[[^\]]*\]\s*\[[^\]]*\bServer thread/INFO\b[^\]]*\](?:\s*\[[^\]]*\])*:\s+`;

/** Build a watcher regex for a server-emitted event body. */
export function serverEventRegex(body: string, flags?: string): RegExp {
  return new RegExp(SERVER_LINE_PREFIX + body, flags);
}

// Message segment = everything after the first `]:` (end of the last
// leading tag). A chat line's segment opens with `<name>` — optionally
// preceded by bracketed markers such as vanilla 1.19+ `[Not Secure]` or
// plugin world/channel tags. Bounded name length keeps the scan cheap.
const CHAT_WRAPPER = /^\s*(?:\[[^\]]*\]\s*)*<[^>]{1,64}>/;

/** True when the line's message segment is player chat (`<name> …`). */
export function isChatWrapped(line: string): boolean {
  const idx = line.indexOf("]:");
  const msg = idx >= 0 ? line.slice(idx + 2) : line;
  return CHAT_WRAPPER.test(msg);
}

/**
 * register() with the chat-wrapper backstop applied before the handler
 * runs. All server-event watchers go through this single guard.
 */
export function registerServerEvent(
  watcher: ILogWatcher,
  regex: RegExp,
  handler: LogHandler,
): void {
  watcher.register(regex, async (match, client, server) => {
    if (isChatWrapped(match.input ?? match[0] ?? "")) return;
    await handler(match, client, server);
  });
}
