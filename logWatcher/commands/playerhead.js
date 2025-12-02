import { registerLogCommand } from "../logWatcher.js";
import { sendToServer } from "../../utils/utils.js";

const PLAYERHEAD_REGEX = /\[.+?\]: <([^>]+)> !chunkbase (\w{1,16})/;

/**
 * Handles the !playerhead Minecraft chat command and gives it as an item to the player.
 */
async function handlePlayerheadCommand(match) {
  const username = match[1];
  const playerHeadName = match[2];

  // check if player exists
  const res = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${playerHeadName}` // Mojang API to get UUID by username
  );
  if (!res.ok) {
    await sendToServer(
      `/msg ${username} Player \`${playerHeadName}\` not found.`
    );
  }

  // Give the player the head item
  await sendToServer(
    `give ${username} minecraft:player_head{SkullOwner:"${playerHeadName}"} 1`
  );
}

/**
 * Initializes the !playerhead watcher.
 */
export function init() {
  registerLogCommand(PLAYERHEAD_REGEX, handlePlayerheadCommand);
  console.log("🔥 !playerhead command handler registered");
}
