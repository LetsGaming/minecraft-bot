import { registerLogCommand } from "../logWatcher.js";
import { getSeed, sendToServer } from "../../utils/utils.js";
import {
  getPlayerCoords,
  getPlayerDimension,
} from "../../utils/playerUtils.js";

// Example log: [12:34:56] [Server thread/INFO]: <PlayerName> !chunkbase
const CHUNKBASE_REGEX = /\[.+?\]: <([^>]+)> !chunkbase/;

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

  const dimension = getPlayerDimension(user) || "overworld";
  const playerCoords = await getPlayerCoords(user);

  let coordsParam = "";

  if (playerCoords) {
    coordsParam = `&x=${Math.floor(playerCoords.x)}&z=${Math.floor(
      playerCoords.z
    )}`;
  } else {
    coordsParam = "";
  }

  const baseUrl = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

  const message = `You can view the Chunkbase map for the server's world seed here: ${baseUrl}`;
  await sendToServer(`/msg ${user} ${message}`);
}

export function init() {
  registerLogCommand(CHUNKBASE_REGEX, handleChunkbaseCommand);
  console.log("🔥 !chunkbase command handler registered");
}