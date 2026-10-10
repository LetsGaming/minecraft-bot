import { defineCommand } from "../../defineCommand.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { fetchMojangProfile } from "@mcbot/core/utils/minecraft/mojang.js";
import { whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";

const cmd = defineCommand({
  name: "playerhead",
  description: "Get the player head of any Minecraft player",
  args: ["player"],
  cooldown: 15,
  handler: async (username, { player }, _client, server) => {
    if (!player) return;
    // Validate before the name reaches a console command or URL.
    if (!isValidMcName(player)) {
      await whisper(server, username, `"${player}" is not a valid username.`);
      return;
    }
    const profile = await fetchMojangProfile(player);
    if (!profile) {
      await whisper(server, username, `Player "${player}" not found.`);
      return;
    }
    // Use the canonical capitalization Mojang returns.
    await server.send(
      `/give ${username} player_head[profile={name:"${profile.name}"}]`,
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
