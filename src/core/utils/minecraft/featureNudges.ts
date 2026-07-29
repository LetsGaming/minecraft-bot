/**
 * Telling players that `/link` and `/daily` exist.
 *
 * The problem this solves: the chat bridge is the only feature with real
 * traffic, because it needs no learning. Everything else starts with a
 * Discord command a player has never been shown, so it is invisible —
 * invisible enough that the operator of this bot did not know `!waypoint
 * del` existed either. Documentation does not fix that; nothing reads it at
 * the moment it would matter.
 *
 * What this does instead: when a player joins, whisper them about exactly
 * one thing they are missing. Constraints, in order of importance:
 *
 *   One at a time      Never two nudges in one session, and never a list.
 *                      A menu of features is what causes the paralysis this
 *                      is meant to cure; a menu of one is not a menu.
 *
 *   Only what's next   `/daily` requires a linked account, so the funnel is
 *                      strictly link → daily. A player is only ever told
 *                      about the step actually in front of them, and never
 *                      about a feature they already use.
 *
 *   It gives up        After MAX_NUDGES_PER_FEATURE, that feature is never
 *                      mentioned again. Someone told three times who has
 *                      not linked is not an uninformed player, they are an
 *                      uninterested one, and continuing is nagging.
 *
 *   Event-triggered    The trigger is a join line, not message content.
 *                      Reacting to what players type would mean matching
 *                      words, which silently makes the feature English-only.
 */
import {
  loadSuggestionLedger,
  getSuggestionRecord,
  recordSuggestion,
  mcSubject,
  type NudgeKind,
  type SuggestionLedger,
} from "../stores/suggestionLedger.js";
import {
  isLinked,
  findDiscordIdByMcName,
  loadLinkedAccountsOrEmpty,
} from "../stores/linkUtils.js";
import { loadClaimedStore, getServerClaims } from "../stores/dailyStore.js";
import { loadConfig } from "../../config.js";
import { t } from "../i18n.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import type { ServerInstance } from "../server/server.js";

/** Stop after this many mentions of one feature, ever. */
export const MAX_NUDGES_PER_FEATURE = 3;

/** Minimum gap between two mentions of the same feature to one player. */
export const NUDGE_COOLDOWN_MS = 48 * 60 * 60 * 1000;

/**
 * How long after joining to whisper.
 *
 * Long enough that the player has finished loading and the join spam has
 * scrolled past — a message delivered into a loading screen is a message
 * nobody read.
 */
export const NUDGE_DELAY_MS = 45_000;

export interface NudgeSettings {
  enabled: boolean;
  maxPerFeature: number;
  cooldownMs: number;
}

export function nudgeSettings(): NudgeSettings {
  let cfg;
  try {
    cfg = loadConfig().featureNudges;
  } catch {
    return {
      enabled: false, // config unreadable: say nothing rather than guess
      maxPerFeature: MAX_NUDGES_PER_FEATURE,
      cooldownMs: NUDGE_COOLDOWN_MS,
    };
  }
  return {
    enabled: cfg?.enabled ?? true,
    maxPerFeature: cfg?.maxPerFeature ?? MAX_NUDGES_PER_FEATURE,
    cooldownMs: (cfg?.cooldownHours ?? 48) * 60 * 60 * 1000,
  };
}

/** What the player has already got, as far as nudging is concerned. */
export interface PlayerProgress {
  linked: boolean;
  hasClaimedDaily: boolean;
}

/**
 * Which nudge — if any — this player should get right now.
 *
 * Pure: every input is passed in, so the policy can be tested without a
 * server, a store, or a clock.
 */
export function chooseNudge(
  player: string,
  progress: PlayerProgress,
  ledger: SuggestionLedger,
  settings: NudgeSettings,
  now: number = Date.now(),
): NudgeKind | null {
  if (!settings.enabled) return null;

  // Funnel order. The first unmet step is the only candidate — telling
  // someone about /daily before they can use it is noise.
  const candidate: NudgeKind | null = !progress.linked
    ? "link"
    : !progress.hasClaimedDaily
      ? "daily"
      : null;
  if (!candidate) return null;

  const record = getSuggestionRecord(ledger, mcSubject(player), candidate);
  if (!record) return candidate;
  // An explicit refusal outranks the count and the cooldown.
  if (record.dismissed) return null;
  if (record.count >= settings.maxPerFeature) return null;
  if (now - record.lastAt < settings.cooldownMs) return null;
  return candidate;
}

/** Read the two facts chooseNudge needs about a player. */
export async function readProgress(
  serverId: string,
  player: string,
): Promise<PlayerProgress> {
  const linkedMap = await loadLinkedAccountsOrEmpty();
  const discordId = findDiscordIdByMcName(linkedMap, player);
  if (!discordId || !(await isLinked(discordId))) {
    return { linked: false, hasClaimedDaily: false };
  }

  const claimed = await loadClaimedStore();
  const entry = getServerClaims(claimed, serverId)[discordId];
  return {
    linked: true,
    hasClaimedDaily: !!entry?.lastClaim && entry.lastClaim > 0,
  };
}

/**
 * Decide and deliver. Best-effort throughout: a nudge is the least
 * important thing the bot does, and must never disturb a join.
 *
 * The message names the feature and says the nudge will stop, so a player
 * who is not interested knows they are not signing up for a nag.
 */
export async function maybeNudge(
  server: ServerInstance,
  player: string,
  now: number = Date.now(),
): Promise<NudgeKind | null> {
  const settings = nudgeSettings();
  if (!settings.enabled) return null;

  try {
    const [progress, ledger] = await Promise.all([
      readProgress(server.id, player),
      loadSuggestionLedger(),
    ]);

    const kind = chooseNudge(player, progress, ledger, settings, now);
    if (!kind) return null;

    const remaining =
      settings.maxPerFeature -
      ((getSuggestionRecord(ledger, mcSubject(player), kind)?.count ?? 0) + 1);

    await server.sendCommand(
      `/msg ${player} ${t(`nudge.${kind}`)}` +
        (remaining <= 0 ? ` ${t("nudge.lastTime")}` : ""),
    );
    await recordSuggestion(mcSubject(player), kind, now);
    log.debug("nudge", `${server.id}: told ${player} about ${kind}`);
    return kind;
  } catch (err) {
    log.debug("nudge", `Nudge for ${player} skipped: ${errMsg(err)}`);
    return null;
  }
}
