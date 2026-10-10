/**
 * Runtime heartbeat — how the dashboard (a separate process) knows the
 * bot is alive. The bot overwrites data/runtime.json roughly once a
 * minute; the web backend reads it and treats a stale timestamp
 * (> STALE_AFTER_MS) as "bot down", which the UI shows as a banner.
 * File-based on purpose: both processes already share the data dir, and
 * a socket would add a failure mode for one boolean.
 */
import path from "path";
import { loadJson, saveJson } from "../jsonStore.js";
import { getLoadedConfigRevision } from "../../config.js";
import { getRootDir } from "../paths.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";

const RUNTIME_PATH = path.resolve(getRootDir(), "data", "runtime.json");

export const HEARTBEAT_INTERVAL_MS = 60_000;
/** 2.5 intervals of grace before the dashboard calls the bot down. */
export const STALE_AFTER_MS = 150_000;

export interface RuntimeHeartbeat {
  /** Last beat (epoch ms). */
  at: number;
  /** Bot process start (epoch ms). */
  startedAt: number;
  pid: number;
  version: string;
  /** The config revision the bot last applied; absent on bots that predate it. */
  config?: AppliedConfigReport;
}

export interface AppliedConfigReport {
  /** sha256 of the config.json bytes the bot reloaded and reconciled. */
  hash: string;
  appliedAt: number;
  /** Servers whose connection settings changed and need a restart to take effect. */
  restartRequired: string[];
}

let applied: AppliedConfigReport | null = null;
let beatNow: (() => void) | null = null;

/**
 * Record the config revision the bot is now running with and publish it at
 * once, so the dashboard learns about an applied edit within a moment rather
 * than at the next scheduled beat.
 */
export function noteConfigApplied(hash: string, restartRequired: string[] = []): void {
  applied = { hash, appliedAt: Date.now(), restartRequired };
  beatNow?.();
}

/**
 * Capture the revision the bot has just loaded, before reconciling against it,
 * and return the function that reports it once the reconcile finished. Taking
 * the hash up front keeps a second reload that lands mid-reconcile from being
 * reported as applied before it was.
 */
export function beginConfigApply(): (restartRequired: string[]) => void {
  const hash = getLoadedConfigRevision()?.hash;
  return (restartRequired) => {
    if (hash) noteConfigApplied(hash, restartRequired);
  };
}

/** Start beating. Called once by the bot process. */
export function startRuntimeHeartbeat(version: string): void {
  const startedAt = Date.now();
  const beat = (): void => {
    saveJson(RUNTIME_PATH, {
      at: Date.now(),
      startedAt,
      pid: process.pid,
      version,
      ...(applied ? { config: applied } : {}),
    } satisfies RuntimeHeartbeat).catch((err: unknown) => {
      log.warn("heartbeat", `Write failed: ${errMsg(err)}`);
    });
  };
  beatNow = beat;
  beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();
}

function isAppliedReport(value: unknown): value is AppliedConfigReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<AppliedConfigReport>;
  return (
    typeof v.hash === "string" &&
    typeof v.appliedAt === "number" &&
    Array.isArray(v.restartRequired) &&
    v.restartRequired.every((id) => typeof id === "string")
  );
}

/** Read the last heartbeat, or null when none was ever written. */
export async function readRuntimeHeartbeat(): Promise<RuntimeHeartbeat | null> {
  const raw = (await loadJson(RUNTIME_PATH).catch(() => null)) as
    | Partial<RuntimeHeartbeat>
    | null;
  if (!raw || typeof raw.at !== "number") return null;
  return {
    at: raw.at,
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : raw.at,
    pid: typeof raw.pid === "number" ? raw.pid : 0,
    version: typeof raw.version === "string" ? raw.version : "unknown",
    ...(isAppliedReport(raw.config) ? { config: raw.config } : {}),
  };
}

/** Convenience for the dashboard: alive = beat fresh enough. */
export function heartbeatIsFresh(
  beat: RuntimeHeartbeat | null,
  now = Date.now(),
): boolean {
  return !!beat && now - beat.at <= STALE_AFTER_MS;
}
