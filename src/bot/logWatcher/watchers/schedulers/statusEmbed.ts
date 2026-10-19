import {
  ChannelType,
  type Client,
  type TextChannel,
  type VoiceChannel,
  type EmbedBuilder,
} from "discord.js";
import { MS } from "@mcbot/schema";
import { tryLoadConfig } from "@mcbot/core/utils/config/configAccess.js";
import { getAllInstances } from "@mcbot/core/utils/server/server.js";
import { getAllowedServerIds } from "../../../utils/guild/guildRouter.js";
import {
  statusChannelsFor,
  updateStatusMessages,
} from "@mcbot/core/utils/stores/statusMessagesStore.js";
import { recordPlayerCountSample } from "@mcbot/core/utils/stores/playerCountHistory.js";
import { parsePlayerCounts } from "@mcbot/core/utils/minecraft/playerCounts.js";
import { log } from "@mcbot/core/utils/logger.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import {
  describeHealth,
  describePlayers,
  stateSeverity,
} from "../../../utils/embeds/serverStateDisplay.js";
import {
  canQueryServer,
  ServerState,
  unknownHealth,
  type ServerHealth,
} from "@mcbot/schema/serverState.js";
import {
  ensureManagedCategory,
  ensureTextChannel,
  ensureVoiceChannel,
  renameVoiceChannelIfChanged,
} from "../../../utils/guild/discordChannel.js";
import type {
  GuildConfig,
  StatusChannelState,
  TpsResult,
} from "@mcbot/core/types/index.js";
import {
  liveGuildConfigs,
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { onServerRemoved } from "../../serverCleanup.js";
import { startPoller, type Poller } from "../poller.js";
import { isChannelGone, isUnknownMessage } from "../discordErrors.js";
import { updateBotPresence, type PlayerCounts } from "./botPresence.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const UPDATE_INTERVAL_MS = MS.minute;
const INITIAL_DELAY_MS = 5 * MS.second;

/**
 * Display names for the bot-managed Discord channels.
 * Voice channels accept unicode/emoji/spaces freely, so the counter channel
 * can use a human-friendly format. The text channel name must be lowercase
 * letters, numbers, and hyphens only (Discord text channel restriction).
 */
const CATEGORY_NAME = "📊 Server Status";
const STATUS_TEXT_CHANNEL_NAME = "server-status";
const buildVoiceChannelName = (online: number, max: number) =>
  `👥 Players: ${online} / ${max}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusBuildResult {
  embed: EmbedBuilder;
  counts: PlayerCounts;
}

interface ServerFieldResult {
  field: { name: string; value: string; inline: boolean };
  counts: PlayerCounts;
  /** Whether the server answered as running this pass. */
  online?: boolean;
  /** The server's state colour; the embed takes the worst one. */
  color: number;
  /** Higher is worse; see `stateSeverity`. */
  severity: number;
}

/**
 * Cached live Discord channel references per guild, so we avoid fetching
 * them from the API on every update cycle.
 */
interface GuildChannelRefs {
  textChannel: TextChannel;
  voiceChannel: VoiceChannel;
  lastCounts: PlayerCounts;
}

// ─── State ────────────────────────────────────────────────────────────────────

const channelRefCache = new Map<string, GuildChannelRefs>();

/** Sentinel that forces the next pass to rename the counter channel. */
const UNSET_COUNTS: PlayerCounts = { online: -1, max: -1 };

// The counter channel sums over servers, so a removed server changes it.
onServerRemoved(() => {
  for (const refs of channelRefCache.values()) refs.lastCounts = UNSET_COUNTS;
});

/**
 * Clear the channel ref cache so the next update cycle re-fetches live
 * channel objects. Call this after a Discord reconnect: stale TextChannel /
 * VoiceChannel objects from before the disconnect can no longer be written to.
 */
export function invalidateStatusChannelCache(): void {
  channelRefCache.clear();
  log.info("status", "Channel ref cache invalidated (reconnect)");
}

// ─── Channel provisioning ─────────────────────────────────────────────────────

/**
 * Ensure the bot's managed category and both child channels exist in the guild.
 *
 * On first run this creates everything from scratch. On subsequent runs it
 * validates the persisted IDs against the live guild channel cache and
 * re-creates anything that was manually deleted.
 */
async function provisionGuildChannels(
  client: Client,
  guildId: string,
): Promise<{
  textChannel: TextChannel;
  voiceChannel: VoiceChannel;
  stored: StatusChannelState;
} | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    log.warn("status", `Guild ${guildId} not in cache, skipping provisioning`);
    return null;
  }

  // Resolve channels from persisted state first to avoid unnecessary API calls
  const stored = statusChannelsFor(guildId);
  if (stored) {
    const textChannel = guild.channels.cache.get(stored.textChannelId);
    const voiceChannel = guild.channels.cache.get(stored.voiceChannelId);
    if (
      textChannel?.type === ChannelType.GuildText &&
      voiceChannel?.type === ChannelType.GuildVoice
    ) {
      return { textChannel, voiceChannel, stored };
    }
    log.info(
      "status",
      `Re-provisioning channels for guild ${guildId} (one or more channels missing)`,
    );
  }

  try {
    const { category } = await ensureManagedCategory(guild, CATEGORY_NAME);

    const { channel: textChannel } = await ensureTextChannel(
      guild,
      category.id,
      STATUS_TEXT_CHANNEL_NAME,
      "Live Minecraft server status (managed by the bot).",
    );

    const { channel: voiceChannel } = await ensureVoiceChannel(
      guild,
      category.id,
      buildVoiceChannelName(0, 0),
    );

    const newState: StatusChannelState = {
      categoryId: category.id,
      textChannelId: textChannel.id,
      messageId: stored?.messageId ?? "",
      voiceChannelId: voiceChannel.id,
    };
    updateStatusMessages((state) => {
      state[guildId] = newState;
    });

    log.info(
      "status",
      `Provisioned status channels for guild ${guildId} ` +
        `(category: ${category.id}, text: ${textChannel.id}, voice: ${voiceChannel.id})`,
    );

    return { textChannel, voiceChannel, stored: newState };
  } catch (err) {
    log.error(
      "status",
      `Failed to provision channels for guild ${guildId}: ${errMsg(err)}`,
    );
    return null;
  }
}

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildTpsLine(tps: TpsResult | null): string {
  if (tps?.tps1m == null) return "";
  return `\nTPS: ${tps.tps1m.toFixed(1)}`;
}

function buildPlayerListLine(players: string[]): string {
  return players.length > 0
    ? `\n${t("statusEmbed.onlineNames", { names: players.join(", ") })}`
    : "";
}

async function buildServerField(
  server: ReturnType<typeof getAllInstances>[number],
  isInline: boolean,
): Promise<ServerFieldResult> {
  let tps: TpsResult | null = null;
  const counts: PlayerCounts = { online: 0, max: 0 };

  // Check health before TPS: running both in parallel on a cold RCON
  // connection can poison the internal _hasTpsCommand cache permanently.
  let health: ServerHealth;
  try {
    health = await server.getHealth();
  } catch (err) {
    health = unknownHealth(errMsg(err));
  }

  const display = describeHealth(health);

  // Anything short of responsive gets its state and nothing else: no player
  // count, no TPS. Reporting "0/20 players" for a server that simply did not
  // answer is a fabricated number, and it read as an empty server.
  if (!canQueryServer(health)) {
    // Counts from a direct ping still count. A server whose wrapper is down
    // is not a blank row: it has players on it.
    if (health.players) {
      counts.online = health.players.online;
      counts.max = health.players.max;
    }
    const players = describePlayers(health);
    return {
      field: {
        name: server.id,
        value:
          `${display.emoji} ${display.label}` +
          (players ? `, ${players}` : "") +
          (display.hint ? `\n${display.hint}` : ""),
        inline: isInline,
      },
      counts,
      online: false,
      color: display.color,
      severity: display.severity,
    };
  }

  try {
    tps = await server.getTps();
  } catch {
    /* TPS unavailable this cycle */
  }

  let statusLine = `${display.emoji} ${display.label}`;

  // Health already carries counts (from the wrapper, or from a direct ping
  // when the wrapper is down). Seed from it so a failed /list degrades to a
  // slightly stale number instead of zero.
  if (health.players) {
    counts.online = health.players.online;
    counts.max = health.players.max;
  }

  const list = await server.getList();
  if (list.ok) {
    const { online, max } = parsePlayerCounts(list.value);
    // A count we cannot read keeps the health figure rather than overwriting it with zero.
    if (online !== null) counts.online = online;
    if (max !== null) counts.max = max;

    statusLine =
      `${display.emoji} ${display.label}, ${t("state.playerCount", { ...counts })}` +
      buildTpsLine(tps) +
      buildPlayerListLine(list.value.players ?? []);
  } else {
    log.debug("status", `${server.id}: /list failed, using health counts`);
    statusLine =
      `${display.emoji} ${display.label}, ${t("state.playerCount", { ...counts })}` +
      buildTpsLine(tps);
  }

  return {
    field: { name: server.id, value: statusLine, inline: isInline },
    counts,
    online: true,
    color: display.color,
    severity: display.severity,
  };
}

/**
 * Query every server once per update pass. Guild embeds are assembled
 * from this shared map so N guilds never means N× server round-trips.
 */
async function buildAllServerFields(): Promise<
  Map<string, ServerFieldResult>
> {
  const instances = getAllInstances();
  const isInline = instances.length <= 3;

  const results = await Promise.allSettled(
    instances.map((s) => buildServerField(s, isInline)),
  );

  const map = new Map<string, ServerFieldResult>();
  results.forEach((result, i) => {
    const instanceId = instances[i]?.id ?? `server-${i + 1}`;
    if (result.status === "fulfilled") {
      const value = result.value;
      map.set(instanceId, value);
      // Feed the player-count history for free: this pass already paid
      // for the query. Never let bookkeeping break the status update.
      if (value.online === true) {
        recordPlayerCountSample(instanceId, value.counts.online).catch(
          () => {},
        );
      }
    } else {
      map.set(instanceId, {
        field: {
          name: instanceId,
          value: t("statusEmbed.fetchFailed"),
          inline: isInline,
        },
        counts: { online: 0, max: 0 },
        online: false,
        color: EmbedColor.Neutral,
        severity: stateSeverity(ServerState.Unknown),
      });
    }
  });
  return map;
}

/**
 * Assemble one guild's status embed from the shared field map.
 * Multi-guild deployments: the embed only shows servers this guild can
 * see. Single-guild setups keep showing every configured server.
 */
function buildStatusEmbed(
  guildId: string,
  fieldMap: Map<string, ServerFieldResult>,
): StatusBuildResult {
  const allowed = getAllowedServerIds(guildId);
  const total: PlayerCounts = { online: 0, max: 0 };
  const entries: ServerFieldResult[] = [];

  for (const [serverId, entry] of fieldMap) {
    if (allowed && !allowed.has(serverId)) continue;
    total.online += entry.counts.online;
    total.max += entry.counts.max;
    entries.push(entry);
  }
  // Servers that need attention first; the bar shows the worst state.
  entries.sort((a, b) => b.severity - a.severity);
  const fields = entries.map((e) => e.field);

  const embed = createEmbed({
    title: t("statusEmbed.title", {}, guildId),
    color: entries[0]?.color ?? EmbedColor.Neutral,
    timestamp: true,
  });

  if (fields.length > 0) {
    embed.addFields(fields);
  } else {
    embed.setDescription(t("statusEmbed.none", {}, guildId));
  }

  return { embed, counts: total };
}

// ─── Per-channel updates ──────────────────────────────────────────────────────

/**
 * Send a new status embed or edit the existing one.
 * Persists the message ID so the same message is edited on every cycle.
 */
export async function sendOrUpdateEmbed(
  textChannel: TextChannel,
  embed: EmbedBuilder,
  guildId: string,
): Promise<void> {
  const messageId = statusChannelsFor(guildId)?.messageId;

  if (messageId) {
    try {
      const msg = await textChannel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch (err) {
      // Only a message that is really gone gets a replacement. A 5xx or a
      // rate limit used to post a new embed every time and leave the old one
      // showing a stale status; a deleted channel is re-provisioned next pass.
      if (isChannelGone(err)) {
        channelRefCache.delete(guildId);
        log.warn("status", `Status channel for guild ${guildId} is gone; it is set up again next cycle`);
        return;
      }
      if (!isUnknownMessage(err)) {
        log.warn("status", `Could not update the status embed for guild ${guildId}: ${errMsg(err)}`);
        return;
      }
      log.info(
        "status",
        `Embed message missing for guild ${guildId}, sending a new one`,
      );
    }
  }

  try {
    const msg = await textChannel.send({ embeds: [embed] });
    updateStatusMessages((state) => {
      const entry = state[guildId];
      if (entry) entry.messageId = msg.id;
    });
    log.info("status", `Sent status embed in guild ${guildId}`);
  } catch (err) {
    if (isChannelGone(err)) channelRefCache.delete(guildId);
    log.error(
      "status",
      `Failed to send embed for guild ${guildId}: ${errMsg(err)}`,
    );
  }
}

/**
 * Update the voice channel name to reflect the current player count.
 * Skips the API call when the count hasn't changed to preserve the
 * Discord rate limit (2 renames per channel per 10 minutes).
 */
async function updatePlayerCountVoiceChannel(
  voiceChannel: VoiceChannel,
  guildId: string,
  counts: PlayerCounts,
  refs: GuildChannelRefs,
): Promise<void> {
  if (
    refs.lastCounts.online === counts.online &&
    refs.lastCounts.max === counts.max
  ) {
    return;
  }

  const newName = buildVoiceChannelName(counts.online, counts.max);

  try {
    const renamed = await renameVoiceChannelIfChanged(voiceChannel, newName);
    if (renamed) {
      refs.lastCounts = counts;
    }
  } catch (err) {
    log.warn(
      "status",
      `Failed to rename voice channel for guild ${guildId}: ${errMsg(err)}`,
    );
  }
}

// ─── Per-guild update ─────────────────────────────────────────────────────────

async function updateGuildStatus(
  client: Client,
  guildId: string,
  { embed, counts }: StatusBuildResult,
): Promise<void> {
  // Use the cached channel references; provision on first call or after eviction
  let refs = channelRefCache.get(guildId);

  if (!refs) {
    const provisioned = await provisionGuildChannels(client, guildId);
    if (!provisioned) return;

    refs = {
      textChannel: provisioned.textChannel,
      voiceChannel: provisioned.voiceChannel,
      lastCounts: UNSET_COUNTS,
    };
    channelRefCache.set(guildId, refs);
  }

  await sendOrUpdateEmbed(refs.textChannel, embed, guildId);
  await updatePlayerCountVoiceChannel(refs.voiceChannel, guildId, counts, refs);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Guild IDs with statusEmbed enabled, read from the given configs. */
function enabledGuildIds(
  guildConfigs: Record<string, GuildConfig>,
): string[] {
  return Object.entries(guildConfigs)
    .filter(([, cfg]) => cfg.statusEmbed?.enabled === true)
    .map(([guildId]) => guildId);
}

/**
 * One status pass: query every server once, update presence, then update
 * each enabled guild's embed + counter channel. Guild enablement is read
 * FRESH from config each pass, so `/config reload` can add or remove
 * statusEmbed guilds without restarting the poller.
 */
async function runStatusPass(
  client: Client,
  guildConfigSource: GuildConfigSource,
): Promise<void> {
  let fieldMap: Map<string, ServerFieldResult>;
  try {
    fieldMap = await buildAllServerFields();
  } catch (err) {
    log.error(
      "status",
      `Failed to build embed: ${errMsg(err)}`,
    );
    return;
  }

  updateBotPresence(client, fieldMap);

  const enabledGuilds = enabledGuildIds(resolveGuildConfigs(guildConfigSource));

  if (enabledGuilds.length === 0) return; // presence-only pass

  // Sequential: each guild gets its own embed (scoped to the servers it can see).
  for (const guildId of enabledGuilds) {
    try {
      await updateGuildStatus(client, guildId, buildStatusEmbed(guildId, fieldMap));
    } catch (err) {
      log.error(
        "status",
        `Update failed for guild ${guildId}: ${errMsg(err)}`,
      );
    }
  }
}

/** The single status-pass poller for this process (presence rides it). */
let statusPoller: Poller | null = null;

function presenceEnabled(): boolean {
  const loaded = tryLoadConfig({ onError: "open" });
  return loaded.ok && loaded.config.presence?.enabled === true;
}

/**
 * Start the status embed updater. Explicit opt-in per guild
 * (`statusEmbed.enabled: true`), safer than a default, since the bot
 * creates channels. For every enabled guild it self-provisions a private
 * "📊 Server Status" category with a `#server-status` text channel (live
 * embed) and a `👥 Players: X / Y` voice channel as a read-only counter;
 * no channel IDs to configure.
 *
 * Presence rides this pass so it never costs extra server round-trips.
 * When BOTH features are off the poller does not start; reconcileStatusEmbed
 * arms (or disarms) it on config reload, so flipping presence or a guild's
 * statusEmbed no longer needs a restart.
 */
export function startStatusEmbed(
  client: Client,
  guildConfigs: GuildConfigSource,
): Poller | null {
  const enabledCount = enabledGuildIds(resolveGuildConfigs(guildConfigs)).length;

  if (enabledCount === 0 && !presenceEnabled()) {
    log.info(
      "status",
      "No guilds have statusEmbed enabled and presence is off, skipping",
    );
    return null;
  }
  if (statusPoller) return statusPoller; // already armed (reload path)

  statusPoller = startPoller(
    "status",
    () => runStatusPass(client, guildConfigs),
    UPDATE_INTERVAL_MS,
    { initialDelayMs: INITIAL_DELAY_MS },
  );

  log.info(
    "status",
    `Status embed active for ${enabledCount} guild(s)`,
  );
  return statusPoller;
}

/**
 * Re-evaluate on config reload whether the status/presence poller should
 * run, and arm or disarm it accordingly. Called by the reconcile path, so
 * "both off → presence on" (and the reverse) applies without a restart.
 */
export function reconcileStatusEmbed(
  client: Client,
  freshConfig: { guilds: Record<string, GuildConfig>; presence?: { enabled?: boolean } },
): void {
  const wanted =
    enabledGuildIds(freshConfig.guilds).length > 0 ||
    freshConfig.presence?.enabled === true;

  if (wanted && !statusPoller) {
    startStatusEmbed(client, liveGuildConfigs);
    log.info("status", "Status/presence poller armed after config reload");
    return;
  }

  if (!wanted && statusPoller) {
    statusPoller.stop();
    statusPoller = null;
    // Presence just turned off: clear the stale activity once.
    updateBotPresence(client, new Map());
    log.info("status", "Status/presence poller stopped after config reload");
  }
}
