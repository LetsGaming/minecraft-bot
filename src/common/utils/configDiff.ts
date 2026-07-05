/**
 * Compact config-change summary for reloads.
 *
 * reconcileServers already reports added/removed/changed SERVER ids;
 * everything else — guild blocks, feature blocks, top-level settings —
 * used to change invisibly on `/config reload`. This module diffs the
 * previous and fresh config at that layer and answers with lines like
 *
 *   guild 1111…: chatBridge added, notifications.server changed
 *   language: en → de
 *
 * Deliberately shallow-per-feature: a guild's feature block is reported
 * as one unit ("leaderboard changed"), except for scalar values where the
 * old → new transition fits on the line. Servers are excluded here —
 * the reconciler owns that report.
 */

import type { GuildConfig } from "../types/index.js";

/** Top-level keys worth reporting (servers excluded — reconciler's job). */
const TOP_LEVEL_KEYS = [
  "language",
  "adminUsers",
  "commands",
  "leaderboard",
  "leaderboardInterval",
  "tpsWarningThreshold",
  "tpsPollIntervalMs",
  "presence",
  "deathCoords",
  "hostAlerts",
] as const;

function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function stable(v: unknown): string {
  return JSON.stringify(v) ?? "undefined";
}

/** Short form of a guild ID for display (full IDs bloat the embed). */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 6)}…${id.slice(-2)}` : id;
}

/** Diff two plain objects key-by-key into "x added/removed/changed" parts. */
function diffKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    const b = before[key];
    const a = after[key];
    if (stable(b) === stable(a)) continue;
    if (b === undefined) parts.push(`${key} added`);
    else if (a === undefined) parts.push(`${key} removed`);
    else if (isScalar(b) && isScalar(a)) parts.push(`${key}: ${b} → ${a}`);
    else parts.push(`${key} changed`);
  }
  return parts;
}

export interface ConfigLike {
  guilds?: Record<string, GuildConfig>;
}

/**
 * Summarize what changed between two loaded configs, excluding the
 * servers block. Returns [] when nothing (reportable) changed.
 */
export function summarizeConfigChanges(
  before: ConfigLike,
  after: ConfigLike,
): string[] {
  const lines: string[] = [];

  // ── Top level ──
  const beforeTop: Record<string, unknown> = {};
  const afterTop: Record<string, unknown> = {};
  const beforeRec = before as unknown as Record<string, unknown>;
  const afterRec = after as unknown as Record<string, unknown>;
  for (const key of TOP_LEVEL_KEYS) {
    if (beforeRec[key] !== undefined) beforeTop[key] = beforeRec[key];
    if (afterRec[key] !== undefined) afterTop[key] = afterRec[key];
  }
  lines.push(...diffKeys(beforeTop, afterTop));

  // ── Guilds ──
  const beforeGuilds = before.guilds ?? {};
  const afterGuilds = after.guilds ?? {};
  const guildIds = new Set([
    ...Object.keys(beforeGuilds),
    ...Object.keys(afterGuilds),
  ]);
  for (const gid of [...guildIds].sort()) {
    const b = beforeGuilds[gid];
    const a = afterGuilds[gid];
    if (!b && a) {
      lines.push(`guild ${shortId(gid)}: added`);
      continue;
    }
    if (b && !a) {
      lines.push(`guild ${shortId(gid)}: removed`);
      continue;
    }
    if (!b || !a) continue;
    const parts = diffKeys(
      b as unknown as Record<string, unknown>,
      a as unknown as Record<string, unknown>,
    );
    if (parts.length > 0) lines.push(`guild ${shortId(gid)}: ${parts.join(", ")}`);
  }

  return lines;
}
