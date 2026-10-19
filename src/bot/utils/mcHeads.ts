/**
 * mc-heads.net renders a Minecraft player's head from a name or a UUID. It
 * backs both the embed author icons and the chat-bridge webhook avatars, so
 * the host and path shape live here in one place rather than being rebuilt
 * at each call site (which had also drifted, one spot URL-encoded the
 * name, one didn't).
 *
 * Always by name. Heads used to go by UUID when the bot had one cached and by
 * name otherwise, so the same player got two URLs depending on whether the
 * cache was warm (a player who joined since the last usercache read was not
 * in it). Discord and mc-heads cache each URL on its own, so the two showed
 * different skins after a skin change: a webhook message and a leave embed of
 * the same player, minutes apart, had different heads. The names passed here
 * come from the server log or the server's own lists, which carry the
 * player's current name, so the name is also the right key.
 */
const MC_HEADS_BASE_URL = "https://mc-heads.net";

/** URL of a player's 64px head render. The name is URL-encoded defensively. */
export function playerAvatarUrl(player: string): string {
  return `${MC_HEADS_BASE_URL}/avatar/${encodeURIComponent(player)}/64`;
}
