import { defineCommand } from "../../defineCommand.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { fetchMojangProfile } from "@mcbot/core/utils/minecraft/mojang.js";

const cmd = defineCommand({
  name: "playerhead",
  description: "Get the player head of any Minecraft player",
  args: ["player"],
  cooldown: 15,
  handler: async (username, { player }, _client, server) => {
    if (!player) return;
    // Validate before the name reaches a console command or URL.
    if (!isValidMcName(player)) {
      await server.sendCommand(
        `/msg ${username} "${player}" is not a valid username.`,
      );
      return;
    }
    const profile = await fetchMojangProfile(player);
    if (!profile) {
      await server.sendCommand(
        `/msg ${username} Player "${player}" not found.`,
      );
      return;
    }
    // Use the canonical capitalization Mojang returns.
    await server.sendCommand(
      `/give ${username} player_head[profile={name:"${profile.name}"}]`,
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
