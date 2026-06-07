/**
 * Per-user token-bucket rate limiter for Discord slash commands.
 *
 * Each user gets a bucket that refills to CAPACITY tokens every WINDOW_MS.
 * Commands that cost more than the current balance are rejected.
 *
 * Buckets are lazily created and periodically pruned to avoid unbounded
 * memory growth in long-running bots.
 */

const CAPACITY  = 5;           // max commands per window
const WINDOW_MS = 30_000;      // 30-second rolling window
const PRUNE_INTERVAL_MS = 5 * 60_000; // prune idle buckets every 5 minutes

interface Bucket {
  tokens:    number;
  lastSeen:  number;
}

const _buckets = new Map<string, Bucket>();

// Periodically clear buckets that haven't been seen for two full windows
// so the map doesn't grow unboundedly in bots with many users.
const _pruneTimer = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [id, b] of _buckets) {
    if (b.lastSeen < cutoff) _buckets.delete(id);
  }
}, PRUNE_INTERVAL_MS);

// Don't block process exit on this timer
_pruneTimer.unref();

/**
 * Attempt to consume one token for the given user ID.
 *
 * @returns `true` if the command should proceed; `false` if rate-limited.
 */
export function consumeToken(userId: string): boolean {
  const now = Date.now();
  let bucket = _buckets.get(userId);

  if (!bucket) {
    _buckets.set(userId, { tokens: CAPACITY - 1, lastSeen: now });
    return true;
  }

  // Refill proportionally to elapsed time
  const elapsed = now - bucket.lastSeen;
  const refill   = (elapsed / WINDOW_MS) * CAPACITY;
  bucket.tokens  = Math.min(CAPACITY, bucket.tokens + refill);
  bucket.lastSeen = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * How many seconds until the bucket refills by at least one token.
 * Returns 0 if a token is already available.
 */
export function cooldownSeconds(userId: string): number {
  const bucket = _buckets.get(userId);
  if (!bucket || bucket.tokens >= 1) return 0;
  const needed  = 1 - bucket.tokens;
  const secs    = Math.ceil((needed / CAPACITY) * (WINDOW_MS / 1000));
  return secs;
}
