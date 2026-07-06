import {
  ActivityType,
  type Client,
  type TextChannel,
  type VoiceChannel,
  type EmbedBuilder,
} from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import { getAllInstances } from "@mcbot/core/utils/server.js";
import { getAllowedServerIds } from "../../utils/guildRouter.js";
import { kvGet, kvSet } from "@mcbot/core/db/kv.js";
import { recordPlayerCountSample } from "@mcbot/core/utils/playerCountHistory.js";
import { log } from "@mcbot/core/utils/logger.js";
import { createEmbed } from "../../utils/embedUtils.js";
import {
  ensureManagedCategory,
  ensureTextChannel,
  ensureVoiceChannel,
  renameVoiceChannelIfChanged,
} from "../../utils/discordChannel.js";
import type {
  GuildConfig,
  StatusChannelState,
  StatusMessageState,
  TpsResult,
} from "@mcbot/core/types/index.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const UPDATE_INTERVAL_MS = 60 * 1_000;
const INITIAL_DELAY_MS = 5_000;

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

interface PlayerCounts {
  online: number;
  max: number;
}

interface StatusBuildResult {
  embed: EmbedBuilder;
  counts: PlayerCounts;
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

/**
 * Clear the channel ref cache so the next update cycle re-fetches live
 * channel objects. Call this after a Discord reconnect — stale TextChannel /
 * VoiceChannel objects from before the disconnect can no longer be written to.
 */
export function invalidateStatusChannelCache(): void {
  channelRefCache.clear();
  log.info("status", "Channel ref cache invalidated (reconnect)");
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadState(): Promise<StatusMessageState> {
  return kvGet<StatusMessageState>("statusMessages") ?? {};
}

async function saveState(state: StatusMessageState): Promise<void> {
  kvSet("statusMessages", state);
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
  state: StatusMessageState,
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
  const stored = state[guildId];
  if (stored) {
    const textChannel = guild.channels.cache.get(stored.textChannelId) as
      | TextChannel
      | undefined;
    const voiceChannel = guild.channels.cache.get(stored.voiceChannelId) as
      | VoiceChannel
      | undefined;
    if (textChannel && voiceChannel) {
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
      "Live Minecraft server status — managed by the bot.",
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
    state[guildId] = newState;
    await saveState(state);

    log.info(
      "status",
      `Provisioned status channels for guild ${guildId} ` +
        `(category: ${category.id}, text: ${textChannel.id}, voice: ${voiceChannel.id})`,
    );

    return { textChannel, voiceChannel, stored: newState };
  } catch (err) {
    log.error(
      "status",
      `Failed to provision channels for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildTpsLine(tps: TpsResult | null): string {
  if (tps?.tps1m == null) return "";
  const emoji = tps.tps1m >= 18 ? "🟢" : tps.tps1m >= 15 ? "🟡" : "🔴";
  return `\nTPS: ${emoji} ${tps.tps1m.toFixed(1)}`;
}

function buildPlayerListLine(players: string[]): string {
  return players.length > 0 ? `\nOnline: ${players.join(", ")}` : "";
}

async function buildServerField(
  server: ReturnType<typeof getAllInstances>[number],
  isInline: boolean,
): Promise<{
  field: { name: string; value: string; inline: boolean };
  counts: PlayerCounts;
  online: boolean;
}> {
  let isOnline = false;
  let tps: TpsResult | null = null;
  const counts: PlayerCounts = { online: 0, max: 0 };

  // Check online status before TPS — running both in parallel on a cold RCON
  // connection can poison the internal _hasTpsCommand cache permanently.
  try {
    isOnline = await server.isRunning();
  } catch {
    /* treat as offline */
  }

  if (isOnline && server.supportsTps) {
    try {
      tps = await server.getTps();
    } catch {
      /* TPS unavailable this cycle */
    }
  }

  if (!isOnline) {
    return {
      field: { name: server.id, value: "🔴 Offline", inline: isInline },
      counts,
      online: false,
    };
  }

  let statusLine = "🟢 Online";

  try {
    const list = await server.getList();
    counts.online = parseInt(String(list.playerCount), 10) || 0;
    counts.max = parseInt(String(list.maxPlayers), 10) || 0;
    const players: string[] = list.players ?? [];

    statusLine =
      `🟢 Online — ${counts.online}/${counts.max} players` +
      buildTpsLine(tps) +
      buildPlayerListLine(players);
  } catch {
    statusLine += buildTpsLine(tps);
  }

  return {
    field: { name: server.id, value: statusLine, inline: isInline },
    counts,
    online: true,
  };
}

interface ServerFieldResult {
  field: { name: string; value: string; inline: boolean };
  counts: PlayerCounts;
  /** Whether the server answered as running this pass. */
  online?: boolean;
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
      map.set(instanceId, result.value as ServerFieldResult);
      // Feed the player-count history for free — this pass already paid
      // for the query. Never let bookkeeping break the status update.
      const value = result.value as ServerFieldResult;
      if (value.online === true) {
        recordPlayerCountSample(instanceId, value.counts.online).catch(
          () => {},
        );
      }
    } else {
      map.set(instanceId, {
        field: {
          name: instanceId,
          value: "⚠️ Error fetching status",
          inline: isInline,
        },
        counts: { online: 0, max: 0 },
        online: false,
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
  const fields: ServerFieldResult["field"][] = [];

  for (const [serverId, entry] of fieldMap) {
    if (allowed && !allowed.has(serverId)) continue;
    total.online += entry.counts.online;
    total.max += entry.counts.max;
    fields.push(entry.field);
  }

  const embed = createEmbed({
    title: "📊 Server Status",
    color: 0x00bfff,
    footer: { text: "Updates every 60s" },
  });

  if (fields.length > 0) {
    embed.addFields(fields);
  } else {
    embed.setDescription("No servers configured.");
  }

  return { embed, counts: total };
}

// ─── Per-channel updates ──────────────────────────────────────────────────────

/**
 * Send a new status embed or edit the existing pinned one.
 * Persists the message ID so the same message is edited on every cycle.
 */
async function sendOrUpdateEmbed(
  textChannel: TextChannel,
  embed: EmbedBuilder,
  guildId: string,
  state: StatusMessageState,
): Promise<void> {
  const stored = state[guildId];
  const messageId = stored?.messageId;

  if (messageId) {
    try {
      const msg = await textChannel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      log.info(
        "status",
        `Embed message missing for guild ${guildId}, sending a new one`,
      );
    }
  }

  try {
    const msg = await textChannel.send({ embeds: [embed] });
    if (stored) {
      stored.messageId = msg.id;
      await saveState(state);
    }
    log.info("status", `Sent status embed in guild ${guildId}`);
  } catch (err) {
    log.error(
      "status",
      `Failed to send embed for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
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
      `Failed to rename voice channel for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Per-guild update ─────────────────────────────────────────────────────────

async function updateGuildStatus(
  client: Client,
  guildId: string,
  state: StatusMessageState,
  { embed, counts }: StatusBuildResult,
): Promise<void> {
  // Use the cached channel references; provision on first call or after eviction
  let refs = channelRefCache.get(guildId);

  if (!refs) {
    const provisioned = await provisionGuildChannels(client, guildId, state);
    if (!provisioned) return;

    refs = {
      textChannel: provisioned.textChannel,
      voiceChannel: provisioned.voiceChannel,
      lastCounts: { online: -1, max: -1 }, // sentinel forces the first rename
    };
    channelRefCache.set(guildId, refs);
  }

  await sendOrUpdateEmbed(refs.textChannel, embed, guildId, state);
  await updatePlayerCountVoiceChannel(refs.voiceChannel, guildId, counts, refs);
}

// ─── Bot presence ─────────────────────────────────────────────────────────────

let presenceWasSet = false;

/**
 * Bot presence with player count — "Playing 7 online @ SMP" in the member
 * list, without opening a channel. Rides the status pass's shared field
 * map, so presence never costs extra server round-trips.
 *
 * A multi-tenant process serves all guilds with a single presence, so
 * with no `presence.server` configured the counts aggregate across every
 * instance ("{server}" then reads "N servers"). Config is read fresh each
 * pass, so /config reload toggles it live; presence updates at the status
 * cadence (60s) stay well under Discord's limits.
 */
export function updateBotPresence(
  client: Client,
  fieldMap: Map<string, ServerFieldResult>,
): void {
  let cfg: ReturnType<typeof loadConfig>["presence"];
  try {
    cfg = loadConfig().presence;
  } catch {
    return; // presence is additive — never break the status pass
  }
  if (!client.user) return;

  if (!cfg?.enabled) {
    // Toggled off at runtime: clear the stale activity once.
    if (presenceWasSet) {
      try {
        client.user.setPresence({ activities: [] });
      } catch {
        /* best-effort */
      }
      presenceWasSet = false;
    }
    return;
  }

  let online = 0;
  let max = 0;
  let serverLabel: string;
  let isDown = false;

  if (cfg.server) {
    const entry = fieldMap.get(cfg.server);
    if (!entry) return; // unknown server — config validation already warned
    online = entry.counts.online;
    max = entry.counts.max;
    serverLabel = cfg.server;
    isDown = entry.online === false;
  } else {
    for (const e of fieldMap.values()) {
      online += e.counts.online;
      max += e.counts.max;
    }
    serverLabel =
      fieldMap.size === 1
        ? ([...fieldMap.keys()][0] ?? "server")
        : `${fieldMap.size} servers`;
    // Aggregate mode is only "down" when EVERY instance is down —
    // "0 online" with one server up is truthful, "0 online" with the
    // whole fleet unreachable is not.
    isDown =
      fieldMap.size > 0 &&
      [...fieldMap.values()].every((e) => e.online === false);
  }

  // Down state: say so instead of pretending 0 players are online, and
  // switch to idle so the member list reflects it at a glance.
  const format = isDown
    ? (cfg.downFormat ?? "⛔ {server} offline")
    : (cfg.format ?? "{online} online @ {server}");
  const name = format
    .replaceAll("{online}", String(online))
    .replaceAll("{max}", String(max))
    .replaceAll("{server}", serverLabel);

  try {
    client.user.setPresence({
      activities: [{ name, type: ActivityType.Playing }],
      status: isDown ? "idle" : "online",
    });
    presenceWasSet = true;
  } catch (err) {
    log.warn(
      "presence",
      `Failed to set presence: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
 * statusEmbed guilds without restarting the timer.
 */
async function runStatusPass(
  client: Client,
  fallbackGuildConfigs: Record<string, GuildConfig>,
): Promise<void> {
  let fieldMap: Map<string, ServerFieldResult>;
  try {
    fieldMap = await buildAllServerFields();
  } catch (err) {
    log.error(
      "status",
      `Failed to build embed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  updateBotPresence(client, fieldMap);

  let guildConfigs = fallbackGuildConfigs;
  try {
    guildConfigs = loadConfig().guilds;
  } catch {
    /* keep the configs the timer was started with */
  }
  const enabledGuilds = enabledGuildIds(guildConfigs);

  if (enabledGuilds.length === 0) return; // presence-only pass

  let state: StatusMessageState;
  try {
    state = await loadState();
  } catch (err) {
    log.error(
      "status",
      `Failed to load state: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Sequential: avoids concurrent writes to shared in-memory state.
  // Each guild gets its own embed (scoped to the servers it can see).
  for (const guildId of enabledGuilds) {
    try {
      const statusResult = buildStatusEmbed(guildId, fieldMap);
      await updateGuildStatus(client, guildId, state, statusResult);
    } catch (err) {
      log.error(
        "status",
        `Update failed for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** The single status-pass timer for this process (presence rides it). */
let statusTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the status embed updater. Explicit opt-in per guild
 * (`statusEmbed.enabled: true`) — safer than a default, since the bot
 * creates channels. For every enabled guild it self-provisions a private
 * "📊 Server Status" category with a `#server-status` text channel (live
 * embed) and a `👥 Players: X / Y` voice channel as a read-only counter;
 * no channel IDs to configure.
 *
 * Presence rides this pass so it never costs extra server round-trips.
 * When BOTH features are off the timer does not start; reconcileStatusEmbed
 * arms (or disarms) it on config reload, so flipping presence or a guild's
 * statusEmbed no longer needs a restart.
 */
export function startStatusEmbed(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | null {
  const enabledCount = enabledGuildIds(guildConfigs).length;

  if (enabledCount === 0 && loadConfig().presence?.enabled !== true) {
    log.info(
      "status",
      "No guilds have statusEmbed enabled and presence is off, skipping",
    );
    return null;
  }
  if (statusTimer) return statusTimer; // already armed (reload path)

  const update = (): void => {
    void runStatusPass(client, guildConfigs);
  };

  setTimeout(update, INITIAL_DELAY_MS);
  statusTimer = setInterval(update, UPDATE_INTERVAL_MS);

  log.info(
    "status",
    `Status embed active for ${enabledCount} guild(s)`,
  );
  return statusTimer;
}

/**
 * Re-evaluate on config reload whether the status/presence timer should
 * run, and arm or disarm it accordingly. Called by the reconcile path, so
 * "both off → presence on" (and the reverse) applies without a restart —
 * the follow-up the features batch deliberately cut from v1.
 */
export function reconcileStatusEmbed(
  client: Client,
  freshConfig: { guilds: Record<string, GuildConfig>; presence?: { enabled?: boolean } },
): void {
  const wanted =
    enabledGuildIds(freshConfig.guilds).length > 0 ||
    freshConfig.presence?.enabled === true;

  if (wanted && !statusTimer) {
    startStatusEmbed(client, freshConfig.guilds);
    log.info("status", "Status/presence timer armed after config reload");
    return;
  }

  if (!wanted && statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
    // Presence just turned off — clear the stale activity once.
    updateBotPresence(client, new Map());
    log.info("status", "Status/presence timer stopped after config reload");
  }
}
