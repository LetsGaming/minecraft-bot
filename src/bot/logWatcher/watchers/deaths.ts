import { type Client } from "discord.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../../common/types/index.js";
import { broadcastNotification, PLAYER_NAME } from "./notifyGuilds.js";
import { loadConfig } from "../../../common/config.js";
import { loadLinkedAccounts } from "../../../common/utils/linkUtils.js";
import { buildChunkbaseUrl } from "../../../common/utils/chunkbaseUrl.js";
import { t } from "../../../common/utils/i18n.js";
import { log } from "../../../common/utils/logger.js";
import type { ServerInstance } from "../../../common/utils/server.js";

// Use PLAYER_NAME (not \w+) so Bedrock players with "."-prefixed
// names get death notifications too.
const DEATH_REGEX = new RegExp(
  String.raw`\[.+?\].*:\s+(${PLAYER_NAME})\s+(was slain|was shot|was killed|drowned|burned|fell|hit the ground|went off with a bang|blew up|was blown up|tried to swim|was impaled|was squished|was pummeled|was fireballed|starved|suffocated|was poked|experienced kinetic|was doomed|walked into|was pricked|died|withered away|was stung|was obliterated|was squashed|didn't want to live|was frozen|was skewered)(.*)$`,
  "i",
);

/**
 * DM the linked Discord account with the death coordinates and a
 * Chunkbase link (config `deathCoords.dmLinked`). Best-effort by design:
 * closed DMs, unlinked players, or unreadable NBT must never break the
 * death notification itself.
 */
async function dmDeathCoords(
  client: Client,
  server: ServerInstance,
  player: string,
): Promise<void> {
  const linked = await loadLinkedAccounts().catch(
    () => ({}) as Record<string, string>,
  );
  const lower = player.toLowerCase();
  const discordId = Object.entries(linked).find(
    ([, mcName]) => mcName.toLowerCase() === lower,
  )?.[0];
  if (!discordId) return;

  const loc = await server.getLastDeathLocation(player);
  if (!loc) return;

  const lines = [
    t("deathpos.dm", {
      server: server.id,
      x: loc.x,
      y: loc.y,
      z: loc.z,
      dimension: loc.dimension,
    }),
  ];
  const seed = await server.getSeed();
  if (seed) {
    lines.push(buildChunkbaseUrl(seed, loc.dimension, loc.x, loc.z));
  }

  const user = await client.users.fetch(discordId);
  await user.send(lines.join("\n"));
}

export function registerDeathWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(DEATH_REGEX, async (match) => {
    const player = match[1]!;
    const verb = match[2]!;
    const rest = match[3] ?? "";
    const deathMessage = `${player} ${verb}${rest}`.trim();

    await broadcastNotification(client, guildConfigs, {
      serverId,
      event: "death",
      logTag: "deaths",
      buildEmbed: (withServerFooter) =>
        createPlayerEmbed(player, {
          title: "☠️ Death",
          description: deathMessage,
          color: 0xff5555,
          ...(withServerFooter ? { footer: { text: serverId } } : {}),
        }),
    });

    let dmLinked = false;
    try {
      dmLinked = loadConfig().deathCoords?.dmLinked === true;
    } catch {
      /* config unavailable — feature stays off */
    }
    if (dmLinked) {
      try {
        await dmDeathCoords(client, logWatcher.server, player);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("deaths", `Death-coords DM for ${player} failed: ${msg}`);
      }
    }
  });
}
