/**
 * Fires /watch subscriptions: pulls matching one-shot watches out of the
 * store and DMs each subscriber. Fire-and-forget by contract — callers
 * (downtime monitor, join watcher) must never stall or fail because a DM
 * couldn't be delivered, so everything here is caught and logged.
 */
import { type Client } from "discord.js";
import {
  takeMatchingWatches,
  type WatchKind,
} from "@mcbot/core/utils/stores/watchStore.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";

export function fireWatches(
  client: Client,
  event: { kind: WatchKind; serverId: string; player?: string },
): void {
  void (async () => {
    const matched = await takeMatchingWatches(event);
    for (const watch of matched) {
      try {
        const user = await client.users.fetch(watch.userId);
        await user.send(
          watch.kind === "server"
            ? t("watch.dmServer", { server: watch.serverId })
            : t("watch.dmPlayer", {
                player: event.player ?? watch.player ?? "?",
                server: watch.serverId,
              }),
        );
      } catch {
        // Closed DMs — the watch is already consumed either way; a
        // retry loop against closed DMs helps nobody.
      }
    }
  })().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("watch", `Firing watches failed: ${msg}`);
  });
}
