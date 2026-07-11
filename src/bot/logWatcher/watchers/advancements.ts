import { type Client } from "discord.js";
import { createPlayerEmbed, createEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";
import { broadcastNotification, PLAYER_NAME } from "./notifyGuilds.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  loadChallengeStore,
  saveChallengeStore,
  expireStale,
  getActiveChallenge,
} from "@mcbot/core/utils/challengeStore.js";
import {
  loadPendingRewards,
  savePendingRewards,
  getServerPending,
} from "@mcbot/core/utils/dailyStore.js";
import { give } from "../../commands/connection/daily/daily.js";
import { recordAdminAction } from "@mcbot/core/utils/adminAudit.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ServerInstance } from "@mcbot/core/utils/server.js";

// Use PLAYER_NAME (not \w+) so Bedrock players with "."-prefixed
// names get advancement notifications too.
// SEC-01: anchored on the server thread tag via serverEventRegex — a
// chat line must never forge an advancement (the challenge path pays
// out a real item bonus through give()).
const ADV_REGEX = serverEventRegex(
  String.raw`(${PLAYER_NAME}) has (?:made the advancement|completed the challenge|reached the goal) \[(.+?)\]`,
);

/**
 * First player to hit the active challenge's advancement wins: the
 * challenge closes, the result is announced in both directions, an audit
 * entry is written, and the optional item bonus goes out through the
 * daily give() path — falling back to the offline delivery queue when
 * the give cannot be confirmed (the winner may log out immediately).
 * The queue cap deliberately does not apply here: a challenge bonus is a
 * one-time system grant, not a farmable claim.
 */
async function handleChallenge(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  server: ServerInstance,
  player: string,
  advancement: string,
): Promise<void> {
  const store = await loadChallengeStore();
  const changed = expireStale(store, server.id);
  const active = getActiveChallenge(store, server.id);

  if (
    !active ||
    active.advancement.toLowerCase() !== advancement.toLowerCase()
  ) {
    if (changed) await saveChallengeStore(store);
    return;
  }

  active.status = "won";
  active.wonBy = player;
  active.wonAt = Date.now();
  await saveChallengeStore(store);

  await recordAdminAction({
    action: "challenge won",
    server: server.id,
    by: player,
    byId: "minecraft",
    detail: active.advancement,
  });

  const rewardLine = active.reward
    ? `\n${t("challenge.rewardLine", { reward: active.reward })}`
    : "";
  await broadcastNotification(client, guildConfigs, {
    serverId: server.id,
    event: "challenge",
    logTag: "challenges",
    buildEmbed: (withServerFooter) =>
      createEmbed({
        title: t("challenge.wonTitle"),
        description:
          t("challenge.wonEmbed", {
            player,
            advancement: active.advancement,
          }) + rewardLine,
        color: EmbedColor.Gold,
        ...(withServerFooter ? { footer: { text: server.id } } : {}),
      }),
  });

  try {
    await server.sendCommand(
      `/tellraw @a ${JSON.stringify({
        text: t("challenge.wonInGame", {
          player,
          advancement: active.advancement,
        }),
        color: "gold",
      })}`,
    );
  } catch {
    /* announcement is best-effort */
  }

  if (active.item) {
    const item = { item: active.item, amount: active.amount ?? 1 };
    const ok = await give(server, player, item);
    if (!ok) {
      const pending = await loadPendingRewards();
      const queue = getServerPending(pending, server.id);
      (queue[player.toLowerCase()] ??= []).push({
        discordId: "",
        items: [item],
        queuedAt: Date.now(),
      });
      await savePendingRewards(pending);
      log.warn(
        "challenges",
        `Bonus give for ${player} not confirmed — queued for next join`,
      );
    }
  }
}

export function registerAdvancementWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, ADV_REGEX, async (match) => {
    const [, player, advancement] = match;
    if (!player || !advancement) return;

    const isChallenge = match[0].includes("completed the challenge");

    await broadcastNotification(client, guildConfigs, {
      serverId,
      event: "advancement",
      logTag: "advancements",
      buildEmbed: (withServerFooter) =>
        createPlayerEmbed(player, {
          title: isChallenge ? `✨ Completed challenge` : `⭐ Made advancement`,
          description: `**${advancement}**`,
          color: isChallenge ? EmbedColor.Challenge : EmbedColor.Success,
          ...(withServerFooter ? { footer: { text: serverId } } : {}),
        }),
    });

    try {
      await handleChallenge(
        client,
        guildConfigs,
        logWatcher.server,
        player,
        advancement,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("challenges", `Challenge handling failed: ${msg}`);
    }
  });
}
