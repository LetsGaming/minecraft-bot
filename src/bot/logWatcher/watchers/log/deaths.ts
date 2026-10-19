import {
  deliverEventTip,
  tipForEvent,
} from "@mcbot/core/utils/minecraft/eventTips.js";
import { EmbedCategory, CATEGORY_STYLE } from "@mcbot/schema/embedCategories.js";
import { type Client } from "discord.js";
import { createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import type { ILogWatcher } from "../../logWatcher.js";
import { broadcastNotification } from "../notifyGuilds.js";
import { runDetached } from "../sendQueue.js";
import { PLAYER_NAME } from "@mcbot/core/utils/sanitize.js";
import type { GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import { loadConfig } from "@mcbot/core/config.js";
import {
  loadLinkedAccountsOrEmpty,
  findDiscordIdByMcName,
} from "@mcbot/core/utils/stores/linkUtils.js";
import { buildChunkbaseUrl } from "@mcbot/core/utils/minecraft/chunkbaseUrl.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { errMsg } from "@mcbot/core/utils/error.js";

// PLAYER_NAME (not \w+) so Bedrock players with "."-prefixed names get
// death notifications too. The death-message openers live in a table: one
// place to extend when Mojang adds messages. Order is significant only in
// that longer phrases sharing a prefix must come before their prefix.
const DEATH_PHRASES = [
  "was slain",
  "was shot",
  "was killed",
  "drowned",
  "burned",
  "fell",
  "hit the ground",
  "went off with a bang",
  "blew up",
  "was blown up",
  "tried to swim",
  "was impaled",
  "was squished",
  "was pummeled",
  "was fireballed",
  "starved",
  "suffocated",
  "was poked",
  "experienced kinetic",
  "was doomed",
  "walked into",
  "was pricked",
  "died",
  "withered away",
  "was stung",
  "was obliterated",
  "was squashed",
  "didn't want to live",
  "was frozen",
  "was skewered",
  "froze to death",
  "was struck by lightning",
  "went up in flames",
  "was burned",
  "was burnt",
  "discovered the floor was lava",
  "was roasted in dragon's breath",
  "was smashed",
  "left the confines of this world",
] as const;

// Anchored on the server thread tag via serverEventRegex: a chat message
// must not forge a death notification.
const DEATH_REGEX = serverEventRegex(
  String.raw`(${PLAYER_NAME})\s+(${DEATH_PHRASES.join("|")})(.*)$`,
  "i",
);

const KILLER_REGEX = new RegExp(String.raw`\bby\s+(${PLAYER_NAME})`, "u");

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
  const linked = await loadLinkedAccountsOrEmpty();
  const discordId = findDiscordIdByMcName(linked, player);
  if (!discordId) return;

  const result = await server.getLastDeathLocation(player);
  if (!result.ok) return;
  const loc = result.value;

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
  if (seed.ok) {
    lines.push(buildChunkbaseUrl(seed.value, loc.dimension, loc.x, loc.z));
  }

  const user = await client.users.fetch(discordId);
  await user.send(lines.join("\n"));
}

/**
 * Was this death caused by another player?
 *
 * Vanilla writes "X was slain by Y" for a mob and for a player alike, so
 * the message alone cannot say. Y being online right now is the practical
 * test: a player kill requires the killer to be on the server, and a mob
 * name will not appear in the player list. Wrong only in the harmless
 * direction — a mob named after an online player suppresses one tip.
 *
 * Any failure reads as "not PvP": the plain death tip is the safe default.
 */
async function wasKilledByPlayer(
  server: ServerInstance,
  victim: string,
  rest: string,
): Promise<boolean> {
  const killer = KILLER_REGEX.exec(rest)?.[1];
  if (!killer || killer.toLowerCase() === victim.toLowerCase()) return false;

  try {
    const list = await server.getList();
    return (
      list.ok &&
      list.value.players.some((name: string) => name.toLowerCase() === killer.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * Everything after the Discord notification: the in-game tip and the optional
 * death-coordinates DM. Runs detached from the log dispatch queue because it
 * waits on several server round trips.
 */
async function followUp(
  client: Client,
  server: ServerInstance,
  player: string,
  rest: string,
): Promise<void> {
  // In game, and before the DM branch: the tips point at in-game
  // commands, so gating them on a linked Discord account would have hidden
  // them from exactly the players who have not linked yet. Whispered to
  // whoever just died, linked or not.
  //
  // Whether this was PvP costs a player-list call, so it is only asked
  // when the PvP tip could still be shown: otherwise every death on the
  // server would pay for a tip that ran out weeks ago. If it has run out,
  // "death" is the right event anyway: they still died somewhere.
  const pvpTipPossible = await tipForEvent("death-by-player", {
    player,
    serverId: server.id,
  });
  const event =
    pvpTipPossible && (await wasKilledByPlayer(server, player, rest))
      ? "death-by-player"
      : "death";
  await deliverEventTip(server, event, player);

  let dmLinked = false;
  try {
    dmLinked = loadConfig().deathCoords?.dmLinked === true;
  } catch {
    /* config unavailable: feature stays off */
  }
  if (dmLinked) {
    try {
      await dmDeathCoords(client, server, player);
    } catch (err) {
      log.warn("deaths", `Death-coords DM for ${player} failed: ${errMsg(err)}`);
    }
  }
}

export function registerDeathWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: GuildConfigSource,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, DEATH_REGEX, (match) => {
    const player = match[1]!;
    const verb = match[2]!;
    const rest = match[3] ?? "";
    const deathMessage = `${player} ${verb}${rest}`.trim();

    void broadcastNotification(client, guildConfigs, {
      serverId,
      event: "death",
      logTag: "deaths",
      buildEmbed: (withServerFooter) =>
        createPlayerEmbed(player, {
          description: `${CATEGORY_STYLE[EmbedCategory.Death].icon} ${deathMessage}`,
          category: EmbedCategory.Death,
          ...(withServerFooter ? { footer: { text: serverId } } : {}),
        }),
    });

    void runDetached("deaths", `Follow-up for ${player} failed`, () =>
      followUp(client, logWatcher.server, player, rest),
    );
  });
}
