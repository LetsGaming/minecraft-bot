import { defineCommand } from "../defineCommand.js";

const cmd = defineCommand({
  name: "seed",
  description: "Get the world seed",
  args: [],
  cooldown: 30,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed) {
      await server.sendCommand(
        `/msg ${username} Could not retrieve the world seed.`,
      );
      return;
    }
    await server.sendCommand(`/msg ${username} World seed: ${seed}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
