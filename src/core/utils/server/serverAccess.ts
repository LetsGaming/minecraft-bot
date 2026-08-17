/**
 * serverAccess.ts
 *
 * Single routing layer for every operation that requires either local
 * filesystem / shell access OR a call to the remote API wrapper.
 *
 * Rule: if server.config.apiUrl is set → HTTP call to the API wrapper.
 *       Otherwise → exact same local logic that always existed.
 *
 * Callers never import fs, path, spawn, or execFile directly for
 * server-specific data. They import and call these functions instead.
 *
 * Functions are intentionally thin — they do no business logic beyond
 * routing and returning the raw data the caller needs.
 */

import {
  MIN_WRAPPER_VERSION,
  compareContract,
  logContractReport,
  parseManifest,
  type WrapperManifest,
} from "./wrapperContract.js";
import { log } from "../logger.js";
import { SseLineStream } from "../sseLineStream.js";
import { isRecord } from "../objects.js";
import {
  HealthSource,
  RconState,
  ServerState,
  WrapperState,
  unknownHealth,
  type ServerHealth,
} from "@mcbot/schema/serverState.js";
import {
  DEFAULT_MINECRAFT_PORT,
  pingMinecraftServer,
  type PingOutcome,
} from "./serverPing.js";
import type {
  ServerConfig,
  WhitelistEntry,
  MinecraftStatsFile,
  BackupSummary,
  BackupFileIndex,
  ScriptResult,
  ServerCapabilities,
  TpsResult,
} from "../../types/index.js";
import { allCapabilities } from "../../types/index.js";

// ── UUID sink guard ───────────────────────────────────────────────────────

/**
 * Defense-in-depth at the sink: every UUID used here currently comes from
 * Mojang or the server's own files, but assert the shape right before any
 * `path.join`/URL interpolation anyway so a future caller can't introduce
 * path traversal.
 */
const UUID_FORMAT = /^[0-9a-fA-F-]{32,36}$/;

function assertUuidFormat(uuid: string): void {
  if (!UUID_FORMAT.test(uuid)) {
    throw new Error(
      `Invalid UUID format: ${JSON.stringify(String(uuid).slice(0, 64))}`,
    );
  }
}

// ── API helper ────────────────────────────────────────────────────────────

// apiGet/apiPost/apiDelete talk to *our own* server wrapper, whose response
// shapes are a versioned contract enforced at connect time by
// verifyWrapperVersion() (see MIN_WRAPPER_VERSION). Casting the JSON to the
// caller-specified T is therefore asserting a pinned first-party contract, not
// blindly trusting arbitrary third-party JSON — a wrapper that changed a field
// would fail the version gate, not silently mis-shape a response here.
/** A wrapper-level route: /health, /manifest, /instances. */
function wrapperUrl(cfg: ServerConfig, route: string): string {
  return `${cfg.apiUrl!.replace(/\/$/, "")}${route}`;
}

/** A route scoped to this instance — everything under /instances/:id. */
function instanceUrl(cfg: ServerConfig, route: string): string {
  return wrapperUrl(cfg, `/instances/${cfg.id}${route}`);
}

/**
 * GET an instance route without asserting the status, for the few callers
 * that treat a specific one as data rather than as a failure.
 */
async function apiGetRaw(
  cfg: ServerConfig,
  route: string,
  timeoutMs = DEFAULT_GET_TIMEOUT_MS,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  // Bug 3 fix: explicit timeout so a hung API server can't stall the poll
  // loop indefinitely. Node 18+ AbortSignal.timeout() is zero-dependency.
  return fetch(instanceUrl(cfg, route), {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const DEFAULT_GET_TIMEOUT_MS = 8_000;

/**
 * Health gets a tighter budget than everything else. It is polled on a loop
 * and its whole purpose is to answer quickly enough to be worth asking — and
 * the wrapper's own probes are bounded well below this, so anything slower is
 * the network or a wedged wrapper, which is precisely the `unreachable` case
 * we want to report rather than wait out.
 */
const HEALTH_TIMEOUT_MS = 5_000;

/** Assert a wrapper response is OK and decode it. */
async function readApiJson<T>(res: Response, route: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${route} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see note above)
}

async function apiGet<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs = DEFAULT_GET_TIMEOUT_MS,
): Promise<T> {
  return readApiJson<T>(await apiGetRaw(cfg, route, timeoutMs), route);
}

async function apiPost<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  // Explicit timeout. Most POSTs finish well inside 30 s; the mod install and
  // update-all endpoints download files and pass a much larger ceiling.
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${route} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

// ── Log tailing ───────────────────────────────────────────────────────────

/**
 * Return the last N lines of the server's latest.log.
 * Used as a fallback for seed/coord parsing and screen-mode getList.
 */
export async function tailLog(cfg: ServerConfig, lines = 10): Promise<string> {
  const { output } = await apiGet<{ output: string }>(
    cfg,
    `/logs/tail?lines=${lines}`,
  );
  return output;
}

// ── Server status ────────────────────────────────────────────────────────

/** The wrapper's `/health` body (`server-health` feature v1). */
interface WrapperHealth {
  state: string;
  processUp: boolean;
  probe: string;
  rcon: {
    configured: boolean;
    responsive: boolean;
    lastSuccessMsAgo: number | null;
  };
  /** The server's `server-port`, so a direct ping works without configuration. */
  gamePort: number | null;
  checkedAt: number;
  ageMs: number;
}

/**
 * Narrow a `/health` body instead of casting it.
 *
 * Every other wrapper response is cast, because the version gate pins the
 * contract. This one is different: its `state` flows straight into alerting
 * and UI branches, so a wrapper that answered `"Online"`, `"up"`, or a state
 * added in a later version would silently fall through every comparison and
 * land wherever the last `else` happens to point. Unrecognised input becomes
 * an explicit failure to parse, which the caller reports honestly.
 */
function parseWrapperHealth(body: unknown): ServerHealth | null {
  if (!isRecord(body)) return null;
  const { state, processUp, probe, rcon, checkedAt } = body;
  if (
    state !== ServerState.Online &&
    state !== ServerState.Unresponsive &&
    state !== ServerState.Offline
  ) {
    return null;
  }
  if (typeof processUp !== "boolean") return null;
  if (!isRecord(rcon)) return null;

  return {
    state,
    source: HealthSource.Wrapper,
    wrapper: WrapperState.Up,
    processUp,
    rcon: !rcon.configured
      ? RconState.Unconfigured
      : rcon.responsive === true
        ? RconState.Responsive
        : RconState.Unresponsive,
    probe: typeof probe === "string" ? probe : null,
    players: null,
    reason: null,
    checkedAt: typeof checkedAt === "number" ? checkedAt : Date.now(),
  };
}

// ── Direct ping ───────────────────────────────────────────────────────────

/**
 * Where to ping this server, when the wrapper cannot be asked.
 *
 * Explicit config wins. Otherwise the host comes from `apiUrl` — the wrapper
 * runs *on* the Minecraft host, which is the whole reason that URL points at
 * the right machine — and the port from whatever the wrapper last reported,
 * falling back to the vanilla default.
 */
const learnedGamePorts = new Map<string, number>();

/** Remember a `gamePort` so it is still known once the wrapper goes away. */
export function rememberGamePort(serverId: string, port: number | null): void {
  if (typeof port === "number" && port > 0 && port < 65536) {
    learnedGamePorts.set(serverId, port);
  }
}

export function pingTarget(
  cfg: ServerConfig,
): { host: string; port: number } | null {
  const port =
    cfg.pingPort ?? learnedGamePorts.get(cfg.id) ?? DEFAULT_MINECRAFT_PORT;
  if (cfg.pingHost) return { host: cfg.pingHost, port };
  try {
    return { host: new URL(cfg.apiUrl).hostname, port };
  } catch {
    return null;
  }
}

/**
 * Ask the Minecraft server directly. Returns null when pinging is switched off
 * or there is nowhere to send it.
 */
export async function pingServer(
  cfg: ServerConfig,
): Promise<PingOutcome | null> {
  if (cfg.disableDirectPing) return null;
  const target = pingTarget(cfg);
  if (!target) return null;
  return pingMinecraftServer(target.host, target.port);
}

/**
 * Turn a ping outcome into a health value.
 *
 * `wrapper` is supplied by the caller because a ping says nothing about the
 * wrapper — that is exactly the separation this whole model exists to keep.
 */
function healthFromPing(
  outcome: PingOutcome,
  wrapper: WrapperState,
  rcon: RconState,
): ServerHealth {
  const base = {
    source: HealthSource.Ping,
    wrapper,
    rcon,
    probe: "ping",
    checkedAt: Date.now(),
  };

  switch (outcome.kind) {
    case "status":
      // The server answered a client handshake with a live player count. It
      // is up and serving connections, whatever the wrapper thinks.
      return {
        ...base,
        state: ServerState.Online,
        processUp: true,
        players: {
          online: outcome.result.players.online,
          max: outcome.result.players.max,
          names: outcome.result.players.sample,
          // Servers publish at most a handful of names, so this is never the
          // roster — anything rendering it has to say so.
          sampled: true,
        },
        reason: null,
      };

    case "connected":
      // Something is listening but not answering: status disabled, still
      // starting, or a proxy in front. Life, not health.
      return {
        ...base,
        state: ServerState.Unresponsive,
        processUp: true,
        players: null,
        reason: "game port accepted the connection but sent no status",
      };

    case "refused":
      return {
        ...base,
        state: ServerState.Offline,
        processUp: false,
        players: null,
        reason: outcome.reason,
      };

    case "error":
      return {
        ...base,
        state: ServerState.Unknown,
        source: HealthSource.None,
        processUp: false,
        players: null,
        reason: outcome.reason,
      };
  }
}

/**
 * What a server is doing, from whichever channel can say.
 *
 * The wrapper is asked first — it has the richest answer, including RCON
 * responsiveness, which a ping cannot see. But the wrapper is a separate
 * process, and when it is down the old code gave up entirely: "the server's
 * state is unknown", for a server a player could see in their multiplayer
 * list with four people on it.
 *
 * So a direct ping is a **second opinion, consulted whenever the first is
 * anything other than "all good"**. That covers the case above and two more:
 *
 *   - the wrapper reports `offline` while the server answers a ping. The
 *     server wins — a status response is proof, and the wrapper's probes are
 *     inference. It also means the wrapper is misconfigured, which is worth
 *     saying out loud.
 *   - the wrapper reports `unresponsive` (RCON is not answering). The ping
 *     cannot fix that, but it can still supply the player count, so the state
 *     stays honest while the numbers come back.
 *
 * `unknown` now means both channels failed, which is a much smaller claim
 * than the one it replaced.
 */
export async function getHealth(cfg: ServerConfig): Promise<ServerHealth> {
  const fromWrapper = await wrapperHealth(cfg);

  // The wrapper answered and everything is fine — nothing to second-guess.
  if (
    fromWrapper &&
    fromWrapper.state === ServerState.Online &&
    fromWrapper.wrapper === WrapperState.Up
  ) {
    return fromWrapper;
  }

  const wrapperState = fromWrapper ? WrapperState.Up : WrapperState.Unreachable;
  const outcome = await pingServer(cfg);

  // Pinging is off, or there is nowhere to ping. Fall back to whatever the
  // wrapper managed to say.
  if (!outcome) {
    return fromWrapper ?? unknownHealth("API wrapper unreachable; direct ping unavailable");
  }

  const fromPing = healthFromPing(
    outcome,
    wrapperState,
    fromWrapper?.rcon ?? RconState.Unknown,
  );

  if (!fromWrapper) return fromPing;

  // Both spoke. The wrapper's verdict stands unless the ping positively
  // contradicts it, because only a status response is direct evidence.
  if (
    fromWrapper.state === ServerState.Offline &&
    fromPing.state === ServerState.Online
  ) {
    log.warn(
      cfg.id,
      `API wrapper reports this server stopped, but it answered a direct ` +
        `server-list ping with ${fromPing.players?.online ?? "?"} player(s) ` +
        `online. Trusting the ping. Check the wrapper's instance config — ` +
        `linuxUser, rconPort and the screen session name are what its ` +
        `liveness probes rely on.`,
    );
    return fromPing;
  }

  // Keep the wrapper's richer verdict, but take the players the ping found.
  return { ...fromWrapper, players: fromPing.players ?? fromWrapper.players };
}

/**
 * The wrapper's half of getHealth: its verdict, or null when it did not
 * answer at all. Never throws.
 */
async function wrapperHealth(cfg: ServerConfig): Promise<ServerHealth | null> {
  try {
    const res = await apiGetRaw(cfg, "/health", HEALTH_TIMEOUT_MS);

    if (res.status === 404) {
      // Pre-`server-health` wrapper. /running is all it has, and on those
      // versions it answers the RCON question rather than the process one —
      // so this path keeps the old (coarser) behaviour rather than inventing
      // a distinction the wrapper cannot make. The startup contract report
      // already tells the operator to update.
      const { running } = await apiGet<{ running: boolean }>(cfg, "/running");
      return {
        state: running ? ServerState.Online : ServerState.Offline,
        source: HealthSource.Wrapper,
        wrapper: WrapperState.Up,
        processUp: running,
        rcon: RconState.Unknown,
        probe: null,
        players: null,
        reason: null,
        checkedAt: Date.now(),
      };
    }

    const body = await readApiJson<WrapperHealth>(res, "/health");
    // Learn the game port while we can, so a ping still works after the
    // wrapper goes away — which is precisely when it is needed.
    rememberGamePort(cfg.id, body.gamePort ?? null);
    return parseWrapperHealth(body);
  } catch {
    return null;
  }
}

/**
 * Legacy boolean liveness.
 *
 * Kept for the wrapper-contract e2e check and for callers that genuinely only
 * need up/not-up. Anything that reports state to a human should use
 * getHealth() — this cannot distinguish a stopped server from an unreachable
 * wrapper, which is exactly the confusion users see.
 */
export async function isRunning(cfg: ServerConfig): Promise<boolean> {
  const { running } = await apiGet<{ running: boolean }>(cfg, "/running");
  return running;
}

/** Get the current player list. */
export async function getList(
  cfg: ServerConfig,
): Promise<{ playerCount: string; maxPlayers: string; players: string[] }> {
  return apiGet(cfg, "/list");
}

/** Send a command to the server (via RCON or screen on the remote host). */
export async function sendCommand(
  cfg: ServerConfig,
  command: string,
): Promise<string | null> {
  const { result } = await apiPost<{ result: string | null }>(cfg, "/command", {
    command,
  });
  return result;
}

/** Get TPS data from the server. Returns null if unavailable. */
export async function getTps(cfg: ServerConfig): Promise<TpsResult | null> {
  const { tps } = await apiGet<{
    tps: TpsResult | null;
  }>(cfg, "/tps");
  return tps;
}

async function apiDelete<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs = 8_000,
): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(url, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API DELETE ${route} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

// ── Wrapper /info: version handshake + remote host metrics ───────────────

// The expected-feature table, the manifest parser, and the report live in
// wrapperContract.ts; re-exported here so the wrapper contract still has
// one entry point for callers.
export {
  MIN_WRAPPER_VERSION,
  EXPECTED_WRAPPER_FEATURES,
  SUPPORTED_MANIFEST_VERSION,
  compareContract,
  describeContract,
  contractIsClean,
  parseManifest,
  type WrapperManifest,
  type ContractReport,
} from "./wrapperContract.js";
import { errMsg } from "../error.js";

/**
 * The `host` block of the wrapper's /info.
 *
 * Every field is optional because this is read from wrappers of several
 * ages: host-info v1 sent `process` + a flat `disks`, v2 adds the
 * whole-machine `host` block and moves the filesystem figures under
 * `disks[].filesystem` alongside a per-directory `sizeBytes`. Both shapes
 * are accepted; hostResources normalises them.
 */
export interface RemoteHostInfo {
  process?: {
    pid: number;
    cpuPercent: number;
    rssBytes: number;
  } | null;
  /** Whole machine. v2+; null on non-Linux hosts. */
  host?: {
    cpuPercent: number;
    cpuCount: number;
    memTotalBytes: number;
    memUsedBytes: number;
    uptimeSeconds: number;
  } | null;
  disks?: Array<{
    path: string;
    /** v2+: the directory's own size. null when du timed out. */
    sizeBytes?: number | null;
    /** v2+. */
    filesystem?: {
      mountPoint: string;
      usedPercent: number;
      availableBytes: number;
      totalBytes: number;
    };
    /** v1 flat fields, kept so an un-upgraded wrapper still reports. */
    usedPercent?: number;
    availableBytes?: number;
    totalBytes?: number;
  }>;
}

export interface RemoteInfo {
  /** Wrapper semver, present from wrapper >= 1.2.0. */
  version?: string;
  /** Process RAM/CPU + disk usage of the wrapper's host, same release. */
  host?: RemoteHostInfo;
}

/**
 * Fetch the wrapper's `/info` for a remote instance. Returns null when
 * the wrapper predates the endpoint (404) or is unreachable — callers
 * treat null as "older wrapper, feature unavailable", never as an error.
 */
export async function getRemoteInfo(
  cfg: ServerConfig,
): Promise<RemoteInfo | null> {
  if (!cfg.apiUrl) return null;
  try {
    const info = await apiGet<RemoteInfo>(cfg, "/info");
    return typeof info === "object" && info !== null ? info : null;
  } catch {
    return null;
  }
}

/** "1.10.2" >= "1.2.0"? Plain numeric segment compare, no prerelease. */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split(".").map((n) => parseInt(n, 10) || 0);
  const b = minimum.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

/**
 * Fetch the wrapper's feature manifest, or null when it predates the
 * endpoint (404), is unreachable, or answers something unparseable.
 *
 * Deliberately not `apiGet<WrapperManifest>`: every other wrapper
 * response is cast to its type because the version gate pins the
 * contract, but this endpoint *is* the gate. Trusting its shape would
 * assume what it exists to establish, so it goes through parseManifest.
 */
export async function getRemoteManifest(
  cfg: ServerConfig,
): Promise<WrapperManifest | null> {
  if (!cfg.apiUrl) return null;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  try {
    const res = await fetch(wrapperUrl(cfg, "/manifest"), {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null; // 404 on wrappers that predate the endpoint
    return parseManifest(await res.json());
  } catch {
    return null;
  }
}

/**
 * Report, at startup, where a remote instance's wrapper and this bot
 * disagree about what exists. Never throws — a mismatched wrapper
 * degrades features, it must not stop the bot.
 *
 * Preferred path is the manifest, which names the individual features.
 * Wrappers older than that get the coarse version compare they were
 * built for.
 */
export async function verifyWrapperContract(
  cfg: ServerConfig,
  botVersion: string,
): Promise<void> {
  if (!cfg.apiUrl) return;

  const manifest = await getRemoteManifest(cfg);
  if (manifest) {
    logContractReport(cfg.id, manifest, compareContract(manifest), botVersion);
    return;
  }

  // ── Fallback: no manifest, so all we have is /info's version.
  const info = await getRemoteInfo(cfg);
  if (!info || !info.version) {
    log.warn(
      cfg.id,
      `API wrapper reports neither a manifest nor a version (both /manifest ` +
        `and /info missing — wrapper predates ${MIN_WRAPPER_VERSION}). Remote ` +
        `host metrics, usercache names, and capability gating are ` +
        `unavailable until the wrapper is updated.`,
    );
    return;
  }
  if (!versionAtLeast(info.version, MIN_WRAPPER_VERSION)) {
    log.warn(
      cfg.id,
      `API wrapper ${info.version} is older than the expected ` +
        `${MIN_WRAPPER_VERSION} — some remote features may silently degrade. ` +
        `Update the wrapper on the server host.`,
    );
    return;
  }
  log.warn(
    cfg.id,
    `API wrapper ${info.version} does not publish /manifest, so this bot ` +
      `cannot check which remote features are available — a missing one will ` +
      `only show up as a feature quietly doing nothing. Update the wrapper.`,
  );
}

// ── Whitelist ─────────────────────────────────────────────────────────────

/** Read the server's whitelist. */
export async function readWhitelist(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  const { whitelist } = await apiGet<{ whitelist: WhitelistEntry[] }>(
    cfg,
    "/whitelist",
  );
  return whitelist;
}

/**
 * Read usercache.json (every player the server has ever seen, whitelist or
 * not). Returns [] on any error, including remote wrappers that predate the
 * /usercache endpoint — callers treat the cache as a best-effort name
 * source on top of the whitelist.
 */
export async function readUserCache(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  try {
    const { usercache } = await apiGet<{ usercache: WhitelistEntry[] }>(
      cfg,
      "/usercache",
    );
    return Array.isArray(usercache) ? usercache : [];
  } catch (err) {
    log.debug("serverAccess", `usercache unavailable for ${cfg.id}: ${errMsg(err)}`);
    return [];
  }
}

// ── Level name ────────────────────────────────────────────────────────────

/** Read level-name from server.properties. Falls back to "world". */
export async function readLevelName(cfg: ServerConfig): Promise<string> {
  const { levelName } = await apiGet<{ levelName: string }>(cfg, "/level-name");
  return levelName;
}

// ── Player stats ──────────────────────────────────────────────────────────

/** Load a single player's stats JSON. Returns null if not found. */
export async function readStats(
  cfg: ServerConfig,
  uuid: string,
): Promise<MinecraftStatsFile | null> {
  assertUuidFormat(uuid); // guard the path/route sink
  // A player with no stats file is a normal answer, not a failure: they have
  // simply never played here, and the wrapper says 404. Letting that throw
  // surfaced as "Failed to retrieve stats" (and an ERROR log) instead of the
  // "Stats File Not Found" reply the caller already handles. A 500 still
  // throws — "the read broke" must not look like "this player has none".
  const res = await apiGetRaw(cfg, `/stats/${uuid}`);
  if (res.status === 404) return null;
  const { stats } = await readApiJson<{ stats: MinecraftStatsFile | null }>(
    res,
    `/stats/${uuid}`,
  );
  return stats;
}

/** List all UUIDs that have a stats file on this server. */
export async function listStatsUuids(cfg: ServerConfig): Promise<string[]> {
  const { uuids } = await apiGet<{ uuids: string[] }>(cfg, "/stats");
  return uuids;
}

/** Delete a player's stats file via the wrapper. */
export async function deleteStatsFile(
  cfg: ServerConfig,
  uuid: string,
): Promise<boolean> {
  assertUuidFormat(uuid); // guard the path/route sink
  // The wrapper exposes DELETE /stats/:uuid so the
  // admin-gated /server prune-stats works on remote instances too.
  // Older wrappers without the route (or any transport error) degrade
  // to "not deleted" — prune-stats then reports 0 deletions instead of
  // failing the whole command.
  try {
    const { deleted } = await apiDelete<{ deleted: boolean }>(
      cfg,
      `/stats/${encodeURIComponent(uuid)}`,
    );
    return deleted === true;
  } catch {
    return false;
  }
}

// ── Mod list ──────────────────────────────────────────────────────────────

/**
 * Return the raw mod slugs and the mtime of downloaded_versions.json.
 * The caller (modUtils.ts) handles the Modrinth lookup and caching —
 * that logic is the same regardless of local/remote.
 */
export async function readModSlugs(
  cfg: ServerConfig,
): Promise<{ slugs: string[]; mtimeMs: number }> {
  return apiGet<{ slugs: string[]; mtimeMs: number }>(cfg, "/mods");
}

// ── Mod management (the wrapper's `mod-management` feature) ────────────────
//
// These mirror the wrapper's wire types (api-server src/contracts/wire.ts).
// They are a pinned first-party contract, gated at connect time by the
// feature handshake, so casting the JSON asserts that contract — the same
// basis as every apiGet above.

export interface InstalledMod {
  slug: string;
  versionId: string | null;
  filename: string | null;
}

export interface InstalledMods {
  gameVersion: string | null;
  modLoader: string | null;
  mtimeMs: number;
  mods: InstalledMod[];
}

export interface ModAddResult {
  ok: boolean;
  slug?: string;
  action?: string;
  versionId?: string;
  filename?: string;
  dependencies?: Array<{ slug: string; action: string }>;
  error?: string;
  code?: string;
}

export interface ModRemoveResult {
  ok: boolean;
  slug?: string;
  removedFile?: string | null;
  orphanedDependencies?: string[];
  error?: string;
  code?: string;
}

export interface ModUpdateCheck {
  mcVersion: string;
  modLoader: string;
  results: Array<{ slug: string; status: string; [key: string]: unknown }>;
}

export interface ModApplyResult {
  ok: boolean;
  updated?: Array<{
    slug: string;
    toVersionId: string;
    filename: string;
    fromVersionId?: string | null;
  }>;
  upToDate?: string[];
  failed?: Array<{ slug: string; error: string }>;
  error?: string;
  code?: string;
}

/** The richer installed list (versions, loader, filenames) the Mods tab reads. */
export async function listInstalledMods(cfg: ServerConfig): Promise<InstalledMods> {
  return apiGet<InstalledMods>(cfg, "/mods/installed");
}

/** Install a mod. Long timeout: the wrapper downloads the jar and its deps. */
export async function addMod(
  cfg: ServerConfig,
  body: { slug: string; mcVersion?: string; modLoader?: string },
): Promise<ModAddResult> {
  return apiPost<ModAddResult>(cfg, "/mods", body, 130_000);
}

/** Remove an installed mod by slug. */
export async function removeMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModRemoveResult> {
  return apiDelete<ModRemoveResult>(cfg, `/mods/${encodeURIComponent(slug)}`);
}

/** Check installed mods for updates. Longer timeout: one Modrinth call per mod. */
export async function checkModUpdates(
  cfg: ServerConfig,
  mcVersion?: string,
): Promise<ModUpdateCheck> {
  const q = mcVersion ? `?mcVersion=${encodeURIComponent(mcVersion)}` : "";
  return apiGet<ModUpdateCheck>(cfg, `/mods/updates${q}`, 130_000);
}

/** Apply all available updates. Long timeout: downloads every updated jar. */
export async function applyModUpdates(
  cfg: ServerConfig,
  mcVersion?: string,
): Promise<ModApplyResult> {
  return apiPost<ModApplyResult>(
    cfg,
    "/mods/updates",
    mcVersion ? { mcVersion } : {},
    610_000,
  );
}

/** Update one installed mod to its latest compatible build. */
export async function updateMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModApplyResult> {
  return apiPost<ModApplyResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/update`,
    {},
    130_000,
  );
}

// ── Backups ───────────────────────────────────────────────────────────────

/** Scan the backup directories for a server. */
export async function readBackups(cfg: ServerConfig): Promise<BackupSummary> {
  const data = await apiGet<{
    dirs: Array<{
      dir: string;
      count: number;
      latestFile: string;
      latestMtimeMs: number;
      latestSizeBytes: number;
    }>;
    totalBytes: number;
  }>(cfg, "/backups");
  return {
    dirs: data.dirs.map((d) => ({
      ...d,
      latestMtime: new Date(d.latestMtimeMs),
    })),
    totalBytes: data.totalBytes,
  };
}

/**
 * One page of the archive index (wrapper >= 3.3.0).
 *
 * The `id` on each entry is an opaque handle. It is the only file reference
 * this client ever sends back, and the wrapper resolves it against a listing
 * it builds itself — so no caller, here or in the browser, is ever in a
 * position to name a path.
 */
export async function indexBackupFiles(
  cfg: ServerConfig,
  opts: { cursor?: string; limit?: number } = {},
): Promise<BackupFileIndex> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const query = params.toString();
  return apiGet<BackupFileIndex>(
    cfg,
    `/backups/files${query ? `?${query}` : ""}`,
  );
}

/**
 * Open a backup download and hand back the live response.
 *
 * Deliberately NOT `apiGet`: that decodes JSON into memory, and these
 * archives are measured in gigabytes. The caller gets the Response with its
 * body still unread so it can pipe it straight through; buffering here would
 * take the dashboard process down on the first big world.
 *
 * `range` is forwarded verbatim so a browser's resume request reaches the
 * wrapper intact, and there is no timeout: a multi-gigabyte transfer is
 * legitimately slower than any figure that would make sense as a ceiling.
 */
export async function openBackupDownload(
  cfg: ServerConfig,
  fileId: string,
  range?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  if (range) headers["range"] = range;
  return fetch(
    instanceUrl(cfg, `/backups/files/${encodeURIComponent(fileId)}/download`),
    { headers },
  );
}

/**
 * Restore the world from one archive.
 *
 * Its own wrapper route rather than a script action, because the path it
 * needs cannot be a script argument (the wrapper's arg validator forbids "/"
 * so a client can never hand a path to a spawned shell). The wrapper resolves
 * the id to a path itself.
 *
 * The timeout is the wrapper's, not ours: a restore unpacks a whole world,
 * and giving up on this side while the script keeps running would report a
 * failure that is actually still in progress.
 */
export async function restoreBackupFile(
  cfg: ServerConfig,
  fileId: string,
): Promise<ScriptResult> {
  const url = instanceUrl(
    cfg,
    `/backups/files/${encodeURIComponent(fileId)}/restore`,
  );
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /backups/restore → ${res.status}: ${text}`);
  }
  return res.json() as Promise<ScriptResult>;
}

// ── Mod config files (wrapper >= 3.4.0) ────────────────────────────

/** One editable config file. `id` is opaque; no caller ever names a path. */
export interface ConfigFileInfo {
  id: string;
  relPath: string;
  modId: string;
  format: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface ConfigFileContents {
  text: string;
  etag: string;
  file: ConfigFileInfo;
  snapshots: string[];
}

export async function indexConfigFiles(
  cfg: ServerConfig,
): Promise<ConfigFileInfo[]> {
  const { files } = await apiGet<{ files: ConfigFileInfo[] }>(cfg, "/configs");
  return files;
}

export async function readConfigFile(
  cfg: ServerConfig,
  fileId: string,
): Promise<ConfigFileContents> {
  return apiGet<ConfigFileContents>(
    cfg,
    `/configs/${encodeURIComponent(fileId)}`,
  );
}

/**
 * Write a config file back.
 *
 * `etag` is required all the way down, so a stale editor cannot overwrite a
 * file the game rewrote at shutdown. A mismatch comes back as a typed
 * conflict rather than an exception, because it is an expected outcome the UI
 * has to explain, not a failure.
 */
export async function writeConfigFile(
  cfg: ServerConfig,
  fileId: string,
  text: string,
  etag: string,
): Promise<
  { ok: true; etag: string; snapshot: string } | { ok: false; conflict: true }
> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "if-match": etag,
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  const res = await fetch(
    instanceUrl(cfg, `/configs/${encodeURIComponent(fileId)}`),
    { method: "PUT", headers, body: JSON.stringify({ text }) },
  );
  if (res.status === 412) return { ok: false, conflict: true };
  if (!res.ok) {
    throw new Error(`API PUT /configs → ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { etag: string; snapshot: string };
  return { ok: true, ...body };
}

export async function revertConfigFile(
  cfg: ServerConfig,
  fileId: string,
  snapshot: string,
): Promise<{ etag: string }> {
  return apiPost<{ etag: string }>(
    cfg,
    `/configs/${encodeURIComponent(fileId)}/revert`,
    { snapshot },
  );
}

// ── Capability detection ───────────────────────────────────────────

/**
 * Probe which setup-suite artifacts exist for a server.
 *
 * Local instances: cheap fs.existsSync probes against the documented suite
 * layout (management scripts, backup directories, mod manifest,
 * variables.txt).
 *
 * Remote instances: GET /instances/:id/capabilities on the API wrapper.
 * Older wrappers don't have that route, so any failure falls back to the
 * conservative all-true default — behaviour is then exactly as before
 * capability detection existed (errors surface at invocation time).
 */
export async function detectCapabilities(
  cfg: ServerConfig,
): Promise<ServerCapabilities> {
  try {
    return await apiGet<ServerCapabilities>(cfg, "/capabilities");
  } catch {
    return allCapabilities();
  }
}

// ── Script execution ──────────────────────────────────────────────────────

/**
 * Run a named server management script (start / stop / restart / backup / status).
 * On remote instances this POSTs to the API wrapper; locally it spawns the script
 * exactly as before.
 */
export async function runScript(
  cfg: ServerConfig,
  action: string,
  args: string[] = [],
): Promise<ScriptResult> {
  return apiPost<ScriptResult>(cfg, "/scripts/run", { action, args });
}

// ── Log streaming (SSE, used by the bot's watcher and the dashboard) ──────

/** Returns the SSE endpoint URL for a remote instance's log stream. */
export function logStreamUrl(cfg: ServerConfig): string {
  if (!cfg.apiUrl)
    throw new Error(`logStreamUrl called on local instance '${cfg.id}'`);
  return `${cfg.apiUrl.replace(/\/$/, "")}/instances/${cfg.id}/logs/stream`;
}

/** What a caller of openLogStream cares about. */
export interface LogStreamHandlers {
  /** One log line, already unwrapped from its SSE frame. */
  onLine: (line: string) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

/**
 * Open the wrapper's log stream for one instance.
 *
 * This is the only place that knows the wrapper sends `{"line": "..."}` in
 * each `data:` frame, and the only place that attaches the API key to a
 * stream. `SseLineStream` underneath is pure transport and knows neither —
 * the split is what lets the transport be tested without a wrapper and keeps
 * the wrapper's payload contract in the module that owns every other route.
 *
 * The returned stream is NOT started; call `.start()`. Callers own the
 * lifetime and must `.stop()` it.
 */
export function openLogStream(
  cfg: ServerConfig,
  handlers: LogStreamHandlers,
): SseLineStream {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  return new SseLineStream({
    url: logStreamUrl(cfg),
    headers,
    scope: cfg.id,
    onData: (payload) => {
      try {
        const { line } = JSON.parse(payload) as { line?: unknown };
        // A frame without a string line is a wrapper we don't understand, not
        // an empty log line: drop it rather than emitting "undefined".
        if (typeof line === "string") handlers.onLine(line);
      } catch {
        /* malformed frame — skip, the next one is independent */
      }
    },
    ...(handlers.onConnect ? { onConnect: handlers.onConnect } : {}),
    ...(handlers.onDisconnect ? { onDisconnect: handlers.onDisconnect } : {}),
  });
}
