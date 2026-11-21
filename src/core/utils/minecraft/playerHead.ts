/**
 * mc-heads.net renders a Minecraft player's head from a name. One function
 * builds the URL for every place that shows a head (embed author icons, the
 * chat-bridge webhook avatar, leaderboard thumbnails, the dashboard), so a
 * player has the same image everywhere.
 *
 * Never by UUID. Heads used to go by UUID when the bot had one cached and by
 * name otherwise, so the same player got two URLs depending on whether the
 * cache was warm, and the two showed different skins after a skin change.
 * The names come from the server log or the server's own lists, which carry
 * the player's current name.
 *
 * The URL names the player's skin by its Mojang texture hash once the skin
 * resolver has read it (see skinResolver.ts). A hash names the exact image, so
 * mc-heads cannot serve a stale one under it; mc-heads keys by name and by UUID
 * go stale (a default head cached once, an old skin kept after a change), and
 * the name URL is only the fallback for a player whose hash is not known.
 *
 * Either URL carries a version (`?v=`): the UTC day, plus the player's manual
 * refresh token when there is one. Discord keeps each image it fetched under
 * its URL, so a new version makes Discord fetch again. mc-heads' own CDN
 * ignores the query string (`probeHead` reports the age of its copy).
 */
import { MS } from "@mcbot/schema/time.js";
import { headKeys } from "../stores/headStore.js";

const MC_HEADS_BASE_URL = "https://mc-heads.net";
const PROBE_USER_AGENT = "LetsGaming/minecraft-bot (head probe)";
const PROBE_TIMEOUT_MS = 8 * MS.second;
const PROBE_MAX_BYTES = 64 * 1024;

function storedKeys(player: string): { hash: string | null; bump: string | null } {
  try {
    return headKeys(player);
  } catch {
    // A head is decoration: a store that cannot be read must not break a reply.
    return { hash: null, bump: null };
  }
}

function versionOf(bump: string | null, now: number): string {
  const day = Math.floor(now / MS.day).toString();
  return bump ? `${day}.${bump}` : day;
}

/** The version part of a player's head URL. */
export function headVersion(player: string, now = Date.now()): string {
  return versionOf(storedKeys(player).bump, now);
}

/** URL of a head render by skin hash: the image is named by its content, so it is never stale. */
export function skinHeadUrl(hash: string, version?: string): string {
  return `${MC_HEADS_BASE_URL}/avatar/${hash}/64${version ? `?v=${version}` : ""}`;
}

/**
 * URL of a player's 64px head render. By the skin hash when one is stored,
 * otherwise by name (URL-encoded defensively).
 */
export function playerHeadUrl(player: string, now = Date.now()): string {
  const { hash, bump } = storedKeys(player);
  const version = versionOf(bump, now);
  if (hash) return skinHeadUrl(hash, version);
  return `${MC_HEADS_BASE_URL}/avatar/${encodeURIComponent(player)}/64?v=${version}`;
}

export interface HeadProbe {
  /** False when mc-heads did not answer with an image. */
  ok: boolean;
  status: number | null;
  bytes: number | null;
  /** Seconds the CDN has held this image, from its `Age` header. */
  ageSeconds: number | null;
  /** The CDN's own word for it: HIT, MISS, REVALIDATED, ... */
  cache: string | null;
}

/** Fetches a player's head from mc-heads right now and reports how old the CDN copy is. */
export async function probeHead(player: string, now = Date.now()): Promise<HeadProbe> {
  const failed: HeadProbe = { ok: false, status: null, bytes: null, ageSeconds: null, cache: null };
  try {
    const res = await fetch(playerHeadUrl(player, now), {
      headers: { "User-Agent": PROBE_USER_AGENT },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const body = res.ok ? await res.arrayBuffer() : null;
    const age = Number(res.headers.get("age"));
    return {
      ok: res.ok && type.startsWith("image/") && body !== null && body.byteLength <= PROBE_MAX_BYTES,
      status: res.status,
      bytes: body?.byteLength ?? null,
      ageSeconds: res.headers.has("age") && Number.isFinite(age) ? age : null,
      cache: res.headers.get("cf-cache-status"),
    };
  } catch {
    return failed;
  }
}
