import { defineCommand } from "../defineCommand.js";
import { sendToServer, getServerSeed, getPlayerData } from "../../utils/server.js";

const cmd = defineCommand({
  name: "chunkbase",
  description: "Get a Chunkbase link for your current location",
  handler: async (username) => {
    const seed = await getServerSeed();
    if (!seed) {
      await sendToServer(`/msg ${username} Could not retrieve the world seed.`);
      return;
    }

    // Get dimension
    let dimension = "overworld";
    try {
      const dimResponse = await getPlayerData(username, "Dimension");
      if (dimResponse) {
        const match = dimResponse.match(/"minecraft:([^"]+)"/);
        if (match) dimension = match[1];
      }
    } catch { /* default to overworld */ }

    // Get coordinates
    let coordsParam = "";
    try {
      const posResponse = await getPlayerData(username, "Pos");
      if (posResponse) {
        const match = posResponse.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
        if (match) {
          coordsParam = `&x=${Math.floor(Number(match[1]))}&z=${Math.floor(Number(match[3]))}`;
        }
      }
    } catch { /* proceed without coords */ }

    const url = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

    // Minecraft Java Edition uses camelCase for tellraw JSON
    const tellRaw = [
      "",
      { text: "See your location on Chunkbase: ", color: "white" },
      {
        text: "[Click here]",
        color: "gold",
        underlined: true,
        clickEvent: {
          action: "open_url",
          value: url,
        },
        hoverEvent: {
          action: "show_text",
          contents: "Open Chunkbase Seed Map",
        },
      },
    ];

    await sendToServer(`/tellraw ${username} ${JSON.stringify(tellRaw)}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
