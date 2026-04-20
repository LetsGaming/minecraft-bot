// ── Minecraft data types ──────────────────────────────────────────────────────

export interface WhitelistEntry {
  uuid: string;
  name: string;
}

export interface PlayerCoords {
  x: number;
  y: number;
  z: number;
}

export interface PlayerCount {
  playerCount: string;
  maxPlayers: string;
}

export interface ServerListResult {
  playerCount: string;
  maxPlayers: string;
  players: string[];
}

/** TPS result from a Paper/Spigot server with 1m/5m/15m averages */
export interface PaperTpsResult {
  tps1m: number;
  tps5m: number;
  tps15m: number;
  raw: string;
}

/** TPS result derived from vanilla `tick query` command */
export interface VanillaTpsResult {
  tps1m: number;
  mspt: number;
  raw: string;
  p50?: number;
  p95?: number;
  p99?: number;
}

/** Minimal TPS result when only the base TPS value is parseable */
export interface MinimalTpsResult {
  tps1m: number;
  raw: string;
}

export type TpsResult = PaperTpsResult | VanillaTpsResult | MinimalTpsResult;

/** Mojang API player profile */
export interface MojangProfile {
  id: string;
  name: string;
}

/**
 * Minecraft stats file — can be either the old flat format
 * (dot-separated keys) or the new nested format (category -> key -> value).
 */
export interface MinecraftStatsFile {
  stats?: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

export interface WhitelistAuditEntry {
  username?: string;
  uuid?: string | null;
  addedBy?: string;
  addedById?: string;
  addedAt?: string;
  server?: string;
  removedBy?: string;
  removedById?: string;
  removedAt?: string;
  removedFromServer?: string;
}

export type WhitelistAuditMap = Record<string, WhitelistAuditEntry>;
