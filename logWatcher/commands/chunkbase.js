import { registerLogCommand } from "../logWatcher.js";
import { getSeed, sendToServer } from "../../utils/utils.js";
import {
  getPlayerCoords,
  getPlayerDimension,
} from "../../utils/playerUtils.js";

export const COMMAND_INFO = {
  command: "!chunkbase",
  description:
    "Get a link to the Chunkbase map for the server's world seed and your current location",
};

// Example log: [12:34:56] [Server thread/INFO]: <PlayerName> !chunkbase
const CHUNKBASE_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)> !chunkbase/;

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

  const dimension = (await getPlayerDimension(user)) || "overworld";
  const playerCoords = await getPlayerCoords(user);

  let coordsParam = "";

  if (playerCoords) {
    coordsParam = `&x=${Math.floor(playerCoords.x)}&z=${Math.floor(
      playerCoords.z,
    )}`;
  }

  const baseUrl = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

  const tellRaw = [
    "",
    { text: "See your location on Chunkbase ", color: "white" },
    {
      text: "Click here",
      color: "gold",
      click_event: {
        action: "open_url",
        url: baseUrl,
      },
    },
  ];

  const jsonTellRaw = JSON.stringify(tellRaw);

  const command = `/tellraw ${user} ${jsonTellRaw}`;

  console.log(`Executing command: ${command}`);

  await sendToServer(command);
}

export function init() {
  registerLogCommand(CHUNKBASE_REGEX, handleChunkbaseCommand);
  console.log("🔥 !chunkbase command handler registered");
}
