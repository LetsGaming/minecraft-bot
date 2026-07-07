/**
 * Web API contract — the DTOs exchanged between the web-ui backend and
 * its frontend. One definition, imported by both sides, so the shapes
 * can never drift again (they were previously hand-mirrored in the
 * frontend's api.ts).
 *
 * This module must stay isomorphic: types only, no Node imports.
 */

export interface ServerStatus {
  id: string;
  online: boolean;
  players: { online: number; max: number; names: string[] };
  tps: number | null;
  host: {
    process: { rssBytes: number; cpuPercent: number } | null;
    disks: Array<{
      path: string;
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
