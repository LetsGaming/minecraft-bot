import { defineCommand } from "../defineCommand.js";

const cmd = defineCommand({
  name: "playerhead",
  description: "Get the player head of any Minecraft player",
  args: ["player"],
  cooldown: 15,
  handler: async (username, { player }, client, server) => {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${player}`);
    if (!res.ok) {
      await server.sendCommand(`/msg ${username} Player "${player}" not found.`);
      return;
    }
    await server.sendCommand(`/give ${username} player_head[profile={name:"${player}"}]`);
  },
});
export const { init, COMMAND_INFO } = cmd;
