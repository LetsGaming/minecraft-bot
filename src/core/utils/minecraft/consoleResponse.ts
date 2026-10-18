/**
 * Reading a console command's answer back out of the server log.
 *
 * When the wrapper has no RCON response channel, the reply to `seed` or
 * `data get entity` only exists as a log line, and the log also carries
 * everything players type. A match must therefore be anchored to the
 * server's own console output: the body has to start immediately after the
 * `[time] [Server thread/INFO]: ` prefix, so a chat line (`<name> ...`), a
 * `/say` line (`[Server] ...`) or an RCON echo cannot supply it.
 */
import { isValidMcName } from "../sanitize.js";

// Minecraft 26.3 writes what the server sends as chat behind `System chat: `.
const SERVER_THREAD_PREFIX =
  /^\[[^\]\n]*\]\s*\[[^\]\n]*\bServer thread\/INFO\b[^\]\n]*\](?:\s*\[[^\]\n]*\])*:\s+(?:System chat:\s+)?/;

/** Message bodies of the server-emitted lines in a log tail, newest first. */
export function serverLineBodies(tail: string): string[] {
  const bodies: string[] = [];
  for (const raw of tail.split(/\r?\n/)) {
    const m = SERVER_THREAD_PREFIX.exec(raw);
    if (m) bodies.push(raw.slice(m[0].length).trimEnd());
  }
  return bodies.reverse();
}

/** The newest server-emitted line whose body matches `body`. */
export function newestServerMatch(
  tail: string,
  body: RegExp,
): RegExpExecArray | null {
  for (const line of serverLineBodies(tail)) {
    const m = body.exec(line);
    if (m) return m;
  }
  return null;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

export function isSignedInt64(value: string): boolean {
  if (!/^-?\d+$/.test(value)) return false;
  const n = BigInt(value);
  return n >= INT64_MIN && n <= INT64_MAX;
}

/** Answer line of `data get entity <player> <path>`: the payload after the colon. */
export function entityDataPattern(player: string): RegExp {
  // An invalid name matches nothing instead of being silently altered into
  // some other player's name.
  if (!isValidMcName(player)) return /(?!)/;
  const name = player.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${name} has the following entity data: (.*)$`, "i");
}

export const SEED_BODY = /^Seed: \[(-?\d+)\]$/;
