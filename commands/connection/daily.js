import { SlashCommandBuilder, MessageFlags } from "discord.js";
import path from "path";
import {
  getOnlinePlayers,
  loadJson,
  saveJson,
  getRootDir,
} from "../../utils/utils.js";
import { sendToServer } from "../../utils/sendToServer.js";
import { isLinked, getLinkedAccount } from "../../utils/linkUtils.js";

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
    return interaction.reply({
      content: "❌ You must link your Discord account to claim daily rewards.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const linkedUsername = await getLinkedAccount(userId);

  const [dailyRewards, claimedDaily] = await Promise.all([
    loadJson(dailyRewardsPath).catch(() => ({})),
    loadJson(claimedPath).catch(() => ({})),
  ]);

  if (!dailyRewards || !Object.keys(dailyRewards).length) {
    return interaction.reply({
      content: "❌ No daily rewards are configured.",
    });
  }

  const now = Date.now();
  const userClaimData = claimedDaily[userId] ?? {
    lastClaim: 0,
    streak: 0,
    rewards: [],
  };
  const timeSinceLastClaim = now - userClaimData.lastClaim;

  if (timeSinceLastClaim < DAILY_COOLDOWN) {
    const remainingMs = DAILY_COOLDOWN - timeSinceLastClaim;
    const hours = Math.floor(remainingMs / 3600000);
    const minutes = Math.floor((remainingMs % 3600000) / 60000);

    return interaction.reply({
      content: `⏳ You can claim your next reward in ${hours}h ${minutes}m.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  // Check if player is online
  const onlinePlayers = await getOnlinePlayers();
  if (onlinePlayers.includes(linkedUsername)) {
    return interaction.reply({
      content: "❌ You must be online in Minecraft to claim daily rewards.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Reset streak if last claim was more than 48 hours ago
  let streak =
    timeSinceLastClaim > 48 * 60 * 60 * 1000 ? 1 : userClaimData.streak + 1;
  if (streak > MAX_STREAK) streak = 0;

  const reward = chooseWeighted(dailyRewards.default);
  const bonus = dailyRewards.streakBonuses?.[streak];

  const responseLines = [`🎁 You received: **${formatReward(reward)}**`];
  if (bonus)
    responseLines.push(
      `🔥 **${streak}-day streak bonus:** ${formatReward(bonus)}`
    );

  claimedDaily[userId] = {
    lastClaim: now,
    streak,
    rewards: [...userClaimData.rewards, { date: now, reward, bonus }],
  };

  await saveJson(claimedPath, claimedDaily);

  await giveReward(linkedUsername, reward);
  if (bonus) await giveReward(linkedUsername, bonus);

  return interaction.reply({ content: responseLines.join("\n") });
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
  return `${reward.amount ?? 1}x \`${name}\``;
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
  const cmd = `/give ${minecraftPlayer} ${item} ${reward.amount ?? 1}`;
  await sendToServer(cmd, "minecraft", "dailyReward");
}
