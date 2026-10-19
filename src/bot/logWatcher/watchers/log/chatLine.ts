/**
 * Speaker authenticity for player chat lines.
 *
 * The chat-driven watchers (chatBridge, sleepWatcher, defineCommand) used
 * the unanchored prefix `\[.+?\]: <name>`. The lazy `.+?` let the engine
 * skip past the real speaker to any later `]: <…>` the player typed, so
 *
 *   [00:00:00] [Server thread/INFO]: <Mallory> x]: <Admin> !link 123456
 *
 * parsed as `Admin` running `!link`. `/me` (`* Mallory …`) and Discord text
 * relayed through `/say` (`[Server] [Bob] …`) worked the same way.
 *
 * CHAT_LINE_PREFIX anchors at line start and allows only the log's own
 * bracketed tags before the first `:`, `[time] [thread/LEVEL]`, Paper's
 * `[time LEVEL]`, Forge's extra `[logger]`. None of those tags can contain
 * `]`, so nothing a player typed can sit between them. After the colon the
 * one marker vanilla 1.19+ inserts, `[Not Secure]`, is allowed, and then
 * the `<name>` wrapper must follow immediately. The name therefore always
 * comes from the server's own wrapper, never from message text.
 *
 * The counterpart for server-emitted events is serverLine.ts.
 */

/**
 * Line start up to and including the speaker. Capture group 1 is the
 * speaker's name, with the `[AFK]` marker some plugins put inside the
 * wrapper stripped.
 */
export const CHAT_LINE_PREFIX = String.raw`^(?:\[[^\]]*\]\s*)+:\s+(?:\[Not Secure\]\s*)?<(?:\[AFK\]\s*)?([^<>]+)>`;

/** Build a chat watcher regex: the anchored speaker prefix, then `body`. */
export function chatLineRegex(body: string, flags?: string): RegExp {
  return new RegExp(CHAT_LINE_PREFIX + body, flags);
}
