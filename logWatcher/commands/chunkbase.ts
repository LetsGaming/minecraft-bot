import { defineCommand } from '../defineCommand.js';

const cmd = defineCommand({
  name: 'chunkbase',
  description: 'Get a Chunkbase link for your current location',
  cooldown: 10,
  handler: async (username, _args, _client, server) => {
    const seed = await server.getSeed();
    if (!seed) {
      await server.sendCommand(
        `/msg ${username} Could not retrieve the world seed.`,
      );
      return;
    }

    let dimension = 'overworld';
    try {
      const r = await server.getPlayerData(username, 'Dimension');
      if (r) {
        const m = r.match(/"minecraft:([^"]+)"/);
        if (m?.[1]) dimension = m[1];
      }
    } catch {
      /* default */
    }

    let coordsParam = '';
    try {
      const coords = await server.getPlayerCoords(username);
      if (coords)
        coordsParam = `&x=${Math.floor(coords.x)}&z=${Math.floor(coords.z)}`;
    } catch {
      /* proceed without */
    }

    const url = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

    interface TellRawText {
      text: string;
      color?: string;
      underlined?: boolean;
      click_event?: { action: string; url: string };
    }

    const tellRaw: { text: string; extra: TellRawText[] } = {
      text: '',
      extra: [
        { text: 'See your location on Chunkbase: ', color: 'white' },
        {
          text: '[Click here]',
          color: 'gold',
          underlined: true,
          click_event: { action: 'open_url', url },
        },
      ],
    };
    await server.sendCommand(`/tellraw ${username} ${JSON.stringify(tellRaw)}`);
  },
});

export const { init, COMMAND_INFO } = cmd;
