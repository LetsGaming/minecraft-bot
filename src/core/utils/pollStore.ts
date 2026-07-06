/**
 * Cross-platform polls — single owner of kv_store["polls"].
 *
 * One open poll per server at a time. A poll normally binds to exactly
 * one server instance (the guild-scoping semantics of resolveServer
 * decide which); span polls list several instances in `serverIds` with a
 * merged tally, in-game announcements on each instance, and the
 * one-open-poll invariant enforced per PARTICIPATING server. Votes are a
 * flat voterKey → optionIndex map:
 *
 *   "d:<discordId>"   Discord button vote
 *   "m:<lower name>"  in-game !vote from an UNLINKED player
 *
 * In-game votes from linked players resolve to their `d:` key via
 * linkUtils, so nobody votes twice across platforms — the dedupe the
 * plan calls for. Re-voting overwrites (changing your mind is allowed).
 */
import { kvGet, kvSet } from "../db/kv.js";

/** Closed-poll history kept per store (open polls are never trimmed). */
export const MAX_CLOSED_POLLS = 50;

export const MAX_POLL_OPTIONS = 5;
export const MIN_POLL_OPTIONS = 2;

export interface Poll {
  id: string;
  question: string;
  options: string[];
  guildId: string | null;
  channelId: string;
  messageId: string;
  /** Primary server (first participant) — kept for pre-span polls. */
  serverId: string;
  /**
   * All participating servers of a span poll. Absent on single-server
   * polls (including every poll created before span mode existed);
   * always read through pollServerIds().
   */
  serverIds?: string[];
  createdBy: string;
  createdById: string;
  createdAt: number;
  endsAt: number;
  /** voterKey → option index */
  votes: Record<string, number>;
  status: "open" | "closed";
}

export interface PollStore {
  version: 1;
  polls: Poll[];
}

function isV1Store(raw: unknown): raw is PollStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    Array.isArray((raw as { polls?: unknown }).polls)
  );
}

export async function loadPollStore(): Promise<PollStore> {
  const raw = kvGet<unknown>("polls");
  if (isV1Store(raw)) return raw;
  return { version: 1, polls: [] };
}

export async function savePollStore(store: PollStore): Promise<void> {
  // Trim closed history; open polls always survive.
  const open = store.polls.filter((p) => p.status === "open");
  const closed = store.polls
    .filter((p) => p.status === "closed")
    .slice(-MAX_CLOSED_POLLS);
  store.polls = [...closed, ...open].sort((a, b) => a.createdAt - b.createdAt);
  kvSet("polls", store);
}

export function getPollById(store: PollStore, id: string): Poll | null {
  return store.polls.find((p) => p.id === id) ?? null;
}

/** Every server a poll runs on — [serverId] for pre-span polls. */
export function pollServerIds(poll: Poll): string[] {
  return poll.serverIds && poll.serverIds.length > 0
    ? poll.serverIds
    : [poll.serverId];
}

export function getOpenPollForServer(
  store: PollStore,
  serverId: string,
): Poll | null {
  return (
    store.polls.find(
      (p) => p.status === "open" && pollServerIds(p).includes(serverId),
    ) ?? null
  );
}

export function voterKeyForDiscord(discordId: string): string {
  return `d:${discordId}`;
}

/**
 * Voter key for an in-game vote: linked players collapse onto their
 * Discord key so a linked account can't vote once per platform.
 */
export function voterKeyForMc(
  mcName: string,
  linkedAccounts: Record<string, string>,
): string {
  const lower = mcName.toLowerCase();
  const discordId = Object.entries(linkedAccounts).find(
    ([, name]) => name.toLowerCase() === lower,
  )?.[0];
  return discordId ? voterKeyForDiscord(discordId) : `m:${lower}`;
}

/** Vote counts per option index. */
export function tallyPoll(poll: Poll): number[] {
  const counts = poll.options.map(() => 0);
  for (const idx of Object.values(poll.votes)) {
    if (idx >= 0 && idx < counts.length) counts[idx]!++;
  }
  return counts;
}
