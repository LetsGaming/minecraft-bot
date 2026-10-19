import { defineCommand } from "../../defineCommand.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { fetchMojangProfile } from "@mcbot/core/utils/minecraft/mojang.js";
import { consoleCommand, whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { t } from "@mcbot/core/utils/i18n.js";

const cmd = defineCommand({
  name: "playerhead",
  description: "Get the player head of any Minecraft player",
  args: ["player"],
  cooldown: 15,
  handler: async (username, { player }, _client, server) => {
    if (!player) return;
    // Validate before the name reaches a console command or URL.
    if (!isValidMcName(player)) {
      await whisper(server, username, t("ingame.playerhead.invalidName", { player }));
      return;
    }
    const profile = await fetchMojangProfile(player);
    if (!profile) {
      await whisper(server, username, t("ingame.playerhead.notFound", { player }));
      return;
    }
    // Use the canonical capitalization Mojang returns.
    const name = profile.name && isValidMcName(profile.name) ? profile.name : player;
    await server.send(
      consoleCommand("/give", { player: username }, { item: `player_head[profile={name:"${name}"}]` }),
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
