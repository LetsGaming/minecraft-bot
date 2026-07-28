/**
 * Mojang API adapter — the one place the app talks to Mojang.
 *
 * Splits I/O from transformation (see external-integrations): `fetchMojangProfile`
 * does the network call behind a timeout, and `parseMojangProfile` narrows the
 * raw JSON to a domain `MojangProfile`. Callers get a validated value or `null`;
 * a changed upstream shape fails here at the boundary, not deep inside a command.
 */
import { fetchJson } from "../http.js";
import type { MojangProfile } from "../../types/index.js";
import { isRecord } from "../objects.js";

const PROFILE_ENDPOINT =
  "https://api.mojang.com/users/profiles/minecraft";

/** A hung third-party API must not stall a command or the poll loop. */
const MOJANG_TIMEOUT_MS = 5_000;

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
 * out, or when the body is misshapen — callers surface their own "not found"
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
