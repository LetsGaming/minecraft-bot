import { defineCommand } from "../defineCommand.js";
import { isValidMcName } from "../../../common/utils/sanitize.js";
import type { MojangProfile } from "../../../common/types/index.js";

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
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(player)}`,
    );
    if (!res.ok) {
      await server.sendCommand(
        `/msg ${username} Player "${player}" not found.`,
      );
      return;
    }
    // Use the canonical capitalization Mojang returns.
    const profile = (await res.json()) as MojangProfile;
    await server.sendCommand(
      `/give ${username} player_head[profile={name:"${profile.name ?? player}"}]`,
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
