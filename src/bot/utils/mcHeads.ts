/**
 * mc-heads.net renders a Minecraft player's head from their username. It backs
 * both the embed author icons and the chat-bridge webhook avatars, so the host
 * and path shape live here in one place rather than being rebuilt at each call
 * site (which had also drifted — one spot URL-encoded the name, one didn't).
 */
const MC_HEADS_BASE_URL = "https://mc-heads.net";

/** URL of a player's 64px head render. The name is URL-encoded defensively. */
export function playerAvatarUrl(player: string): string {
  return `${MC_HEADS_BASE_URL}/avatar/${encodeURIComponent(player)}/64`;
}
