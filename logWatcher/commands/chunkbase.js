import { registerLogCommand } from "../logWatcher.js";
import { getSeed, sendToServer } from "../../utils/utils.js";
import {
  getPlayerCoords,
  getPlayerDimension,
} from "../../utils/playerUtils.js";

// Example log: [12:34:56] [Server thread/INFO]: <PlayerName> !chunkbase
const CHUNKBASE_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)> !chunkbase/;

/**
 * Handles the !chunkbase Minecraft chat command.
 */
/**
 * Handles the !chunkbase Minecraft chat command.
 */
async function handleChunkbaseCommand(match) {
  const user = match[1];

  const seed = await getSeed();
  if (!seed) {
    await sendToServer(`/msg ${user} Could not retrieve the world seed.`);
    return;
  }

  const dimension = await getPlayerDimension(user) || "overworld";
  const playerCoords = await getPlayerCoords(user);

  let coordsParam = "";

  if (playerCoords) {
    coordsParam = `&x=${Math.floor(playerCoords.x)}&z=${Math.floor(
      playerCoords.z
    )}`;
  }

  const baseUrl = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

  // Build clickable tellraw message
  const tellrawJson = JSON.stringify([
    {
      text: "Chunkbase map",
      color: "yellow"
    },
    {
      text: " [Click here]",
      color: "aqua",
      underlined: true,
      clickEvent: {
        action: "open_url",
        value: baseUrl
      }
    }
  ]);

  await sendToServer(`/tellraw ${user} ${tellrawJson}`);
}

export function init() {
  registerLogCommand(CHUNKBASE_REGEX, handleChunkbaseCommand);
  console.log("🔥 !chunkbase command handler registered");
}