import { defineCommand } from "../../defineCommand.js";
import { buildChunkbaseUrl } from "@mcbot/core/utils/minecraft/chunkbaseUrl.js";
import {
  clickFormatForVersion,
  openUrlClick,
} from "@mcbot/core/utils/minecraft/tellrawLink.js";

const cmd = defineCommand({
  name: "chunkbase",
  description: "Get a Chunkbase link for your current location",
  cooldown: 10,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed) {
      await server.sendCommand(
        `/msg ${username} Could not retrieve the world seed.`,
      );
      return;
    }

    const dimension = await server.getPlayerDimension(username);

    let coords: { x: number; z: number } | undefined;
    try {
      coords = (await server.getPlayerCoords(username)) ?? undefined;
    } catch {
      /* the link still works without a position */
    }

    const url = buildChunkbaseUrl(seed, dimension, coords?.x, coords?.z);
    const format = clickFormatForVersion(await server.getMinecraftVersion());

    const tellRaw = {
      text: "",
      extra: [
        { text: "See your location on Chunkbase: ", color: "white" },
        {
          text: "[Click here]",
          color: "gold",
          underlined: true,
          ...openUrlClick(url, format),
        },
        { text: ` ${url}`, color: "gray" },
      ],
    };
    await server.sendCommand(`/tellraw ${username} ${JSON.stringify(tellRaw)}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
