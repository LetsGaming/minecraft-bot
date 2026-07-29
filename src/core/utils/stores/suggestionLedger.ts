/**
 * What each player has already been told about — single owner of
 * kv_store["featureSuggestions"].
 *
 * Two things write here, and they are the same bookkeeping:
 *
 *   join nudges    in-game whispers about a feature the player has not
 *                  reached yet, keyed by Minecraft name
 *   follow-up hints  a button on a Discord reply offering the feature that
 *                  pairs with the one just used, keyed by Discord user ID
 *
 * Both need the same three answers — how often has this been offered, when
 * was the last time, and did they say no — so both use one ledger rather
 * than two stores that would drift.
 *
 * Subjects are namespaced (`mc:steve`, `discord:12345`) because the two
 * keyspaces overlap in principle and a collision would silence a real
 * suggestion. Minecraft names are lowercased: the trigger is a join line,
 * which carries a name, and re-offering to a renamed player is a trivial
 * cost against reading the usercache on every join.
 */
import { kvGet, kvUpdate } from "../../db/kv.js";

/** Features a player can be told about, in funnel order. */
export type NudgeKind = "link" | "daily";

/** A suggestion identity: the nudge kind, or a follow-up hint's id. */
export type SuggestionId = NudgeKind | (string & {});

export interface SuggestionRecord {
  /** How many times this has been offered. */
  count: number;
  /** Epoch ms of the most recent offer. */
  lastAt: number;
  /**
   * They said no. Permanent — an explicit refusal outranks any count or
   * cooldown, and asking again after it is the exact behaviour that makes
   * these features feel like nagging.
   */
  dismissed?: boolean;
}

export interface SuggestionLedger {
  version: 1;
  /** `<namespaced subject>` → suggestion id → history. */
  subjects: Record<string, Record<string, SuggestionRecord>>;
}

const KEY = "featureSuggestions";

/** Subject key for an in-game player. */
export const mcSubject = (player: string): string =>
  `mc:${player.toLowerCase()}`;

/** Subject key for a Discord user. */
export const discordSubject = (userId: string): string => `discord:${userId}`;

function emptyLedger(): SuggestionLedger {
  return { version: 1, subjects: {} };
}

function isLedger(raw: unknown): raw is SuggestionLedger {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    typeof (raw as { subjects?: unknown }).subjects === "object" &&
    (raw as { subjects?: unknown }).subjects !== null
  );
}

export async function loadSuggestionLedger(): Promise<SuggestionLedger> {
  const raw = kvGet<unknown>(KEY);
  return isLedger(raw) ? raw : emptyLedger();
}

export function getSuggestionRecord(
  ledger: SuggestionLedger,
  subject: string,
  id: SuggestionId,
): SuggestionRecord | null {
  return ledger.subjects[subject]?.[id] ?? null;
}

/** Record that a suggestion was offered. Atomic: concurrent joins can't lose one. */
export async function recordSuggestion(
  subject: string,
  id: SuggestionId,
  at: number = Date.now(),
): Promise<void> {
  kvUpdate<SuggestionLedger>(KEY, (current) => {
    const ledger = isLedger(current) ? current : emptyLedger();
    const forSubject = ledger.subjects[subject] ?? {};
    const existing = forSubject[id];
    forSubject[id] = {
      ...existing,
      count: (existing?.count ?? 0) + 1,
      lastAt: at,
    };
    ledger.subjects[subject] = forSubject;
    return ledger;
  });
}

/** Record an explicit "no thanks". Never offered again. */
export async function dismissSuggestion(
  subject: string,
  id: SuggestionId,
): Promise<void> {
  kvUpdate<SuggestionLedger>(KEY, (current) => {
    const ledger = isLedger(current) ? current : emptyLedger();
    const forSubject = ledger.subjects[subject] ?? {};
    forSubject[id] = {
      count: forSubject[id]?.count ?? 0,
      lastAt: forSubject[id]?.lastAt ?? Date.now(),
      dismissed: true,
    };
    ledger.subjects[subject] = forSubject;
    return ledger;
  });
}
