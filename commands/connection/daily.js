import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { fileURLToPath } from "url";
import path from "path";
import { loadJson, saveJson } from "../../utils/utils.js";
import { sendToServer } from "../../utils/sendToServer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const linkedPath = path.resolve(__dirname, "../../data/linkedAccounts.json");
const dailyRewardsPath = path.resolve(
  __dirname,
  "../../data/dailyRewards.json"
);
const claimedPath = path.resolve(__dirname, "../../data/claimedDaily.json");

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

  const linkedAccounts = await loadJson(linkedPath).catch(() => ({}));
  const linkedUsername = linkedAccounts[userId];

  if (!linkedUsername) {
    return interaction.reply({
      content:
        "❌ Your Discord account is not linked to any Minecraft account.",
      flags: MessageFlags.Ephemeral,
    });
  }

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

async function isLinked(userId) {
  const linked = await loadJson(linkedPath).catch(() => ({}));
  return userId in linked;
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
