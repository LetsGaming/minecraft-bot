/**
 * Reads each player's current skin hash from Mojang and stores it, so a head
 * URL can name the exact skin (see playerHead.ts). mc-heads keeps stale data
 * under a player's name and UUID, both a default head cached once and an old
 * skin kept after a change. A hash names the image itself, so it cannot be stale.
 *
 * Mojang limits how fast it answers (the session server allows about one
 * request a minute per account), so lookups are one at a time and a sweep stops
 * when Mojang says to slow down. A failed lookup keeps the stored hash.
 */
import { createHash } from "node:crypto";
import { MS } from "@mcbot/schema/time.js";
import { errMsg } from "../error.js";
import { log } from "../logger.js";
import { getSkin, markSkinFailed, setSkin } from "../stores/headStore.js";
import { lookupMojangProfile, lookupMojangSkin } from "./mojang.js";
import { skinHeadUrl } from "./playerHead.js";

/** A failed lookup is not retried sooner than this, so a down Mojang is not hammered. */
export const RETRY_AFTER_FAILURE_MS = 6 * MS.hour;

const IMAGE_FETCH_TIMEOUT_MS = 8 * MS.second;
const IMAGE_MAX_BYTES = 64 * 1024;
const IMAGE_USER_AGENT = "LetsGaming/minecraft-bot (skin check)";
/** A name no account can have: mc-heads answers it with its default head. */
const NO_SUCH_ACCOUNT = "zzqx_no_such_acct_91";

export type ResolveOutcome =
  /** Mojang answered and the hash differs from the stored one (null: default skin). */
  | { kind: "changed"; hash: string | null; previous: string | null }
  | { kind: "unchanged"; hash: string | null }
  /** Mojang does not know the name (an offline-mode or Bedrock player, or a free name). */
  | { kind: "unknown-account" }
  /** Mojang did not answer; the stored hash stays. */
  | { kind: "unavailable"; rateLimited: boolean }
  /** mc-heads answers its default head for this hash, so the name URL stays. */
  | { kind: "rejected"; hash: string }

/** What a caller of `ensureFreshSkin` can see besides a real answer. */
export type SkinOutcome =
  | ResolveOutcome
  /** The check was recent enough, or a failure is still cooling down. */
  | { kind: "skipped" }
  /** The check is still running after the time limit; it finishes in the background. */
  | { kind: "pending" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SHA-1 of an image answer, or null when it is not a small image. */
async function imageDigest(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": IMAGE_USER_AGENT },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!res.ok || !type.startsWith("image/")) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength > IMAGE_MAX_BYTES) return null;
    return createHash("sha1").update(body).digest("hex");
  } catch {
    return null;
  }
}

let defaultDigest: Promise<string | null> | null = null;
let warnedAboutHashes = false;

/** Exposed for tests. */
export function _resetSkinResolverForTesting(): void {
  defaultDigest = null;
  warnedAboutHashes = false;
  inFlight.clear();
}

function mcHeadsDefaultDigest(): Promise<string | null> {
  defaultDigest ??= imageDigest(`https://mc-heads.net/avatar/${NO_SUCH_ACCOUNT}/64`).then((digest) => {
    // A failed fetch is not remembered, so the next check tries again.
    if (digest === null) defaultDigest = null;
    return digest;
  });
  return defaultDigest;
}

/**
 * Does mc-heads render this hash as a real head? Only a clear "no" counts: when
 * either image cannot be fetched the hash is trusted, because Mojang's own
 * answer is better evidence than a failed check.
 */
async function mcHeadsServes(hash: string): Promise<boolean> {
  const [fallback, served] = await Promise.all([mcHeadsDefaultDigest(), imageDigest(skinHeadUrl(hash))]);
  if (fallback === null || served === null) return true;
  return served !== fallback;
}

const inFlight = new Map<string, Promise<ResolveOutcome>>();

async function lookup(name: string, now: number): Promise<ResolveOutcome> {
  const stored = getSkin(name);
  const previous = stored?.hash ?? null;

  const profile = await lookupMojangProfile(name);
  if (profile.kind === "unavailable") {
    markSkinFailed(name, now);
    return { kind: "unavailable", rateLimited: profile.rateLimited };
  }
  if (profile.kind === "unknown") {
    setSkin(name, null, now);
    return { kind: "unknown-account" };
  }

  const skin = await lookupMojangSkin(profile.value.id);
  if (skin.kind !== "found") {
    markSkinFailed(name, now);
    return { kind: "unavailable", rateLimited: skin.kind === "unavailable" && skin.rateLimited };
  }

  const { hash } = skin.value;
  if (hash === previous) {
    setSkin(name, hash, now);
    return { kind: "unchanged", hash };
  }
  if (hash !== null && !(await mcHeadsServes(hash))) {
    if (!warnedAboutHashes) {
      warnedAboutHashes = true;
      log.warn("skins", `mc-heads answered its default head for skin ${hash}; keeping name URLs for heads.`);
    }
    markSkinFailed(name, now);
    return { kind: "rejected", hash };
  }
  setSkin(name, hash, now);
  log.info("skins", `Skin of ${name} is now ${hash ?? "the default skin"}.`);
  return { kind: "changed", hash, previous };
}

/** Asks Mojang for a player's current skin and stores the answer. Concurrent calls for one player share one lookup. */
export function resolveSkin(name: string, { now = Date.now() }: { now?: number } = {}): Promise<ResolveOutcome> {
  const key = name.toLowerCase();
  const running = inFlight.get(key);
  if (running) return running;
  const run = lookup(name, now)
    .catch((err: unknown): ResolveOutcome => {
      log.warn("skins", `Skin lookup for ${name} failed: ${errMsg(err)}`);
      markSkinFailed(name, now);
      return { kind: "unavailable", rateLimited: false };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

export interface FreshOptions {
  /** Ask Mojang only when the stored check is older than this. */
  maxAgeMs: number;
  /** Stop waiting after this long; the lookup still finishes in the background. */
  timeoutMs: number;
  now?: number;
}

/** True when the stored check is recent enough, or a failure is still cooling down. */
function recentEnough(name: string, maxAgeMs: number, now: number): boolean {
  const stored = getSkin(name);
  if (!stored) return false;
  if (stored.failedAt !== undefined && now - stored.failedAt < RETRY_AFTER_FAILURE_MS) return true;
  return stored.checkedAt > 0 && now - stored.checkedAt < maxAgeMs;
}

/**
 * Is there nothing to ask Mojang? A caller that would only wait for an answer
 * can skip the wait. A store that cannot be read counts as fresh: no wait.
 */
export function skinIsFresh(name: string, maxAgeMs: number, now: number = Date.now()): boolean {
  try {
    return recentEnough(name, maxAgeMs, now);
  } catch {
    return true;
  }
}

/** Resolves a player's skin unless it was checked recently or a failure is still cooling down. */
export async function ensureFreshSkin(name: string, options: FreshOptions): Promise<SkinOutcome> {
  const now = options.now ?? Date.now();
  if (recentEnough(name, options.maxAgeMs, now)) return { kind: "skipped" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<SkinOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "pending" }), options.timeoutMs);
  });
  try {
    return await Promise.race([resolveSkin(name, { now }), limit]);
  } finally {
    clearTimeout(timer);
  }
}

export interface SweepSummary {
  asked: number;
  changed: number;
  failed: number;
  skipped: number;
  /** True when Mojang asked us to slow down and the rest was left for the next sweep. */
  stoppedEarly: boolean;
}

/**
 * Refreshes the given players one at a time, `spacingMs` apart, each only if its
 * check is older than `maxAgeMs`. Stops at the first rate-limit answer.
 */
export async function refreshSkins(
  names: Iterable<string>,
  { maxAgeMs, spacingMs, timeoutMs = 20 * MS.second }: { maxAgeMs: number; spacingMs: number; timeoutMs?: number },
): Promise<SweepSummary> {
  const summary: SweepSummary = { asked: 0, changed: 0, failed: 0, skipped: 0, stoppedEarly: false };
  for (const name of names) {
    const outcome = await ensureFreshSkin(name, { maxAgeMs, timeoutMs });
    if (outcome.kind === "skipped") {
      summary.skipped += 1;
      continue;
    }
    summary.asked += 1;
    if (outcome.kind === "changed") summary.changed += 1;
    if (outcome.kind === "unavailable" || outcome.kind === "rejected" || outcome.kind === "pending") {
      summary.failed += 1;
    }
    if (outcome.kind === "unavailable" && outcome.rateLimited) {
      summary.stoppedEarly = true;
      break;
    }
    await sleep(spacingMs);
  }
  return summary;
}
