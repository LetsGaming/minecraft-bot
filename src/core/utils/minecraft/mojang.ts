/**
 * Mojang API adapter, the one place the app talks to Mojang.
 *
 * Splits I/O from transformation (see external-integrations): `fetchMojangProfile`
 * does the network call behind a timeout, and `parseMojangProfile` narrows the
 * raw JSON to a domain `MojangProfile`. Callers get a validated value or `null`;
 * a changed upstream shape fails here at the boundary, not deep inside a command.
 */
import { fetchJson, type FetchFailure } from "../http.js";
import { MS } from "@mcbot/schema/time.js";
import type { MojangProfile } from "../../types/index.js";
import { isRecord } from "../objects.js";

const PROFILE_ENDPOINT =
  "https://api.mojang.com/users/profiles/minecraft";

/** A hung third-party API must not stall a command or the poll loop. */
const MOJANG_TIMEOUT_MS = 5 * MS.second;

/**
 * Narrow an unknown JSON body to a `MojangProfile`, or `null` if it doesn't
 * match. Kept pure so it is unit-testable without a network call.
 */
export function parseMojangProfile(raw: unknown): MojangProfile | null {
  if (!isRecord(raw)) return null;
  const { id, name } = raw;
  if (typeof id !== "string" || typeof name !== "string") return null;
  return { id, name };
}

/**
 * Look up a Minecraft account by username. Returns `null` when the name is
 * unknown (Mojang replies non-2xx), when the upstream is unreachable or times
 * out, or when the body is misshapen, callers surface their own "not found"
 * message. A `null` here is always "no usable profile", never a wrong one.
 */
export async function fetchMojangProfile(
  username: string,
): Promise<MojangProfile | null> {
  const result = await fetchJson(
    `${PROFILE_ENDPOINT}/${encodeURIComponent(username)}`,
    { timeoutMs: MOJANG_TIMEOUT_MS },
  );
  // Unknown name (404), upstream down, or a timeout all mean the same
  // thing to callers here: no usable profile.
  if (!result.ok) return null;
  return parseMojangProfile(result.value);
}

const SESSION_PROFILE_ENDPOINT =
  "https://sessionserver.mojang.com/session/minecraft/profile";

/**
 * What a Mojang lookup said. `unknown` is Mojang's own "no such account";
 * `unavailable` is any failure to get an answer, and `rateLimited` tells a
 * caller that it should stop asking for a while.
 */
export type MojangLookup<T> =
  | { kind: "found"; value: T }
  | { kind: "unknown" }
  | { kind: "unavailable"; rateLimited: boolean };

function lookupFailure(failure: FetchFailure): MojangLookup<never> {
  if (failure.kind === "status" && failure.status === 404) return { kind: "unknown" };
  return { kind: "unavailable", rateLimited: failure.kind === "status" && failure.status === 429 };
}

/** Like {@link fetchMojangProfile}, but an unknown name and a failed or rate-limited call are told apart. */
export async function lookupMojangProfile(username: string): Promise<MojangLookup<MojangProfile>> {
  const result = await fetchJson(`${PROFILE_ENDPOINT}/${encodeURIComponent(username)}`, {
    timeoutMs: MOJANG_TIMEOUT_MS,
  });
  if (!result.ok) return lookupFailure(result.failure);
  const profile = parseMojangProfile(result.value);
  return profile ? { kind: "found", value: profile } : { kind: "unavailable", rateLimited: false };
}

/** A player's skin: the texture hash, or `null` when the account has the default skin. */
export interface SkinTexture {
  hash: string | null;
}

const TEXTURE_HASH = /^[0-9a-f]{32,64}$/i;

/**
 * Narrow a session-server profile to the hash of its skin texture. The hash is
 * the last part of the skin's URL and names the exact image, so it changes
 * when the player changes skin. A profile without a skin texture is the
 * default skin (`hash: null`); a body that is not a profile is `null`.
 */
export function parseSkinTexture(raw: unknown): SkinTexture | null {
  if (!isRecord(raw) || !Array.isArray(raw["properties"])) return null;
  const property = raw["properties"].find(
    (p): p is Record<string, unknown> => isRecord(p) && p["name"] === "textures",
  );
  if (!property) return { hash: null };
  if (typeof property["value"] !== "string") return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(property["value"], "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(decoded)) return null;
  const skin = isRecord(decoded["textures"]) ? decoded["textures"]["SKIN"] : undefined;
  if (!isRecord(skin)) return { hash: null };
  const url = skin["url"];
  if (typeof url !== "string") return null;
  const hash = url.slice(url.lastIndexOf("/") + 1);
  return TEXTURE_HASH.test(hash) ? { hash: hash.toLowerCase() } : null;
}

/** The current skin of an account, from Mojang's session server (about one request a minute per account is allowed). */
export async function lookupMojangSkin(uuid: string): Promise<MojangLookup<SkinTexture>> {
  const result = await fetchJson(`${SESSION_PROFILE_ENDPOINT}/${encodeURIComponent(uuid)}`, {
    timeoutMs: MOJANG_TIMEOUT_MS,
  });
  if (!result.ok) return lookupFailure(result.failure);
  const skin = parseSkinTexture(result.value);
  return skin ? { kind: "found", value: skin } : { kind: "unavailable", rateLimited: false };
}

const VERSION_MANIFEST_ENDPOINT =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/**
 * Narrow Mojang's version manifest to its release ids, newest first (the
 * manifest's own order). Snapshots, betas and anything misshapen are dropped.
 */
export function parseReleaseVersions(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw["versions"])) return [];
  const ids: string[] = [];
  for (const entry of raw["versions"]) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "release" && typeof entry["id"] === "string") {
      ids.push(entry["id"]);
    }
  }
  return ids;
}

/** Released Minecraft versions, or `null` when Mojang cannot be reached or answers nonsense. */
export async function fetchReleaseVersions(): Promise<string[] | null> {
  const result = await fetchJson(VERSION_MANIFEST_ENDPOINT, {
    timeoutMs: MOJANG_TIMEOUT_MS,
  });
  if (!result.ok) return null;
  const ids = parseReleaseVersions(result.value);
  return ids.length > 0 ? ids : null;
}
