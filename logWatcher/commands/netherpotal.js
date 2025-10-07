import { registerLogCommand } from "../logWatcher.js";
import { getPlayerCoords, getPlayerDimension } from "../../utils/playerUtils.js";
import { sendToServer } from "../../utils/utils.js";

// Example log: [18:32:15] [Server thread/INFO]: <LetsGamingDE> !netherportal
const NETHERPORTAL_REGEX = /\[.+?\]: <([^>]+)> !netherportal/;

/**
 * Handles the !netherportal Minecraft chat command.
 */
async function handleNetherportalCommand(match) {
  const [, username] = match;

  try {
    const coords = await getPlayerCoords(username);

    if (!coords) {
      await sendToServer(`/msg ${username} ❌ Could not get your position. Make sure you're online.`);
      return;
    }

    const dimension = await getPlayerDimension(username);

    const { x, z } = coords;
    let targetX, targetZ, message;

    if (dimension.includes("overworld")) {
      // Overworld → Nether
      targetX = Math.floor(x / 8);
      targetZ = Math.floor(z / 8);
      message = `To link this portal in the Nether, go to X: ${targetX}, Z: ${targetZ}`;
    } else if (dimension.includes("nether")) {
      // Nether → Overworld
      targetX = Math.floor(x * 8);
      targetZ = Math.floor(z * 8);
      message = `To link this portal in the Overworld, go to X: ${targetX}, Z: ${targetZ}`;
    } else {
      message = "! You must be in the Overworld or Nether for this command to work.";
    }

    // Whisper the message to the player
    await sendToServer(`/msg ${username} ${message}`);
  } catch (err) {
    console.error(`Error processing !netherportal for ${username}:`, err);
    await sendToServer(`/msg ${username} X Error calculating portal coordinates.`);
  }
}

/**
 * Initializes the !netherportal watcher.
 */
export function init() {
  registerLogCommand(NETHERPORTAL_REGEX, handleNetherportalCommand);
  console.log("🔥 !netherportal command handler registered");
}
