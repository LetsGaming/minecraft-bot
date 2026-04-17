import { type Client } from 'discord.js';
import { log } from '../../utils/logger.js';
import { loadConfig } from '../../config.js';
import { createEmbed } from '../../utils/embedUtils.js';
import type { ServerInstance } from '../../utils/server.js';
import type { GuildConfig } from '../../types/index.js';

const warned = new Map<string, number>();

export function startTpsMonitor(
  serverInstance: ServerInstance,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | null {
  const cfg = loadConfig();
  const interval = cfg.tpsPollIntervalMs;
  const threshold = cfg.tpsWarningThreshold;

  if (!serverInstance.useRcon) {
    log.info(serverInstance.id, 'TPS monitoring skipped (requires RCON)');
    return null;
  }

  const timer = setInterval(async () => {
    try {
      const tps = await serverInstance.getTps();
      if (!tps || tps.tps1m === null) return;

      if (tps.tps1m < threshold) {
        const lastWarn = warned.get(serverInstance.id) ?? 0;
        if (Date.now() - lastWarn < 300000) return;
        warned.set(serverInstance.id, Date.now());

        for (const [, gcfg] of Object.entries(guildConfigs)) {
          const tpsAlert = gcfg.tpsAlerts;
          if (!tpsAlert?.channelId) continue;
          if (tpsAlert.server && tpsAlert.server !== serverInstance.id)
            continue;

          try {
            const channel = await client.channels.fetch(tpsAlert.channelId);
            if (!channel || !('send' in channel)) continue;

            const embed = createEmbed({
              title: '⚠️ Low TPS Warning',
              description: `Server TPS has dropped below ${threshold}`,
              color: tps.tps1m < 10 ? 0xff0000 : 0xffaa00,
              footer: { text: serverInstance.id },
            });

            if ('tps5m' in tps && tps.tps5m !== undefined) {
              const paperTps = tps as import('../../types/index.js').PaperTpsResult;
              embed.addFields(
                {
                  name: '1 min',
                  value: `${paperTps.tps1m.toFixed(1)}`,
                  inline: true,
                },
                {
                  name: '5 min',
                  value: `${paperTps.tps5m.toFixed(1)}`,
                  inline: true,
                },
                {
                  name: '15 min',
                  value: `${paperTps.tps15m.toFixed(1)}`,
                  inline: true,
                },
              );
            } else {
              embed.addFields({
                name: 'TPS',
                value: `${tps.tps1m.toFixed(1)}`,
                inline: true,
              });
              if ('mspt' in tps && tps.mspt !== undefined) {
                embed.addFields({
                  name: 'MSPT',
                  value: `${tps.mspt.toFixed(1)}ms`,
                  inline: true,
                });
              }
            }

            await channel.send({ embeds: [embed] });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('tps', `Alert failed: ${msg}`);
          }
        }
      }
    } catch {
      /* server might be down */
    }
  }, interval);

  log.info(
    serverInstance.id,
    `TPS monitoring active (threshold: ${threshold}, interval: ${interval / 1000}s)`,
  );
  return timer;
}
