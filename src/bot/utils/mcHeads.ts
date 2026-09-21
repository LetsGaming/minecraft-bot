/**
 * mc-heads.net renders a Minecraft player's head from a name or a UUID. It
 * backs both the embed author icons and the chat-bridge webhook avatars, so
 * the host and path shape live here in one place rather than being rebuilt
 * at each call site (which had also drifted — one spot URL-encoded the
 * name, one didn't).
 *
 * Storage/reliability note: resolving by *name* silently falls back to the
 * default Steve/Alex render on a renamed account or a Bedrock/Geyser name
 * (`*Name`, `.Name` — not a real Java account) — mc-heads swallows the
 * failure, so the bot never even sees it happen. A UUID survives renames and
 * resolves far more reliably, so this prefers the UUID `loadKnownPlayers()`
 * already cached (see whitelist.ts's knownPlayerUuid — core, not bot, since
 * that's where every existing lookup already flows through) and falls back
 * to the raw name only when the cache has never seen this player.
 */
import { knownPlayerUuid } from "@mcbot/core/utils/minecraft/whitelist.js";

const MC_HEADS_BASE_URL = "https://mc-heads.net";

/** URL of a player's 64px head render. The identifier is URL-encoded defensively. */
export function playerAvatarUrl(player: string): string {
  const id = knownPlayerUuid(player) ?? player;
  return `${MC_HEADS_BASE_URL}/avatar/${encodeURIComponent(id)}/64`;
}
