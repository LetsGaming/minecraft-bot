/**
 * Event-driven tips: mentioning a command at the moment it becomes useful.
 *
 * The join nudge covers "you have not started yet". This covers everything
 * after: a thing just happened, and there is a command that answers it. A
 * player who has just died cares where; a player who was just killed by
 * another player may want to report it. Neither will go looking, and a tip
 * arriving at any other moment is noise.
 *
 * Adding one is a `EVENT_TIPS` entry, see docs/admin/automated-features.md.
 * Nothing else needs changing: the ledger, the give-up rule and the
 * disabled-command check are handled here for every tip.
 *
 * The disabled-command check matters more than it looks. An operator who
 * turns `report` off has said they do not want reports; advertising it
 * anyway is worse than never mentioning it, because the player follows the
 * advice and gets told the command does not exist.
 *
 * Delivery is in game, always. A tip about an in-game command sent through
 * Discord would reach only players who have linked, and an unlinked player
 * is exactly who needs to be told that `!deathpos` exists.
 */
import { resolveCommandPolicy } from "../commands/commandPolicy.js";
import {
  loadSuggestionLedger,
  getSuggestionRecord,
  recordSuggestion,
  mcSubject,
  type SuggestionRecord,
} from "../stores/suggestionLedger.js";
import { t } from "../i18n.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import type { ServerInstance } from "../server/server.js";
import { whisper } from "./serverMessages.js";

/** Things that happen in game which a command has an answer for. */
export type GameEvent = "death" | "death-by-player";

export interface EventTip {
  /** Stable id, the ledger key. Not the command name: a command can be
   *  advertised by more than one event, and each should stop separately. */
  id: string;
  event: GameEvent;
  /**
   * The command this tip points at. Checked against command policy before
   * the tip is shown, so a disabled command is never advertised.
   */
  advertises: string;
  /** i18n key for the line. */
  textKey: string;
  /** Mentions before it stops. Two is enough to be noticed, not to nag. */
  maxMentions?: number;
}

export const DEFAULT_MAX_MENTIONS = 2;

export const EVENT_TIPS: EventTip[] = [
  {
    id: "deathpos",
    event: "death",
    advertises: "deathpos",
    textKey: "deathpos.hint",
  },
  {
    // A PvP death is the only moment !report is obvious. Deliberately
    // separate from the plain death tip so a player who dies to mobs all
    // week never sees it, and someone killed by another player is not
    // spending one of their deathpos mentions on it.
    id: "report-pvp",
    event: "death-by-player",
    advertises: "report",
    textKey: "report.hint",
  },
];

export interface EventTipContext {
  /** Minecraft name, the ledger subject. */
  player: string;
  serverId: string;
}

/**
 * May this command be advertised here?
 *
 * Two ways the answer is no: the operator disabled it, or it is admin-only
 * and the audience is an ordinary player. Both would send someone to a
 * command that rejects them.
 */
export function isAdvertisable(
  command: string,
  scope: { guildId?: string; serverId?: string } = {},
  audienceIsAdmin = false,
): boolean {
  const policy = resolveCommandPolicy(command, scope);
  if (!policy.enabled) return false;
  if (policy.adminOnly && !audienceIsAdmin) return false;
  return true;
}

/**
 * May this player be told about a suggestion once more?
 *
 * The give-up rule shared by tips and nudges: an explicit dismissal always
 * wins, then the mention cap, then (when given) the minimum gap since the
 * last mention. No record means nothing has been said yet.
 */
export function ledgerAllows(
  record: SuggestionRecord | null | undefined,
  limits: { maxMentions: number; cooldownMs?: number; now?: number },
): boolean {
  if (!record) return true;
  if (record.dismissed) return false;
  if (record.count >= limits.maxMentions) return false;
  if (
    limits.cooldownMs !== undefined &&
    (limits.now ?? Date.now()) - record.lastAt < limits.cooldownMs
  ) {
    return false;
  }
  return true;
}

/**
 * Whisper `text` and, only when it reached the server, run `record`. A failed
 * send must not spend one of the player's mentions.
 */
export async function whisperAndRecord(
  server: Pick<ServerInstance, "send">,
  player: string,
  text: string,
  record: () => Promise<void>,
): Promise<boolean> {
  if (!(await whisper(server, player, text))) return false;
  await record();
  return true;
}

/**
 * The line to append for this event, or null.
 *
 * Returns the text rather than sending it: the caller owns the delivery
 * channel (a DM, a whisper, a chat line) and knows how to batch it with
 * whatever else it was already saying.
 */
export async function tipForEvent(
  event: GameEvent,
  ctx: EventTipContext,
): Promise<{ tip: EventTip; text: string } | null> {
  try {
    const ledger = await loadSuggestionLedger();

    for (const tip of EVENT_TIPS) {
      if (tip.event !== event) continue;
      if (!isAdvertisable(tip.advertises, { serverId: ctx.serverId })) continue;

      const record = getSuggestionRecord(ledger, mcSubject(ctx.player), tip.id);
      if (!ledgerAllows(record, { maxMentions: tip.maxMentions ?? DEFAULT_MAX_MENTIONS })) {
        continue;
      }
      return { tip, text: t(tip.textKey) };
    }
    return null;
  } catch (err) {
    log.debug("tip", `Event tip for ${event} skipped: ${errMsg(err)}`);
    return null;
  }
}

/** Call once the tip has actually been delivered. */
export async function markEventTipSent(
  tip: EventTip,
  ctx: EventTipContext,
): Promise<void> {
  await recordSuggestion(mcSubject(ctx.player), tip.id);
}

/**
 * Select, whisper, and record, the whole thing, for callers that have a
 * server to talk through.
 *
 * Whispered rather than broadcast: the tip is about what *this* player just
 * did, and putting it in public chat would show everyone else a hint they
 * did not earn and cannot dismiss.
 *
 * Best-effort. A tip is the least important thing happening at the moment
 * somebody dies, and it must never interfere with the death handling around
 * it. Recorded only once the whisper reached the server, so a failed send
 * does not spend one of the player's mentions.
 */
export async function deliverEventTip(
  server: Pick<ServerInstance, "id" | "send">,
  event: GameEvent,
  player: string,
): Promise<EventTip | null> {
  const ctx: EventTipContext = { player, serverId: server.id };
  try {
    const selected = await tipForEvent(event, ctx);
    if (!selected) return null;

    const sent = await whisperAndRecord(server, player, selected.text, () =>
      markEventTipSent(selected.tip, ctx),
    );
    return sent ? selected.tip : null;
  } catch (err) {
    log.debug("tip", `Delivering ${event} tip to ${player} failed: ${errMsg(err)}`);
    return null;
  }
}
