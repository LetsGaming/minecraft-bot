import { defineCommand } from '../defineCommand.js';
import type { MojangProfile } from '../../types/index.js';

const cmd = defineCommand({
  name: 'playerhead',
  description: 'Get the player head of any Minecraft player',
  args: ['player'],
  cooldown: 15,
  handler: async (username, { player }, _client, server) => {
    if (!player) return;
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${player}`,
    );
    if (!res.ok) {
      await server.sendCommand(
        `/msg ${username} Player "${player}" not found.`,
      );
      return;
    }
    // Consume the response body to validate it, even though we only need to confirm existence
    await res.json() as MojangProfile;
    await server.sendCommand(
      `/give ${username} player_head[profile={name:"${player}"}]`,
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
