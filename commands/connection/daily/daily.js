import { SlashCommandBuilder, MessageFlags } from "discord.js";
import path from "path";
import {
  getOnlinePlayers,
  loadJson,
  saveJson,
  getRootDir,
  sendToServer,
} from "../../../utils/utils.js";
import { isLinked, getLinkedAccount } from "../../../utils/linkUtils.js";
import { createErrorEmbed } from "../../../utils/embedUtils.js";

const baseDir = getRootDir();
const dataDir = path.resolve(baseDir, "data");
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const MAX_STREAK = 35;

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward | Link required");

export async function execute(interaction) {
  const userId = interaction.user.id;
  if (!(await isLinked(userId))) {
    return interaction.reply(
      error("You must link your Discord account first.", "Link Required")
    );
  }

  const username = await getLinkedAccount(userId);
  const [rewardsCfg = {}, claimed = {}] = await Promise.all([
    loadJson(path.join(dataDir, "dailyRewards.json")).catch(() => ({})),
    loadJson(path.join(dataDir, "claimedDaily.json")).catch(() => ({})),
  ]);

  if (!rewardsCfg.default?.length) {
    return interaction.reply(
      error("Daily rewards data unavailable.", "Data Error")
    );
  }

  const now = Date.now();
  const userData = claimed[userId] || {
    lastClaim: 0,
    currentStreak: 0,
    bonusStreak: 0,
    longestStreak: 0,
    rewards: [],
  };
  const delta = now - userData.lastClaim;

  if (delta < DAILY_COOLDOWN) {
    return interaction.reply({
      content: cooldownMsg(DAILY_COOLDOWN - delta),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!(await getOnlinePlayers()).includes(username)) {
    return interaction.reply(
      error("You must be online in Minecraft to claim.", "Online Requirement")
    );
  }

  const { currentStreak, bonusStreak, longestStreak } = calcStreak(
    userData,
    delta
  );
  const reward = pick(rewardsCfg.default);
  const bonus = rewardsCfg.streakBonuses?.[bonusStreak] || null;
  await give(username, reward);
  if (bonus) await give(username, bonus);

  claimed[userId] = {
    lastClaim: now,
    currentStreak,
    bonusStreak,
    longestStreak,
    rewards: [...userData.rewards, { date: now, reward, bonus }],
  };
  await saveJson(path.join(dataDir, "claimedDaily.json"), claimed);

  return interaction.reply(
    response(reward, bonus, currentStreak, longestStreak, bonusStreak)
  );
}

// helpers
const error = (msg, footer) => ({
  embeds: [
    createErrorEmbed(msg, { footer: { text: footer }, timestamp: new Date() }),
  ],
  flags: MessageFlags.Ephemeral,
});
const cooldownMsg = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `⏳ Next claim in ${h}h ${m}m.`;
};

function calcStreak(
  { lastClaim, currentStreak, bonusStreak, longestStreak },
  delta
) {
  const broken = delta > 2 * DAILY_COOLDOWN;
  const cs = broken ? 1 : currentStreak + 1;
  const bs = broken ? 1 : Math.min(bonusStreak + 1, MAX_STREAK);
  return {
    currentStreak: cs,
    bonusStreak: bs,
    longestStreak: Math.max(longestStreak, cs),
  };
}

function pick(pool) {
  const total = pool.reduce((sum, { weight = 1 }) => sum + weight, 0);
  let r = Math.random() * total;
  for (const item of pool) {
    r -= item.weight || 1;
    if (r < 0) return item;
  }
  return pool[0];
}

function response(reward, bonus, cs, ls, bs) {
  const lines = [`🎁 **${fmt(reward)}**`];
  if (bonus) lines.push(`🔥 **${bs}-day bonus:** ${fmt(bonus)}`);
  lines.push(`📈 Streak: ${cs} days`);
  lines.push(`🏆 Longest: ${ls} days`);
  return { content: lines.join("\n") };
}

function fmt({ item = "???", amount = 1 }) {
  return `${amount}x ${item.replace(/^minecraft:/, "")}`;
}

async function give(player, { item, amount = 1 }) {
  if (!player || !item)
    return console.error("Invalid reward params", { player, item });
  const name = item.startsWith("minecraft:") ? item : `minecraft:${item}`;
  await sendToServer(`give ${player} ${name} ${amount}`);
}
