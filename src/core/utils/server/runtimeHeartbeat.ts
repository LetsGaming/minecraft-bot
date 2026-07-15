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
import { getRootDir } from "../paths.js";
import { log } from "../logger.js";

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
    } satisfies RuntimeHeartbeat).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("heartbeat", `Write failed: ${msg}`);
    });
  };
  beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();
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
  };
}

/** Convenience for the dashboard: alive = beat fresh enough. */
export function heartbeatIsFresh(
  beat: RuntimeHeartbeat | null,
  now = Date.now(),
): boolean {
  return !!beat && now - beat.at <= STALE_AFTER_MS;
}
