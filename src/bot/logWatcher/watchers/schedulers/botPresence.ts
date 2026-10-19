import { ActivityType, type Client } from "discord.js";
import { tryLoadConfig } from "@mcbot/core/utils/config/configAccess.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";

export interface PlayerCounts {
  online: number;
  max: number;
}

/** What the presence needs to know about one server's latest status pass. */
export interface PresenceSample {
  counts: PlayerCounts;
  /** Whether the server answered as running this pass. */
  online?: boolean;
}

let presenceWasSet = false;

/**
 * Bot presence with player count: "Playing 7 online @ SMP" in the member
 * list, without opening a channel. Rides the status pass's shared samples, so
 * presence never costs extra server round-trips.
 *
 * A multi-tenant process serves all guilds with a single presence, so
 * with no `presence.server` configured the counts aggregate across every
 * instance ("{server}" then reads "N servers"). Config is read fresh each
 * pass, so /config reload toggles it live.
 */
export function updateBotPresence(
  client: Client,
  samples: Map<string, PresenceSample>,
): void {
  // Presence is additive: never break the status pass over it.
  const loaded = tryLoadConfig({ onError: "open" });
  if (!loaded.ok) return;
  const cfg = loaded.config.presence;
  if (!client.user) return;

  if (!cfg?.enabled) {
    // Toggled off at runtime: clear the stale activity once.
    if (presenceWasSet) {
      try {
        client.user.setPresence({ activities: [] });
      } catch {
        /* best-effort */
      }
      presenceWasSet = false;
    }
    return;
  }

  let online = 0;
  let max = 0;
  let serverLabel: string;
  let isDown = false;

  if (cfg.server) {
    const entry = samples.get(cfg.server);
    if (!entry) return; // unknown server: config validation already warned
    online = entry.counts.online;
    max = entry.counts.max;
    serverLabel = cfg.server;
    isDown = entry.online === false;
  } else {
    for (const e of samples.values()) {
      online += e.counts.online;
      max += e.counts.max;
    }
    serverLabel =
      samples.size === 1
        ? ([...samples.keys()][0] ?? t("presence.serverFallback"))
        : t("presence.manyServers", { count: samples.size });
    // Aggregate mode is only "down" when EVERY instance is down:
    // "0 online" with one server up is truthful, "0 online" with the
    // whole fleet unreachable is not.
    isDown =
      samples.size > 0 && [...samples.values()].every((e) => e.online === false);
  }

  // Down state: say so instead of pretending 0 players are online, and
  // switch to idle so the member list reflects it at a glance.
  const format = isDown
    ? (cfg.downFormat ?? t("presence.downFormat"))
    : (cfg.format ?? t("presence.format"));
  const name = format
    .replaceAll("{online}", String(online))
    .replaceAll("{max}", String(max))
    .replaceAll("{server}", serverLabel);

  try {
    client.user.setPresence({
      activities: [{ name, type: ActivityType.Playing }],
      status: isDown ? "idle" : "online",
    });
    presenceWasSet = true;
  } catch (err) {
    log.warn("presence", `Failed to set presence: ${errMsg(err)}`);
  }
}
