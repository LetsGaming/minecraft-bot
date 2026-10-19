/**
 * Console relay: opt-in live log tail into an admin-only Discord channel.
 *
 * `/console live enable` flips a persisted per-guild+server switch (the
 * console relay store); this watcher buffers every raw log line of a
 * relayed server and flushes batches into the guild's configured
 * `console.channelId`. Batching (one message per FLUSH_INTERVAL_MS, hard
 * byte cap per flush, drop counter beyond the buffer cap) keeps a busy
 * server from flooding the channel or the Discord rate limit.
 */
import { type Client } from "discord.js";
import {
  loadConsoleRelayState,
  setConsoleRelayEnabled,
  type ConsoleRelayState,
} from "@mcbot/core/utils/stores/consoleRelayStore.js";
import type { ILogWatcher } from "../../logWatcher.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { MS } from "@mcbot/schema";
import { liveGuildConfigs } from "../../../utils/guild/guildConfigs.js";
import { onServerRemoved } from "../../serverCleanup.js";
import { guildTargets, sendToGuildChannels } from "../notifyGuilds.js";
import { startPoller, type Poller } from "../poller.js";

const FLUSH_INTERVAL_MS = 3 * MS.second;
/** Discord message budget per flush (codeblock fences + margin < 2000). */
const MAX_FLUSH_CHARS = 1_800;
/** Buffered backlog cap per server; beyond this, lines are counted as dropped. */
const MAX_BUFFER_CHARS = 8_000;
const MAX_LINE_CHARS = 300;

interface ServerBuffer {
  lines: string[];
  chars: number;
  dropped: number;
}

const buffers = new Map<string, ServerBuffer>();
let flushPoller: Poller | null = null;

/**
 * Whether any guild relays any server. Lines are only sanitized and buffered
 * while this is true, so a deployment that never enabled the relay pays
 * nothing per log line. Refreshed on every flush and on `setConsoleRelay`.
 */
let anyRelayEnabled = false;

onServerRemoved((serverId) => {
  buffers.delete(serverId);
});

/** Exposed for tests. */
export function _resetConsoleRelayForTesting(): void {
  buffers.clear();
  flushPoller?.stop();
  flushPoller = null;
  anyRelayEnabled = false;
}

function hasEnabledRelay(state: ConsoleRelayState): boolean {
  return Object.values(state.guilds).some((servers) => Object.keys(servers).length > 0);
}

/** Turn the relay on or off for one guild and server. */
export function setConsoleRelay(guildId: string, serverId: string, enabled: boolean): void {
  setConsoleRelayEnabled(guildId, serverId, enabled);
  anyRelayEnabled = hasEnabledRelay(loadConsoleRelayState());
}

function bufferFor(serverId: string): ServerBuffer {
  let buf = buffers.get(serverId);
  if (!buf) {
    buf = { lines: [], chars: 0, dropped: 0 };
    buffers.set(serverId, buf);
  }
  return buf;
}

/** Codeblock-safe, length-capped copy of a raw log line. */
export function sanitizeLogLine(line: string): string {
  return line
    .replace(/\u001b\[[0-9;]*m/g, "") // ANSI colour codes
    .replace(/```/g, "ˋˋˋ") // keep the fence intact
    .replace(/[\p{Cc}\p{Cf}]/gu, "") // control/format chars
    .slice(0, MAX_LINE_CHARS);
}

async function flush(client: Client): Promise<void> {
  const state = loadConsoleRelayState();
  anyRelayEnabled = hasEnabledRelay(state);

  for (const [serverId, buf] of buffers) {
    if (buf.lines.length === 0 && buf.dropped === 0) continue;

    // Which guilds relay this server right now?
    const pick = (
      gcfg: { console?: { channelId?: string } },
      guildId: string,
    ): { channelId?: string } | undefined =>
      state.guilds[guildId]?.[serverId] ? gcfg.console : undefined;

    if (guildTargets(liveGuildConfigs, pick, serverId).length === 0) {
      // Nobody listening: clear so the buffer can't grow while disabled.
      buf.lines = [];
      buf.chars = 0;
      buf.dropped = 0;
      continue;
    }

    let body = "";
    let used = 0;
    while (buf.lines.length > 0) {
      const line = buf.lines[0]!;
      if (used + line.length + 1 > MAX_FLUSH_CHARS) break;
      body += line + "\n";
      used += line.length + 1;
      buf.lines.shift();
    }
    buf.chars = buf.lines.reduce((sum, l) => sum + l.length + 1, 0);

    const droppedNote =
      buf.dropped > 0
        ? `${t("console.dropped", { count: buf.dropped })}\n`
        : "";
    buf.dropped = 0;
    if (!body && !droppedNote) continue;

    const content = "```" + `\n${droppedNote}${body}` + "```";
    await sendToGuildChannels(client, liveGuildConfigs, {
      pick,
      serverId,
      logTag: "console",
      describe: `Relay send failed for ${serverId}`,
      build: () => ({ content }),
    });
  }
}

/**
 * Register the catch-all line collector for one server's watcher and
 * (once per process) the shared flush poller. The poller never overlaps
 * itself, so a slow Discord send cannot stack flushes.
 */
export function registerConsoleRelay(
  logWatcher: ILogWatcher,
  client: Client,
  serverId: string,
): void {
  anyRelayEnabled = hasEnabledRelay(loadConsoleRelayState());

  logWatcher.register(/.+/, (match) => {
    if (!anyRelayEnabled) return;
    const buf = bufferFor(serverId);
    const line = sanitizeLogLine(match[0] ?? "");
    if (!line) return;
    if (buf.chars + line.length + 1 > MAX_BUFFER_CHARS) {
      buf.dropped += 1;
      return;
    }
    buf.lines.push(line);
    buf.chars += line.length + 1;
  });

  flushPoller ??= startPoller("console", () => flush(client), FLUSH_INTERVAL_MS);
}
