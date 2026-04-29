import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import path from "path";
import { loadJson, saveJson, getRootDir } from "../../../utils/utils.js";
import { getOnlinePlayers } from "../../../utils/playerUtils.js";
import { isLinked, getLinkedAccount } from "../../../utils/linkUtils.js";
import { createErrorEmbed } from "../../../utils/embedUtils.js";
import type {
  DailyRewardsConfig,
  DailyRewardItem,
  UserClaimData,
} from "../../../types/index.js";
import { log } from "../../../utils/logger.js";
import { resolveServer } from "../../../utils/guildRouter.js";
import { formatTime } from "../../../utils/time.js";
import type { ServerInstance } from "../../../utils/server.js";

const baseDir = getRootDir();
const dataDir = path.resolve(baseDir, "data");
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;

const DEFAULT_MAX_STREAK = 35;
const claimLock = new Set<string>();

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward | Link required");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  if (claimLock.has(userId)) {
    await interaction.reply({
      content: "⏳ Already processing your claim — please wait.",
      flags: MessageFlags.Ephemeral as number,
    });
    return;
  }
  claimLock.add(userId);

  try {
    await _execute(interaction, userId);
  } finally {
    claimLock.delete(userId);
  }
}

async function _execute(
  interaction: ChatInputCommandInteraction,
  userId: string,
): Promise<void> {
  if (!(await isLinked(userId))) {
    await interaction.reply(
      errorReply("You must link your Discord account first.", "Link Required"),
    );
    return;
  }

  const username = await getLinkedAccount(userId);
  if (!username) {
    await interaction.reply(
      errorReply("Could not resolve linked account.", "Link Error"),
    );
    return;
  }

  const server = resolveServer(interaction);

  const [rewardsCfg, claimed] = await Promise.all([
    loadJson(path.join(dataDir, "dailyRewards.json")).catch(
      () => ({}),
    ) as Promise<DailyRewardsConfig>,
    loadJson(path.join(dataDir, "claimedDaily.json")).catch(
      () => ({}),
    ) as Promise<Record<string, UserClaimData>>,
  ]);

  if (!rewardsCfg.default?.length) {
    await interaction.reply(
      errorReply("Daily rewards data unavailable.", "Data Error"),
    );
    return;
  }

  const now = Date.now();
  const userData: UserClaimData = claimed[userId] ?? {
    lastClaim: 0,
    currentStreak: 0,
    bonusStreak: 0,
    longestStreak: 0,
    rewards: [],
  };
  const delta = now - userData.lastClaim;

  if (delta < DAILY_COOLDOWN) {
    await interaction.reply({
      content: cooldownMsg(DAILY_COOLDOWN - delta),
      flags: MessageFlags.Ephemeral as number,
    });
    return;
  }

  if (!(await getOnlinePlayers(server)).includes(username)) {
    await interaction.reply(
      errorReply(
        "You must be online in Minecraft to claim.",
        "Online Requirement",
      ),
    );
    return;
  }

  const { currentStreak, bonusStreak, longestStreak } = calcStreak(
    userData,
    delta,
    deriveMaxStreak(rewardsCfg.streakBonuses),
  );

  const grantedRewards: DailyRewardItem[] = [];
  const mainReward = pick(rewardsCfg.default);
  grantedRewards.push(mainReward);

  const bonus = rewardsCfg.streakBonuses?.[String(bonusStreak)] ?? null;
  if (bonus && bonus.length > 0) {
    grantedRewards.push(...bonus);
  }

  for (const reward of grantedRewards) {
    await give(server, username, reward);
  }

  claimed[userId] = {
    lastClaim: now,
    currentStreak,
    bonusStreak,
    longestStreak,
    rewards: [
      ...userData.rewards,
      {
        date: now,
        items: grantedRewards,
        streak: currentStreak,
      },
    ],
  };

  await saveJson(path.join(dataDir, "claimedDaily.json"), claimed);
  await interaction.reply(
    response(
      grantedRewards,
      currentStreak,
      bonusStreak,
      !!bonus && bonus.length > 0,
    ),
  );
}

function errorReply(
  msg: string,
  footer: string,
): { embeds: [ReturnType<typeof createErrorEmbed>]; flags: number } {
  return {
    embeds: [
      createErrorEmbed(msg, {
        footer: { text: footer },
        timestamp: new Date(),
      }),
    ],
    flags: MessageFlags.Ephemeral as number,
  };
}

function cooldownMsg(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const readyAt = new Date(Date.now() + ms);
  return `⏳ Next claim in ${h}h ${m}m. | Ready at ${formatTime(readyAt)}`;
}

interface StreakResult {
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
}

export function calcStreak(
  {
    currentStreak,
    bonusStreak,
    longestStreak,
  }: Pick<UserClaimData, "currentStreak" | "bonusStreak" | "longestStreak">,
  delta: number,
  cycleMax: number = DEFAULT_MAX_STREAK,
): StreakResult {
  const broken = delta > 2 * DAILY_COOLDOWN;
  const cs = broken ? 1 : currentStreak + 1;

  let bs: number;
  if (broken) {
    bs = 1;
  } else if (bonusStreak >= cycleMax) {
    bs = 1;
  } else {
    bs = bonusStreak + 1;
  }

  return {
    currentStreak: cs,
    bonusStreak: bs,
    longestStreak: Math.max(longestStreak, cs),
  };
}

export function deriveMaxStreak(
  streakBonuses: DailyRewardsConfig["streakBonuses"],
): number {
  if (!streakBonuses) return DEFAULT_MAX_STREAK;
  const keys = Object.keys(streakBonuses)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n) && n > 0);
  return keys.length > 0 ? Math.max(...keys) : DEFAULT_MAX_STREAK;
}

export function pick(pool: DailyRewardItem[]): DailyRewardItem {
  const total = pool.reduce((sum, { weight = 1 }) => sum + weight, 0);
  let r = Math.random() * total;
  for (const item of pool) {
    r -= item.weight ?? 1;
    if (r < 0) return item;
  }
  return pool[0]!;
}

function response(
  items: DailyRewardItem[],
  cs: number,
  bs: number,
  hasBonus: boolean,
): { content: string } {
  const lines: string[] = [];
  const main = items[0];

  if (main) {
    lines.push(`🎁 **Daily Reward:** ${fmt(main)}`);
  }

  if (hasBonus && items.length > 1) {
    const bonusItems = items.slice(1);
    const bonusList = bonusItems.map(fmt).join(", ");
    lines.push(`🔥 **${bs}-day bonus:** ${bonusList}`);
  }

  lines.push(`📈 Streak: ${cs} days`);
  return { content: lines.join("\n") };
}

function fmt({ item = "???", amount = 1 }: DailyRewardItem): string {
  const cleanName = item.replace(/^minecraft:/, "").replace(/_/g, " ");
  return `${amount}x ${cleanName}`;
}

async function give(
  server: ServerInstance,
  player: string,
  { item, amount = 1 }: DailyRewardItem,
): Promise<void> {
  if (!player || !item) {
    log.error(
      "daily",
      `Invalid reward params for player=${player} item=${item}`,
    );
    return;
  }
  const name = item.startsWith("minecraft:") ? item : `minecraft:${item}`;
  await server.sendCommand(`give ${player} ${name} ${amount}`);
}
