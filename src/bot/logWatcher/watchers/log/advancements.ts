import { type Client } from "discord.js";
import { EmbedCategory, CATEGORY_STYLE } from "@mcbot/schema/embedCategories.js";
import { createPlayerEmbed, createEmbed } from "../../../utils/embeds/embedUtils.js";
import type { ILogWatcher } from "../../logWatcher.js";
import { broadcastNotification } from "../notifyGuilds.js";
import { runDetached } from "../sendQueue.js";
import { PLAYER_NAME } from "@mcbot/core/utils/sanitize.js";
import type { GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  updateChallengeStore,
  expireStale,
  getActiveChallenge,
} from "@mcbot/core/utils/stores/challengeStore.js";
import { enqueuePending } from "@mcbot/core/utils/stores/dailyStore.js";
import { give } from "@mcbot/core/utils/minecraft/rewards.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { tellraw } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";

// PLAYER_NAME (not \w+) so Bedrock players with "."-prefixed names get
// advancement notifications too. Anchored on the server thread tag via
// serverEventRegex: a chat line must never forge an advancement (the
// challenge path pays out a real item bonus through give()).
const ADV_REGEX = serverEventRegex(
  String.raw`(${PLAYER_NAME}) has (made the advancement|completed the challenge|reached the goal) \[(.+)\]\s*$`,
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
  guildConfigs: GuildConfigSource,
  server: ServerInstance,
  player: string,
  advancement: string,
): Promise<void> {
  const active = updateChallengeStore((store) => {
    expireStale(store, server.id);
    const current = getActiveChallenge(store, server.id);
    if (
      !current ||
      current.advancement.toLowerCase() !== advancement.toLowerCase()
    ) {
      return null;
    }
    current.status = "won";
    current.wonBy = player;
    current.wonAt = Date.now();
    return current;
  });
  if (!active) return;

  await recordAdminAction({
    action: "challenge won",
    server: server.id,
    by: player,
    byId: "minecraft",
    detail: active.advancement,
  });

  const reward = active.reward;
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
          }) + (reward ? `\n${t("challenge.rewardLine", { reward })}` : ""),
        category: EmbedCategory.Milestone,
        ...(withServerFooter ? { footer: { text: server.id } } : {}),
      }),
  });

  await tellraw(server, "@a", {
    text: t("challenge.wonInGame", {
      player,
      advancement: active.advancement,
    }),
    color: "gold",
  });

  if (active.item) {
    const item = { item: active.item, amount: active.amount ?? 1 };
    const ok = await give(server, player, item);
    if (!ok) {
      await enqueuePending(server.id, player, {
        discordId: "",
        items: [item],
        queuedAt: Date.now(),
      });
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
  guildConfigs: GuildConfigSource,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, ADV_REGEX, (match) => {
    const [, player, verb, advancement] = match;
    if (!player || !verb || !advancement) return;

    const isChallenge = verb === "completed the challenge";

    void broadcastNotification(client, guildConfigs, {
      serverId,
      event: "advancement",
      logTag: "advancements",
      buildEmbed: (withServerFooter) =>
        createPlayerEmbed(player, {
          description: `${CATEGORY_STYLE[isChallenge ? EmbedCategory.Milestone : EmbedCategory.Advancement].icon} ${t(
            isChallenge ? "advancement.challengeLine" : "advancement.madeLine",
            { player, advancement },
          )}`,
          category: isChallenge ? EmbedCategory.Milestone : EmbedCategory.Advancement,
          ...(withServerFooter ? { footer: { text: serverId } } : {}),
        }),
    });

    void runDetached("challenges", "Challenge handling failed", () =>
      handleChallenge(client, guildConfigs, logWatcher.server, player, advancement),
    );
  });
}
