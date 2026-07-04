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

const slashCommandLimiter = createRateLimiter({
  capacity: 5, // max commands per window
  windowMs: 30_000, // 30-second rolling window
});

/**
 * Attempt to consume one token for the given user ID.
 *
 * @returns `true` if the command should proceed; `false` if rate-limited.
 */
export function consumeToken(userId: string): boolean {
  return slashCommandLimiter.consumeToken(userId);
}

/**
 * How many seconds until the bucket refills by at least one token.
 * Returns 0 if a token is already available.
 */
export function cooldownSeconds(userId: string): number {
  return slashCommandLimiter.cooldownSeconds(userId);
}
