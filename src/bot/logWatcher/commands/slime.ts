/**
 * !slime — is the chunk the player is standing in a slime chunk?
 *
 * Sits in the seed-tools family (!seed, !chunkbase, !netherportal): fetch
 * the world seed, read the player's position, run the vanilla slime-chunk
 * formula locally (utils/slimeChunk.ts), answer via tellraw. Slime chunks
 * only exist in the Overworld, so other dimensions get a friendly hint.
 *
 * Screen-fallback servers degrade the same way the other seed tools do:
 * getSeed/getPlayerCoords poll the log, and when nothing comes back the
 * player gets a clear "could not …" message instead of silence.
 */
import { defineCommand } from "../defineCommand.js";
import { isSlimeChunk, blockToChunk } from "../../../common/utils/slimeChunk.js";
import { t } from "../../../common/utils/i18n.js";

const cmd = defineCommand({
  name: "slime",
  description: "Check whether your current chunk is a slime chunk",
  cooldown: 10,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed) {
      await server.sendCommand(`/msg ${username} ${t("slime.noSeed")}`);
      return;
    }

    const dimension = await server.getPlayerDimension(username);
    if (!dimension.includes("overworld")) {
      await server.sendCommand(
        `/msg ${username} ${t("slime.wrongDimension")}`,
      );
      return;
    }

    const coords = await server.getPlayerCoords(username);
    if (!coords) {
      await server.sendCommand(`/msg ${username} ${t("slime.noPosition")}`);
      return;
    }

    const cx = blockToChunk(coords.x);
    const cz = blockToChunk(coords.z);
    const slime = isSlimeChunk(seed, cx, cz);

    const msg = slime
      ? t("slime.yes", { cx, cz })
      : t("slime.no", { cx, cz });
    const tellRaw = { text: msg, color: slime ? "green" : "red" };
    await server.sendCommand(`/tellraw ${username} ${JSON.stringify(tellRaw)}`);
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
