/**
 * Mojang API adapter — the one place the app talks to Mojang.
 *
 * Splits I/O from transformation (see external-integrations): `fetchMojangProfile`
 * does the network call behind a timeout, and `parseMojangProfile` narrows the
 * raw JSON to a domain `MojangProfile`. Callers get a validated value or `null`;
 * a changed upstream shape fails here at the boundary, not deep inside a command.
 */
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
  let res: Response;
  try {
    res = await fetch(`${PROFILE_ENDPOINT}/${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(MOJANG_TIMEOUT_MS),
    });
  } catch {
    // Timeout or network failure — degrade to "not found" for the caller.
    return null;
  }
  if (!res.ok) return null;
  return parseMojangProfile(await res.json());
}
