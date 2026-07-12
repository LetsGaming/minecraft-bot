/**
 * Per-user token-bucket rate limiter.
 *
 * Each user gets a bucket that refills to `capacity` tokens every
 * `windowMs`. Actions that cost more than the current balance are rejected.
 *
 * Buckets are lazily created and periodically pruned to avoid unbounded
 * memory growth in long-running bots.
 *
 * Built as a factory: paths that bypass the slash-command dispatcher (like
 * the Discord→MC chat bridge on messageCreate) get their own limiter. The
 * module-level exports are the shared slash-command limiter.
 */

import { loadConfig } from "../config.js";
import { isRecord } from "./objects.js";

const PRUNE_INTERVAL_MS = 5 * 60_000; // prune idle buckets every 5 minutes

interface Bucket {
  tokens: number;
  lastSeen: number;
}

export interface RateLimiter {
  /** Attempt to consume one token. `true` = proceed, `false` = limited. */
  consumeToken(userId: string): boolean;
  /** Seconds until at least one token is available again (0 if available). */
  cooldownSeconds(userId: string): number;
}

export function createRateLimiter(options: {
  capacity: number;
  windowMs: number;
}): RateLimiter {
  const { capacity, windowMs } = options;
  const buckets = new Map<string, Bucket>();

  // Periodically clear buckets that haven't been seen for two full windows
  // so the map doesn't grow unboundedly in bots with many users.
  const pruneTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs * 2;
    for (const [id, b] of buckets) {
      if (b.lastSeen < cutoff) buckets.delete(id);
    }
  }, PRUNE_INTERVAL_MS);

  // Don't block process exit on this timer
  pruneTimer.unref();

  return {
    consumeToken(userId: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(userId);

      if (!bucket) {
        buckets.set(userId, { tokens: capacity - 1, lastSeen: now });
        return true;
      }

      // Refill proportionally to elapsed time
      const elapsed = now - bucket.lastSeen;
      const refill = (elapsed / windowMs) * capacity;
      bucket.tokens = Math.min(capacity, bucket.tokens + refill);
      bucket.lastSeen = now;

      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },

    cooldownSeconds(userId: string): number {
      const bucket = buckets.get(userId);
      if (!bucket || bucket.tokens >= 1) return 0;
      const needed = 1 - bucket.tokens;
      return Math.ceil((needed / capacity) * (windowMs / 1000));
    },
  };
}

// ── Default limiter for Discord slash commands (original behaviour) ───────

/** Built-in caps; `limits` in config.json overrides them at startup. */
export const DEFAULT_SLASH_CAPACITY = 5;
export const DEFAULT_SLASH_WINDOW_MS = 30_000;
export const DEFAULT_BRIDGE_CAPACITY = 8;
export const DEFAULT_BRIDGE_WINDOW_MS = 10_000;

/**
 * The configured `limits` block, read lazily so this module can load
 * before (or without) a valid config — tests and the schema generator do.
 * Limiter shape is fixed at first use; changing limits needs a restart
 * (buckets carry state, so live-resizing them would be lossy anyway).
 */
function configuredLimits(): {
  slashCapacity: number;
  slashWindowMs: number;
  bridgeCapacity: number;
  bridgeWindowMs: number;
} {
  let limits: Record<string, unknown> = {};
  try {
    const cfgLimits = loadConfig().limits;
    if (isRecord(cfgLimits)) limits = cfgLimits;
  } catch {
    /* config unavailable (isolated tests, schema generator) — defaults */
  }
  const num = (v: unknown, fallback: number, min: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= min ? v : fallback;
  return {
    slashCapacity: num(limits.slashCapacity, DEFAULT_SLASH_CAPACITY, 1),
    slashWindowMs: num(limits.slashWindowMs, DEFAULT_SLASH_WINDOW_MS, 1000),
    bridgeCapacity: num(limits.bridgeCapacity, DEFAULT_BRIDGE_CAPACITY, 1),
    bridgeWindowMs: num(limits.bridgeWindowMs, DEFAULT_BRIDGE_WINDOW_MS, 1000),
  };
}

/** Bridge limiter settings for the chat bridge to consume. */
export function bridgeLimiterSettings(): {
  capacity: number;
  windowMs: number;
} {
  const l = configuredLimits();
  return { capacity: l.bridgeCapacity, windowMs: l.bridgeWindowMs };
}

let slashCommandLimiter: RateLimiter | null = null;

function getSlashLimiter(): RateLimiter {
  if (!slashCommandLimiter) {
    const l = configuredLimits();
    slashCommandLimiter = createRateLimiter({
      capacity: l.slashCapacity,
      windowMs: l.slashWindowMs,
    });
  }
  return slashCommandLimiter;
}

/**
 * Attempt to consume one token for the given user ID.
 *
 * @returns `true` if the command should proceed; `false` if rate-limited.
 */
export function consumeToken(userId: string): boolean {
  return getSlashLimiter().consumeToken(userId);
}

/**
 * How many seconds until the bucket refills by at least one token.
 * Returns 0 if a token is already available.
 */
export function cooldownSeconds(userId: string): number {
  return getSlashLimiter().cooldownSeconds(userId);
}
