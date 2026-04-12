import { defineCommand } from "../defineCommand.js";
import { sendToServer } from "../../utils/server.js";

const cmd = defineCommand({
  name: "playerhead",
  description: "Get the player head of any Minecraft player",
  args: ["player"],
  handler: async (username, { player }) => {
    // Validate the player exists via Mojang API
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${player}`
    );
    if (!res.ok) {
      await sendToServer(`/msg ${username} Player "${player}" not found.`);
      return; // ← Fixed: was missing, proceeded to give head even on error
    }

    await sendToServer(
      `/give ${username} player_head[profile={name:"${player}"}]`
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
