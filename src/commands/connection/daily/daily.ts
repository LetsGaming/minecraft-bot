import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import path from 'path';
import {
  loadJson,
  saveJson,
  getRootDir,
} from '../../../utils/utils.js';
import { getOnlinePlayers } from '../../../utils/playerUtils.js';
import { isLinked, getLinkedAccount } from '../../../utils/linkUtils.js';
import { createErrorEmbed } from '../../../utils/embedUtils.js';
import type { DailyRewardsConfig, DailyRewardItem, UserClaimData } from '../../../types/index.js';
import { log } from '../../../utils/logger.js';
import { resolveServer } from '../../../utils/guildRouter.js';

const baseDir = getRootDir();
const dataDir = path.resolve(baseDir, 'data');
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const MAX_STREAK = 35;

// Per-user in-memory lock — prevents concurrent /daily executions from the
// same user (double-click, network retry) both passing the cooldown check
// before either writes back. Sufficient for single-process PM2 deployments.
const claimLock = new Set<string>();

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Claim your daily reward | Link required');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  if (claimLock.has(userId)) {
    await interaction.reply({
      content: '⏳ Already processing your claim — please wait.',
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

async function _execute(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
  if (!(await isLinked(userId))) {
    await interaction.reply(
      errorReply('You must link your Discord account first.', 'Link Required'),
    );
    return;
  }

  const username = await getLinkedAccount(userId);
  if (!username) {
    await interaction.reply(
      errorReply('Could not resolve linked account.', 'Link Error'),
    );
    return;
  }

  const server = resolveServer(interaction);

  const [rewardsCfg, claimed] = await Promise.all([
    loadJson(path.join(dataDir, 'dailyRewards.json')).catch(() => ({})) as Promise<DailyRewardsConfig>,
    loadJson(path.join(dataDir, 'claimedDaily.json')).catch(() => ({})) as Promise<Record<string, UserClaimData>>,
  ]);

  if (!rewardsCfg.default?.length) {
    await interaction.reply(
      errorReply('Daily rewards data unavailable.', 'Data Error'),
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
      errorReply('You must be online in Minecraft to claim.', 'Online Requirement'),
    );
    return;
  }

  const { currentStreak, bonusStreak, longestStreak } = calcStreak(
    userData,
    delta,
  );
  const reward = pick(rewardsCfg.default);
  const bonus = rewardsCfg.streakBonuses?.[String(bonusStreak)] ?? null;
  await give(server, username, reward);
  if (bonus) await give(server, username, bonus);

  claimed[userId] = {
    lastClaim: now,
    currentStreak,
    bonusStreak,
    longestStreak,
    rewards: [...userData.rewards, { date: now, reward, bonus }],
  };
  await saveJson(path.join(dataDir, 'claimedDaily.json'), claimed);

  await interaction.reply(response(reward, bonus, currentStreak, bonusStreak));
}

// ── helpers ──

function errorReply(msg: string, footer: string): { embeds: [ReturnType<typeof createErrorEmbed>]; flags: number } {
  return {
    embeds: [
      createErrorEmbed(msg, { footer: { text: footer }, timestamp: new Date() }),
    ],
    flags: MessageFlags.Ephemeral as number,
  };
}

function cooldownMsg(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const readyAt = new Date(Date.now() + ms);
  return `⏳ Next claim in ${h}h ${m}m. | Ready at ${readyAt.toLocaleTimeString(
    'en-GB',
    {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    },
  )}`;
}

interface StreakResult {
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
}

export function calcStreak(
  { currentStreak, bonusStreak, longestStreak }: Pick<UserClaimData, 'currentStreak' | 'bonusStreak' | 'longestStreak'>,
  delta: number,
): StreakResult {
  const broken = delta > 2 * DAILY_COOLDOWN;
  const cs = broken ? 1 : currentStreak + 1;
  const bs = broken ? 1 : Math.min(bonusStreak + 1, MAX_STREAK);
  return {
    currentStreak: cs,
    bonusStreak: bs,
    longestStreak: Math.max(longestStreak, cs),
  };
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
  reward: DailyRewardItem,
  bonus: DailyRewardItem | null,
  cs: number,
  bs: number,
): { content: string } {
  const lines = [`🎁 **${fmt(reward)}**`];
  if (bonus) lines.push(`🔥 **${bs}-day bonus:** ${fmt(bonus)}`);
  lines.push(`📈 Streak: ${cs} days`);
  return { content: lines.join('\n') };
}

function fmt({ item = '???', amount = 1 }: DailyRewardItem): string {
  return `${amount}x ${item.replace(/^minecraft:/, '')}`;
}

async function give(server: import('../../../utils/server.js').ServerInstance, player: string, { item, amount = 1 }: DailyRewardItem): Promise<void> {
  if (!player || !item) {
    log.error('daily', `Invalid reward params for player=${player} item=${item}`);
    return;
  }
  const name = item.startsWith('minecraft:') ? item : `minecraft:${item}`;
  await server.sendCommand(`give ${player} ${name} ${amount}`);
}
