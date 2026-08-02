/**
 * Web API contract — the DTOs exchanged between the web-ui backend and
 * its frontend. One definition, imported by both sides, so the shapes
 * can never drift again (they were previously hand-mirrored in the
 * frontend's api.ts).
 *
 * This module must stay isomorphic: types only, no Node imports.
 */

import type {
  ServerState,
  RconState,
  WrapperState,
  HealthSource,
} from "./serverState.js";

export interface ServerStatus {
  id: string;
  /**
   * The three-way answer: what the server is doing, or that the API wrapper
   * did not answer so we could not ask. Prefer this over `online` — it is the
   * only field that can tell "the server stopped" from "the wrapper is down".
   */
  state: ServerState;
  /** Whether RCON is answering, reported separately from liveness. */
  rcon: RconState;
  /**
   * Whether the API wrapper answered. Independent of `state`: the server can
   * be demonstrably online (via a direct ping) while this is `unreachable`,
   * which means players are fine but every control is gone.
   */
  wrapper: WrapperState;
  /** Which channel established `state` — the wrapper, or a direct ping. */
  source: HealthSource;
  /**
   * Legacy convenience: `state === "online"`. Kept because a good deal of the
   * UI only needs the green/not-green split, and because a dashboard build
   * older than this field keeps working.
   */
  online: boolean;
  players: {
    online: number;
    max: number;
    names: string[];
    /**
     * True when `names` is a capped sample from a direct ping rather than the
     * full roster. The counts are exact either way; the names are not.
     */
    sampled: boolean;
  };
  tps: number | null;
  /**
   * What this server's wrapper advertises it can do.
   *
   * The UI gates on this rather than on the dashboard's own version: a
   * Restore button should appear because the wrapper said restore exists, not
   * because this build knows the feature. Null when the wrapper did not
   * answer, in which case the UI shows no controls it cannot honour.
   */
  features: {
    /** The suite scripts this instance actually has. */
    scripts: Record<string, boolean>;
    /** backup/restore.sh exists (wrapper >= 3.3.0). */
    restore: boolean;
    /** The wrapper serves the archive index and download (>= 3.3.0). */
    backupFiles: boolean;
  } | null;
  host: {
    /** The Minecraft process. cpuPercent is sampled and can exceed 100. */
    process: { rssBytes: number; cpuPercent: number } | null;
    /** The whole machine. null from wrappers older than host-info v2. */
    machine: {
      cpuPercent: number;
      cpuCount: number;
      memTotalBytes: number;
      memUsedBytes: number;
      uptimeSeconds: number;
    } | null;
    disks: Array<{
      path: string;
      /** The directory's own size. null when the wrapper could not measure it. */
      sizeBytes: number | null;
      /** Filesystem this directory sits on. "" from a pre-v2 wrapper. */
      mountPoint: string;
      usedPercent: number;
      usedBytes: number;
      totalBytes: number;
    }>;
  } | null;
}

export interface StatusResponse {
  bot: {
    alive: boolean;
    lastBeat: number | null;
    startedAt: number | null;
    version: string | null;
  };
  servers: ServerStatus[];
}

export interface AuditEntry {
  at: string;
  action: string;
  server: string | null;
  by: string;
  detail?: string;
}

/** GET /api/config — redacted config plus the optimistic-concurrency hash. */
export interface ConfigResponse {
  /** sha256 of the raw on-disk config.json this response was built from. */
  hash: string;
  config: unknown;
}

/** PUT /api/config request body. */
export interface ConfigWriteRequest {
  /**
   * The hash from the GET /api/config the edit was based on. The server
   * rejects with 409 when config.json changed underneath the editor
   * (another dashboard admin, the bot's /config command, a hand edit).
   */
  baseHash: string;
  config: unknown;
}

export interface ConfigWriteConflict {
  error: "conflict";
  message: string;
  /** The hash of the config currently on disk — reload and re-apply. */
  currentHash: string;
}
