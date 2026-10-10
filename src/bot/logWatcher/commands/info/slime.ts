/**
 * !slime: is the chunk the player is standing in a slime chunk?
 *
 * Sits in the seed-tools family (!seed, !chunkbase, !netherportal): fetch
 * the world seed, read the player's position, run the vanilla slime-chunk
 * formula locally (utils/slimeChunk.ts), answer via tellraw. Slime chunks
 * only exist in the Overworld, so other dimensions get a friendly hint.
 *
 * getSeed and getPlayerCoords read the RCON reply and fall back to polling
 * the server log when the wrapper has no response channel. When neither
 * yields a value, or the server cannot be reached, the player gets a clear
 * "could not ..." message instead of silence.
 */
import { defineCommand } from "../../defineCommand.js";
import { isSlimeChunk, blockToChunk } from "@mcbot/core/utils/minecraft/slimeChunk.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { tellraw, whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { queryFailureText } from "../../queryMessages.js";

const cmd = defineCommand({
  name: "slime",
  description: "Check whether your current chunk is a slime chunk",
  cooldown: 10,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed.ok) {
      await whisper(
        server,
        username,
        queryFailureText(seed.reason, "slime.noSeed"),
      );
      return;
    }

    const dimension = await server.getPlayerDimension(username);
    if (!dimension.ok) {
      await whisper(
        server,
        username,
        queryFailureText(dimension.reason, "query.noDimension"),
      );
      return;
    }
    if (!dimension.value.includes("overworld")) {
      await whisper(server, username, t("slime.wrongDimension"));
      return;
    }

    const coords = await server.getPlayerCoords(username);
    if (!coords.ok) {
      await whisper(
        server,
        username,
        queryFailureText(coords.reason, "slime.noPosition"),
      );
      return;
    }

    const cx = blockToChunk(coords.value.x);
    const cz = blockToChunk(coords.value.z);
    const slime = isSlimeChunk(seed.value, cx, cz);

    const msg = slime
      ? t("slime.yes", { cx, cz })
      : t("slime.no", { cx, cz });
    await tellraw(server, username, {
      text: msg,
      color: slime ? "green" : "red",
    });
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
