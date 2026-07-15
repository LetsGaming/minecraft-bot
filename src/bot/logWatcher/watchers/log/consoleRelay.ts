/**
 * Console relay — opt-in live log tail into an admin-only Discord channel.
 *
 * `/console live enable` flips a persisted per-guild+server switch
 * (data/consoleRelay.json); this watcher buffers every raw log line of a
 * relayed server and flushes batches into the guild's configured
 * `console.channelId`. Batching (one message per FLUSH_INTERVAL_MS, hard
 * byte cap per flush, drop counter beyond the buffer cap) keeps a busy
 * server from flooding the channel or the Discord rate limit — the
 * roadmap's stated condition for the live variant.
 */
import { type Client } from "discord.js";
import { kvGet, kvSet } from "@mcbot/core/db/kv.js";
import { loadConfig } from "@mcbot/core/config.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ILogWatcher } from "../../logWatcher.js";

const FLUSH_INTERVAL_MS = 3_000;
/** Discord message budget per flush (codeblock fences + margin < 2000). */
const MAX_FLUSH_CHARS = 1_800;
/** Buffered backlog cap per server; beyond this, lines are counted as dropped. */
const MAX_BUFFER_CHARS = 8_000;
const MAX_LINE_CHARS = 300;

export interface ConsoleRelayState {
  /** guildId → serverId → enabled */
  guilds: Record<string, Record<string, boolean>>;
}

export async function loadConsoleRelayState(): Promise<ConsoleRelayState> {
  const raw = kvGet<Partial<ConsoleRelayState>>("consoleRelay");
  return { guilds: raw?.guilds ?? {} };
}

export async function saveConsoleRelayState(
  state: ConsoleRelayState,
): Promise<void> {
  kvSet("consoleRelay", state);
}

/** Flip the relay for one guild+server; returns the new value. */
export async function setConsoleRelay(
  guildId: string,
  serverId: string,
  enabled: boolean,
): Promise<void> {
  const state = await loadConsoleRelayState();
  const guild = (state.guilds[guildId] ??= {});
  if (enabled) guild[serverId] = true;
  else delete guild[serverId];
  await saveConsoleRelayState(state);
}

interface ServerBuffer {
  lines: string[];
  chars: number;
  dropped: number;
}

const buffers = new Map<string, ServerBuffer>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Exposed for tests. */
export function _resetConsoleRelayForTesting(): void {
  buffers.clear();
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
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
  let state: ConsoleRelayState;
  try {
    state = await loadConsoleRelayState();
  } catch {
    return;
  }
  const guilds = loadConfig().guilds;

  for (const [serverId, buf] of buffers) {
    if (buf.lines.length === 0 && buf.dropped === 0) continue;

    // Which guilds relay this server right now?
    const targets: string[] = [];
    for (const [guildId, servers] of Object.entries(state.guilds)) {
      if (!servers[serverId]) continue;
      const channelId = guilds[guildId]?.console?.channelId;
      if (channelId) targets.push(channelId);
    }
    if (targets.length === 0) {
      // Nobody listening — clear so the buffer can't grow while disabled.
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
      buf.dropped > 0 ? `… ${buf.dropped} line(s) dropped (busy server)\n` : "";
    buf.dropped = 0;
    if (!body && !droppedNote) continue;

    const content = "```" + `\n${droppedNote}${body}` + "```";
    for (const channelId of targets) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !("send" in channel)) continue;
        await channel.send({ content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("console", `Relay send failed for ${serverId}: ${msg}`);
      }
    }
  }
}

/**
 * Register the catch-all line collector for one server's watcher and
 * (once per process) the shared flush timer.
 */
export function registerConsoleRelay(
  logWatcher: ILogWatcher,
  client: Client,
  serverId: string,
): void {
  logWatcher.register(/.+/, async (match) => {
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

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      flush(client).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("console", `Relay flush failed: ${msg}`);
      });
    }, FLUSH_INTERVAL_MS);
  }
}
