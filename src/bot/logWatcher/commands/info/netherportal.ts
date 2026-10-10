import { defineCommand } from "../../defineCommand.js";
import { whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { queryFailureText } from "../../queryMessages.js";

const cmd = defineCommand({
  name: "netherportal",
  description:
    "Get coordinates to link a Nether portal from your current location",
  cooldown: 5,
  handler: async (username, _args, _client, server) => {
    const coords = await server.getPlayerCoords(username);
    if (!coords.ok) {
      await whisper(
        server,
        username,
        queryFailureText(coords.reason, "netherportal.noPosition"),
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

    const { x, z } = coords.value;
    let msg: string;
    if (dimension.value.includes("overworld")) {
      msg = `Nether coords: X: ${Math.floor(x / 8)}, Z: ${Math.floor(z / 8)}`;
    } else if (dimension.value.includes("nether")) {
      msg = `Overworld coords: X: ${Math.floor(x * 8)}, Z: ${Math.floor(z * 8)}`;
    } else {
      msg = "You must be in the Overworld or Nether.";
    }
    await whisper(server, username, msg);
  },
});

export const { init, COMMAND_INFO } = cmd;
