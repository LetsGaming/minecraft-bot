import { defineCommand } from "../../defineCommand.js";
import { buildChunkbaseUrl } from "@mcbot/core/utils/minecraft/chunkbaseUrl.js";
import {
  clickFormatForVersion,
  openUrlClick,
} from "@mcbot/core/utils/minecraft/tellrawLink.js";
import { tellraw, whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { queryFailureText } from "../../queryMessages.js";
import { t } from "@mcbot/core/utils/i18n.js";

const cmd = defineCommand({
  name: "chunkbase",
  description: "Get a Chunkbase link for your current location",
  cooldown: 10,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed.ok) {
      await whisper(
        server,
        username,
        queryFailureText(seed.reason, "seed.unavailable"),
      );
      return;
    }

    const dimension = await server.getPlayerDimension(username);
    if (!dimension.ok) {
      await whisper(
        server,
        username,
        queryFailureText(dimension.reason, "query.noDimension"),
      );
      return;
    }

    // The link still works without a position.
    const position = await server.getPlayerCoords(username);
    const coords = position.ok ? position.value : undefined;

    const url = buildChunkbaseUrl(
      seed.value,
      dimension.value,
      coords?.x,
      coords?.z,
    );
    const format = clickFormatForVersion(await server.getMinecraftVersion());

    const tellRaw = {
      text: "",
      extra: [
        { text: t("ingame.chunkbase.prefix"), color: "white" },
        {
          text: t("ingame.chunkbase.click"),
          color: "gold",
          underlined: true,
          ...openUrlClick(url, format),
        },
        { text: ` ${url}`, color: "gray" },
      ],
    };
    await tellraw(server, username, tellRaw);
  },
});

export const { init, COMMAND_INFO } = cmd;
