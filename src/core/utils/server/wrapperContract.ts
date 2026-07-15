/**
 * What this bot expects of a remote instance's API wrapper, and the
 * startup report that says where the two disagree.
 *
 * The problem this solves: every wrapper call degrades on its own — a 404
 * on `/usercache` quietly becomes "no usercache names", a 404 on
 * `/capabilities` quietly becomes "assume everything works". Individually
 * that is the right behaviour; collectively it means an outdated wrapper
 * and a healthy one look identical, and the only signal was one semver
 * compare that could not say *which* feature was missing.
 *
 * The wrapper publishes `GET /manifest` (generated from its router, so it
 * cannot claim a route it does not serve). This module compares that
 * against the table below and reports both directions: features the bot
 * wants and the wrapper lacks, and features the wrapper offers that this
 * bot is too old to use. The second direction had no mechanism at all
 * before, so "the wrapper is ahead" was invisible.
 *
 * Wrappers older than the manifest fall back to MIN_WRAPPER_VERSION.
 */
import { log } from "../logger.js";
import { isRecord } from "../objects.js";

/**
 * The oldest wrapper this bot can use, for the pre-manifest fallback only.
 *
 * 3.0.0 is the release that added `/info` (the version handshake itself),
 * `/usercache`, and the capabilities contract — the endpoints this bot
 * treats as its baseline. Nothing below 3.0.0 answers `/info` at all, so
 * this is a floor on the *fallback* path, not a live comparison: any
 * wrapper that reports a version is already at or above it.
 *
 * (It read 1.2.0 until 2026-07 — the version the bot *predicted* `/info`
 * would land in. The wrapper shipped it two majors later, which left the
 * comparison permanently unreachable and the constant asserting something
 * untrue. The manifest replaces the mechanism; this stays for old wrappers.)
 */
export const MIN_WRAPPER_VERSION = "3.0.0";

/** Manifest envelope versions this bot knows how to read. */
export const SUPPORTED_MANIFEST_VERSION = 1;

export interface ExpectedFeature {
  /** The feature contract version this bot implements. */
  version: number;
  /** What is lost without it — shown verbatim in the startup report. */
  degrades: string;
}

/**
 * Feature names are a cross-repo contract: the wrapper cannot depend on
 * `@mcbot/schema`, so the two ends are this table and the wrapper's
 * FEATURES const. A name only ever appears here after it exists there.
 *
 * Every entry is optional in the sense that the bot still starts without
 * it — `degrades` says what the operator loses, which is the thing worth
 * printing.
 */
export const EXPECTED_WRAPPER_FEATURES: Record<string, ExpectedFeature> = {
  "server-state": {
    version: 1,
    degrades: "status, /players, /tps — the server appears permanently offline",
  },
  "log-stream": {
    version: 1,
    degrades: "in-game !commands, the chat bridge, and every log watcher",
  },
  "host-info": {
    version: 1,
    degrades: "host RAM/CPU in the status embed, and disk-space alerts",
  },
  usercache: {
    version: 1,
    degrades: "names for players who are not on the whitelist",
  },
  capabilities: {
    version: 1,
    degrades: "suite feature gating — /backup and /mods stay enabled and may fail at use",
  },
  "stats-read": {
    version: 1,
    degrades: "/stats, /leaderboard, /top, and the hourly snapshots behind period boards",
  },
  "stats-delete": {
    version: 1,
    degrades: "/server prune-stats — it reports 0 deletions",
  },
  whitelist: {
    version: 1,
    degrades: "/whitelist, /unwhitelist, and player-name autocomplete",
  },
  mods: { version: 1, degrades: "/mods" },
  backups: { version: 1, degrades: "/backup" },
  "rcon-command": {
    version: 1,
    degrades: "every command that talks to the server console",
  },
  scripts: {
    version: 1,
    degrades: "/server start, stop, restart, and backup",
  },
  "logs-tail": { version: 1, degrades: "/logs and the console relay" },
};

export interface WrapperManifest {
  wrapper: string;
  manifest: number;
  routes: string[];
  features: Record<string, { version: number; summary: string }>;
  scriptActions: string[];
}

/**
 * Narrow an unknown `/manifest` body.
 *
 * Unlike the other wrapper responses this one is *not* cast to its type:
 * its whole job is to be read from wrappers whose contract is in doubt,
 * so trusting its shape would beg the question. A malformed manifest
 * yields null and the caller falls back to the version compare.
 */
export function parseManifest(body: unknown): WrapperManifest | null {
  if (!isRecord(body)) return null;
  const { wrapper, manifest, routes, features, scriptActions } = body;
  if (typeof wrapper !== "string" || typeof manifest !== "number") return null;
  if (!Array.isArray(routes) || !routes.every((r) => typeof r === "string")) {
    return null;
  }
  if (
    !Array.isArray(scriptActions) ||
    !scriptActions.every((a) => typeof a === "string")
  ) {
    return null;
  }
  if (!isRecord(features)) return null;

  const parsed: WrapperManifest["features"] = {};
  for (const [name, spec] of Object.entries(features)) {
    if (!isRecord(spec)) return null;
    if (typeof spec.version !== "number") return null;
    parsed[name] = {
      version: spec.version,
      summary: typeof spec.summary === "string" ? spec.summary : "",
    };
  }
  return { wrapper, manifest, routes, features: parsed, scriptActions };
}

export interface ContractReport {
  /** Wanted by this bot, absent from the wrapper. */
  missing: Array<{ name: string; degrades: string }>;
  /** Present on both, but the wrapper's contract version is older. */
  outdated: Array<{ name: string; want: number; have: number; degrades: string }>;
  /** Present on both, but the wrapper's is newer than this bot reads. */
  ahead: Array<{ name: string; want: number; have: number }>;
  /** Offered by the wrapper, unknown to this bot. */
  unused: Array<{ name: string; summary: string }>;
}

/** Diff a wrapper's manifest against what this bot expects. */
export function compareContract(manifest: WrapperManifest): ContractReport {
  const report: ContractReport = {
    missing: [],
    outdated: [],
    ahead: [],
    unused: [],
  };

  for (const [name, want] of Object.entries(EXPECTED_WRAPPER_FEATURES)) {
    const have = manifest.features[name];
    if (!have) {
      report.missing.push({ name, degrades: want.degrades });
    } else if (have.version < want.version) {
      report.outdated.push({
        name,
        want: want.version,
        have: have.version,
        degrades: want.degrades,
      });
    } else if (have.version > want.version) {
      report.ahead.push({ name, want: want.version, have: have.version });
    }
  }

  for (const [name, spec] of Object.entries(manifest.features)) {
    if (!EXPECTED_WRAPPER_FEATURES[name]) {
      report.unused.push({ name, summary: spec.summary });
    }
  }
  return report;
}

/** True when nothing about this wrapper is worth telling the operator. */
export function contractIsClean(report: ContractReport): boolean {
  return (
    report.missing.length === 0 &&
    report.outdated.length === 0 &&
    report.ahead.length === 0 &&
    report.unused.length === 0
  );
}

/**
 * Turn a report into the lines to log. Split from the logging itself so
 * the wording is testable without capturing a logger.
 *
 * Each line names the fix, because "wrapper 3.0.0 is old" is not something
 * an operator can act on at 2am — "update the wrapper, you are losing the
 * chat bridge" is.
 */
export function describeContract(
  manifest: WrapperManifest,
  report: ContractReport,
  botVersion: string,
): string[] {
  const lines: string[] = [];

  for (const f of report.missing) {
    lines.push(
      `wrapper ${manifest.wrapper} does not provide "${f.name}" — ` +
        `${f.degrades}. Update the wrapper on the server host.`,
    );
  }
  for (const f of report.outdated) {
    lines.push(
      `wrapper ${manifest.wrapper} provides "${f.name}" v${f.have}, ` +
        `this bot expects v${f.want} — ${f.degrades}. Update the wrapper.`,
    );
  }
  for (const f of report.ahead) {
    lines.push(
      `wrapper ${manifest.wrapper} provides "${f.name}" v${f.have}, ` +
        `newer than the v${f.want} bot ${botVersion} implements — ` +
        `that feature may misbehave until the bot is updated.`,
    );
  }
  if (report.unused.length > 0) {
    const names = report.unused.map((f) => f.name).join(", ");
    lines.push(
      `wrapper ${manifest.wrapper} offers features bot ${botVersion} does ` +
        `not use: ${names}. Update the bot to pick them up.`,
    );
  }
  return lines;
}

/** Log a report under the instance's tag. Never throws. */
export function logContractReport(
  serverId: string,
  manifest: WrapperManifest,
  report: ContractReport,
  botVersion: string,
): void {
  if (manifest.manifest > SUPPORTED_MANIFEST_VERSION) {
    log.warn(
      serverId,
      `API wrapper publishes a v${manifest.manifest} manifest; this bot ` +
        `reads v${SUPPORTED_MANIFEST_VERSION}. Reading what it can — ` +
        `update the bot if remote features misbehave.`,
    );
  }
  if (contractIsClean(report)) {
    log.debug(
      serverId,
      `API wrapper ${manifest.wrapper}: all ${
        Object.keys(EXPECTED_WRAPPER_FEATURES).length
      } expected features present.`,
    );
    return;
  }
  for (const line of describeContract(manifest, report, botVersion)) {
    log.warn(serverId, line);
  }
}
