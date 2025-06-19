import { SlashCommandBuilder, MessageFlags } from "discord.js";
import path from "path";
import {
  getOnlinePlayers,
  loadJson,
  saveJson,
  getRootDir,
  sendToServer
} from "../../utils/utils.js";
import { isLinked, getLinkedAccount } from "../../utils/linkUtils.js";
import { createErrorEmbed } from "../../utils/embedUtils.js";

const baseDir = getRootDir();

const dailyRewardsPath = path.resolve(baseDir, "data", "dailyRewards.json");
const claimedPath = path.resolve(baseDir, "data", "claimedDaily.json");

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in ms
const MAX_STREAK = 35;

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward | Linked required");

export async function execute(interaction) {
  const userId = interaction.user.id;

  if (!(await isLinked(userId))) {
    const errorEmbed = createErrorEmbed(
      "You must link your Discord account to a Minecraft account first.",
      {
        footer: { text: "Link Required" },
        timestamp: new Date(),
      }
    );
    return interaction.reply({
      embeds: [errorEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const linkedUsername = await getLinkedAccount(userId);

  const [dailyRewards, claimedDaily] = await Promise.all([
    loadJson(dailyRewardsPath).catch(() => ({})),
    loadJson(claimedPath).catch(() => ({})),
  ]);

  if (!dailyRewards || !Object.keys(dailyRewards).length) {
    const errorEmbed = createErrorEmbed(
      "Daily rewards data is not available. Please contact an admin.",
      {
        footer: { text: "Data Error" },
        timestamp: new Date(),
      }
    );
    return interaction.reply({
      embeds: [errorEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const now = Date.now();
  const userClaimData = getUserClaimData(claimedDaily, userId);

  const timeSinceLastClaim = now - userClaimData.lastClaim;

  if (isClaimTooSoon(timeSinceLastClaim)) {
    const msg = getCooldownMessage(timeSinceLastClaim);
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  }

  const onlinePlayers = await getOnlinePlayers();
  if (!onlinePlayers.includes(linkedUsername)) {
    const errorEmbed = createErrorEmbed(
      `You must be online in Minecraft to claim your daily reward.`,
      {
        footer: { text: "Online Requirement" },
        timestamp: new Date(),
      }
    );
    return interaction.reply({
      embeds: [errorEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const streakBroken = isStreakBroken(timeSinceLastClaim);
  const { currentStreak, bonusStreak, longestStreak } = updateStreaks(
    userClaimData,
    streakBroken
  );

  const reward = chooseWeighted(dailyRewards.default);
  const bonus = dailyRewards.streakBonuses?.[bonusStreak];

  await processReward(linkedUsername, reward, bonus);

  claimedDaily[userId] = {
    lastClaim: now,
    currentStreak,
    bonusStreak,
    longestStreak,
    rewards: [...userClaimData.rewards, { date: now, reward, bonus }],
  };
  await saveJson(claimedPath, claimedDaily);

  const response = buildResponse(
    reward,
    bonus,
    currentStreak,
    longestStreak,
    bonusStreak
  );
  return interaction.reply({ content: response });
}

function getUserClaimData(claimedDaily, userId) {
  return (
    claimedDaily[userId] ?? {
      lastClaim: 0,
      currentStreak: 0,
      bonusStreak: 0,
      longestStreak: 0,
      rewards: [],
    }
  );
}

function isClaimTooSoon(timeSinceLastClaim) {
  return timeSinceLastClaim < DAILY_COOLDOWN;
}

function getCooldownMessage(timeSinceLastClaim) {
  const remainingMs = DAILY_COOLDOWN - timeSinceLastClaim;
  const hours = Math.floor(remainingMs / 3600000);
  const minutes = Math.floor((remainingMs % 3600000) / 60000);
  return `⏳ You can claim your next reward in ${hours}h ${minutes}m.`;
}

function isStreakBroken(timeSinceLastClaim) {
  return timeSinceLastClaim > 48 * 60 * 60 * 1000;
}

function updateStreaks(data, streakBroken) {
  const currentStreak = streakBroken ? 1 : data.currentStreak + 1;
  let bonusStreak = streakBroken ? 1 : data.bonusStreak + 1;
  if (bonusStreak > MAX_STREAK) bonusStreak = 1;
  const longestStreak = Math.max(data.longestStreak || 0, currentStreak);
  return { currentStreak, bonusStreak, longestStreak };
}

function buildResponse(
  reward,
  bonus,
  currentStreak,
  longestStreak,
  bonusStreak
) {
  const lines = [`🎁 You received: **${formatReward(reward)}**`];
  if (bonus)
    lines.push(
      `🔥 **${bonusStreak}-day bonus streak:** ${formatReward(bonus)}`
    );
  lines.push(`📈 Current Streak: ${currentStreak} days`);
  lines.push(`🏆 Longest Streak: ${longestStreak} days`);
  return lines.join("\n");
}

async function processReward(player, reward, bonus) {
  await giveReward(player, reward);
  if (bonus) await giveReward(player, bonus);
}

function chooseWeighted(pool) {
  const totalWeight = pool.reduce((sum, { weight = 1 }) => sum + weight, 0);
  const rand = Math.random() * totalWeight;
  let cumulative = 0;

  for (const item of pool) {
    cumulative += item.weight ?? 1;
    if (rand < cumulative) return item;
  }

  return pool[0]; // fallback
}

function formatReward(reward) {
  const name = reward.item?.replace(/^minecraft:/, "") || "???";
  return `${reward.amount ?? 1}x ${name}`;
}

async function giveReward(minecraftPlayer, reward) {
  if (!minecraftPlayer || !reward?.item) {
    console.error("Invalid parameters for giving reward:", {
      minecraftPlayer,
      reward,
    });
    return;
  }

  const item = reward.item.startsWith("minecraft:")
    ? reward.item
    : `minecraft:${reward.item}`;
  const cmd = `give ${minecraftPlayer} ${item} ${reward.amount ?? 1}`;
  await sendToServer(cmd);
}
