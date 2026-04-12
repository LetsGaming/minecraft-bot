import { defineCommand } from "../defineCommand.js";
import { sendToServer, getPlayerData } from "../../utils/server.js";

const cmd = defineCommand({
  name: "netherportal",
  description: "Get coordinates to link a Nether portal from your current location",
  handler: async (username) => {
    let posResponse, dimResponse;

    try {
      posResponse = await getPlayerData(username, "Pos");
      dimResponse = await getPlayerData(username, "Dimension");
    } catch {
      await sendToServer(`/msg ${username} Could not get your position. Make sure you're online.`);
      return;
    }

    // Parse coordinates
    let x, z;
    if (posResponse) {
      const match = posResponse.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
      if (match) { x = Number(match[1]); z = Number(match[3]); }
    }

    if (x === undefined) {
      await sendToServer(`/msg ${username} Could not get your position.`);
      return;
    }

    // Parse dimension
    let dimension = "overworld";
    if (dimResponse) {
      const match = dimResponse.match(/"minecraft:([^"]+)"/);
      if (match) dimension = match[1];
    }

    let message;
    if (dimension.includes("overworld")) {
      const targetX = Math.floor(x / 8);
      const targetZ = Math.floor(z / 8);
      message = `To link this portal in the Nether, go to X: ${targetX}, Z: ${targetZ}`;
    } else if (dimension.includes("nether")) {
      const targetX = Math.floor(x * 8);
      const targetZ = Math.floor(z * 8);
      message = `To link this portal in the Overworld, go to X: ${targetX}, Z: ${targetZ}`;
    } else {
      message = "You must be in the Overworld or Nether for this command.";
    }

    await sendToServer(`/msg ${username} ${message}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
