/**
 * !deathpos — whisper the coordinates of the player's last death.
 *
 * Reads the LastDeathLocation NBT (1.19+) via
 * ServerInstance.getLastDeathLocation, which handles both RCON responses
 * and the screen-fallback log poll. Players who have not died yet (or
 * whose death predates 1.19 world data) get a friendly "no recorded
 * death" message instead of an error.
 *
 * The optional Discord DM on death lives in the deaths watcher and is
 * controlled by config `deathCoords.dmLinked` — this command is always
 * available.
 */
import { defineCommand } from "../../defineCommand.js";
import { t } from "@mcbot/core/utils/i18n.js";

const cmd = defineCommand({
  name: "deathpos",
  aliases: ["lastdeath"],
  description: "Get the coordinates of your last death",
  cooldown: 10,
  handler: async (username, _args, _client, server) => {
    const loc = await server.getLastDeathLocation(username);
    if (!loc) {
      await server.sendCommand(`/msg ${username} ${t("deathpos.none")}`);
      return;
    }

    const msg = t("deathpos.result", {
      x: loc.x,
      y: loc.y,
      z: loc.z,
      dimension: loc.dimension,
    });
    await server.sendCommand(
      `/tellraw ${username} ${JSON.stringify({ text: msg, color: "gold" })}`,
    );
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
