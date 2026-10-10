import { defineCommand } from "../../defineCommand.js";
import { whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { queryFailureText } from "../../queryMessages.js";

const cmd = defineCommand({
  name: "seed",
  description: "Get the world seed",
  args: [],
  cooldown: 30,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed.ok) {
      await whisper(
        server,
        username,
        queryFailureText(seed.reason, "seed.unavailable"),
      );
      return;
    }
    await whisper(server, username, `World seed: ${seed.value}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
