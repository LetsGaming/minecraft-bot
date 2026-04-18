import { defineCommand } from "../defineCommand.js";

const cmd = defineCommand({
  name: "netherportal",
  description:
    "Get coordinates to link a Nether portal from your current location",
  cooldown: 5,
  handler: async (username, _args, _client, server) => {
    let coords;
    let dimension = "overworld";
    try {
      coords = await server.getPlayerCoords(username);
      const r = await server.getPlayerData(username, "Dimension");
      if (r) {
        const m = r.match(/"minecraft:([^"]+)"/);
        if (m?.[1]) dimension = m[1];
      }
    } catch {
      await server.sendCommand(`/msg ${username} Could not get your position.`);
      return;
    }
    if (!coords) {
      await server.sendCommand(`/msg ${username} Could not get your position.`);
      return;
    }

    const { x, z } = coords;
    let msg: string;
    if (dimension.includes("overworld")) {
      msg = `Nether coords: X: ${Math.floor(x / 8)}, Z: ${Math.floor(z / 8)}`;
    } else if (dimension.includes("nether")) {
      msg = `Overworld coords: X: ${Math.floor(x * 8)}, Z: ${Math.floor(z * 8)}`;
    } else {
      msg = "You must be in the Overworld or Nether.";
    }
    await server.sendCommand(`/msg ${username} ${msg}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
