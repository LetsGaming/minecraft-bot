/**
 * Offering the feature that pairs with the one just used.
 *
 * The join nudge tells a player a feature exists. This is the other half:
 * at the moment someone *uses* a feature, the related one stops being an
 * abstract item on a list and becomes an obvious next step. Someone who has
 * just claimed a daily reward is exactly the person who wants a reminder
 * when the next one is ready — and they will never go looking for
 * `/daily-reminder` on their own, because they do not know it exists.
 *
 * Three properties make this cheap for the player rather than more noise:
 *
 *   It is a button      One tap. No command name to remember, nothing to
 *                       type, no options to choose between. The cost of
 *                       saying yes is lower than the cost of reading the
 *                       sentence explaining it.
 *
 *   It is one offer     Never a list of related features. At most one hint
 *                       rides along on a reply, and only when the reply
 *                       itself succeeded.
 *
 *   "No thanks" is final  Dismissal is permanent, and outranks the count
 *                       and cooldown. Asking again after an explicit
 *                       refusal is what turns a helpful hint into nagging.
 *
 * Adding a pair is a `HINTS` entry: say when it applies, what the button
 * says, and what pressing it does. Nothing else needs to change.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadSuggestionLedger,
  getSuggestionRecord,
  recordSuggestion,
  discordSubject,
  type SuggestionLedger,
} from "@mcbot/core/utils/stores/suggestionLedger.js";
import {
  loadClaimedStore,
  getServerClaims,
  saveClaimedStore,
} from "@mcbot/core/utils/stores/dailyStore.js";
import {
  loadWatchStore,
  saveWatchStore,
  newWatchId,
} from "@mcbot/core/utils/stores/watchStore.js";
import {
  getServerInstance,
  getAllInstances,
} from "@mcbot/core/utils/server/server.js";
import { resolveServer } from "../guild/guildRouter.js";
import { isAdvertisable } from "@mcbot/core/utils/minecraft/eventTips.js";
import { isServerAdmin, getMemberRoleIds } from "../../commands/middleware.js";
import { loadConfig } from "@mcbot/core/config.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

/** Offers of one hint to one user before it stops being mentioned. */
export const MAX_HINT_OFFERS = 2;

/** customId prefix, stable across restarts — these outlive any collector. */
export const HINT_PREFIX = "hint";

export interface HintContext {
  userId: string;
  serverId: string;
  /** For the command-policy check — a guild may disable what global allows. */
  guildId?: string | null;
  /** Admin-only companions are only offered to admins. */
  isAdmin?: boolean;
}

/**
 * Two shapes, because features relate to each other in two ways.
 *
 *   action   The companion is something that can be switched on for this
 *            user, so the hint is a button that does it. One tap, no
 *            command to learn. Use this whenever it is possible.
 *
 *   mention  The companion is just another command — nothing to toggle.
 *            A button that silently ran a second command would be a
 *            surprise, so this appends one sentence naming it instead.
 *            Weaker, and only worth it where the second command genuinely
 *            answers the question the first one raises.
 */
interface HintBase {
  /** Stable id: goes in the customId and the ledger. */
  id: string;
  /** The command whose reply this rides along on. */
  after: string;
  /**
   * The command this hint points at. Checked against command policy, so a
   * companion the operator disabled is never offered — pressing the button
   * or following the tip would otherwise fail.
   */
  advertises: string;
  /**
   * Is this worth offering right now? Returns false when the companion is
   * already on, or when the reply did not raise the question — offering
   * something already enabled reads as the bot not knowing its own state.
   */
  applies: (ctx: HintContext) => Promise<boolean>;
}

export interface ActionHint extends HintBase {
  kind: "action";
  /** i18n key for the button label. */
  labelKey: string;
  /** i18n key for the confirmation shown after pressing it. */
  confirmKey: string;
  /** Do the thing. */
  apply: (ctx: HintContext) => Promise<void>;
}

export interface MentionHint extends HintBase {
  kind: "mention";
  /** i18n key for the single line appended to the reply. */
  textKey: string;
}

export type FollowUpHint = ActionHint | MentionHint;

export const HINTS: FollowUpHint[] = [
  {
    kind: "action",
    // Their reminder only ever fired for people who had already claimed AND
    // found /daily-reminder — so the people most likely to want it were the
    // least likely to hear about it. This closes that loop.
    id: "daily-reminder",
    after: "daily",
    advertises: "daily-reminder",
    labelKey: "hint.dailyReminder.label",
    confirmKey: "hint.dailyReminder.confirm",
    applies: async ({ userId, serverId }) => {
      const store = await loadClaimedStore();
      return getServerClaims(store, serverId)[userId]?.remind !== true;
    },
    apply: async ({ userId, serverId }) => {
      const store = await loadClaimedStore();
      const claimed = getServerClaims(store, serverId);
      const existing = claimed[userId];
      claimed[userId] = {
        lastClaim: existing?.lastClaim ?? 0,
        currentStreak: existing?.currentStreak ?? 0,
        bonusStreak: existing?.bonusStreak ?? 0,
        longestStreak: existing?.longestStreak ?? 0,
        rewards: existing?.rewards ?? [],
        ...existing,
        remind: true,
      };
      await saveClaimedStore(store);
    },
  },
  {
    // The reply that raises the question answers it: a server reported
    // down is the one moment someone wants to be told when it is back,
    // and /watch is invisible until then.
    kind: "action",
    id: "watch-server",
    after: "status",
    advertises: "watch",
    labelKey: "hint.watchServer.label",
    confirmKey: "hint.watchServer.confirm",
    applies: async ({ userId, serverId }) => {
      // Only when the server is actually down, and only if they are not
      // already waiting on it.
      const server = getServerInstance(serverId);
      if (!server) return false;
      const health = await server.getHealth().catch(() => null);
      if (!health || health.state === "online") return false;

      const store = await loadWatchStore();
      return !store.watches.some(
        (w) => w.userId === userId && w.kind === "server" && w.serverId === serverId,
      );
    },
    apply: async ({ userId, serverId }) => {
      const store = await loadWatchStore();
      store.watches.push({
        id: newWatchId(),
        userId,
        kind: "server",
        serverId,
        createdAt: Date.now(),
      });
      await saveWatchStore(store);
    },
  },
  {
    // /stats answers "how much have I done"; the immediate next question
    // is "compared to whom", which is exactly /leaderboard.
    kind: "mention",
    id: "stats-leaderboard",
    after: "stats",
    advertises: "leaderboard",
    textKey: "hint.statsLeaderboard",
    applies: () => Promise.resolve(true),
  },
  {
    // /playtime says how long; /activity says when — the natural
    // follow-up for anyone trying to find other players online.
    kind: "mention",
    id: "playtime-activity",
    after: "playtime",
    advertises: "activity",
    textKey: "hint.playtimeActivity",
    applies: () => Promise.resolve(true),
  },
  {
    // A seed is only useful with something that reads it.
    kind: "mention",
    id: "seed-chunkbase",
    after: "seed",
    advertises: "chunkbase",
    textKey: "hint.seedChunkbase",
    applies: () => Promise.resolve(true),
  },
];

export function findHint(id: string): FollowUpHint | null {
  return HINTS.find((h) => h.id === id) ?? null;
}

/** Follow-up hints share the featureNudges switch — one setting, one idea. */
function hintsEnabled(): boolean {
  try {
    return loadConfig().featureNudges?.enabled ?? true;
  } catch {
    return false;
  }
}

/** Has this user exhausted or refused this hint? */
export function hintIsAvailable(
  ledger: SuggestionLedger,
  userId: string,
  hintId: string,
): boolean {
  const record = getSuggestionRecord(ledger, discordSubject(userId), hintId);
  if (!record) return true;
  if (record.dismissed) return false;
  return record.count < MAX_HINT_OFFERS;
}

/**
 * The one hint to offer after `command`, or null.
 *
 * Ledger and applicability are checked in that order because the ledger is
 * one read while `applies` may hit a store per hint.
 */
export async function selectHint(
  command: string,
  ctx: HintContext,
): Promise<FollowUpHint | null> {
  if (!hintsEnabled()) return null;
  const ledger = await loadSuggestionLedger();

  for (const hint of HINTS) {
    if (hint.after !== command) continue;
    if (
      !isAdvertisable(
        hint.advertises,
        { guildId: ctx.guildId ?? undefined, serverId: ctx.serverId },
        ctx.isAdmin ?? false,
      )
    ) {
      continue;
    }
    if (!hintIsAvailable(ledger, ctx.userId, hint.id)) continue;
    if (!(await hint.applies(ctx))) continue;
    return hint;
  }
  return null;
}

/**
 * The button pair for a hint.
 *
 * The user id is baked into the customId so a bystander cannot press
 * someone else's button — these replies are not always ephemeral, and the
 * action writes to the invoker's record.
 */
export function buildHintRow(
  hint: ActionHint,
  ctx: HintContext,
): ActionRowBuilder<ButtonBuilder> {
  const suffix = `${hint.id}:${ctx.serverId}:${ctx.userId}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${HINT_PREFIX}:yes:${suffix}`)
      .setLabel(t(hint.labelKey))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${HINT_PREFIX}:no:${suffix}`)
      .setLabel(t("hint.noThanks"))
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Attach a hint to a command's reply, if one applies.
 *
 * Best-effort and always last: the command has already answered, and a
 * failure here must not turn a successful claim into an error. Called
 * after the reply so a command that throws never advertises anything.
 */
export async function attachFollowUpHint(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    // Which server the reply was about. Commands that take no server still
    // get a context, because the ledger and most `applies` checks only
    // need the user — the default instance is a reasonable stand-in and
    // hints that truly depend on the server check it themselves.
    let serverId: string;
    try {
      serverId = resolveServer(interaction).id;
    } catch {
      serverId = getAllInstances()[0]?.id ?? "";
    }
    if (!serverId) return;

    const ctx: HintContext = {
      userId: interaction.user.id,
      serverId,
      guildId: interaction.guild?.id ?? null,
      isAdmin: isServerAdmin(
        interaction.user.id,
        getMemberRoleIds(interaction),
        interaction.guild?.id,
      ),
    };
    const hint = await selectHint(interaction.commandName, ctx);
    if (!hint) return;

    // PATCH semantics: sending only the field being changed leaves the
    // rest of the reply alone.
    if (hint.kind === "action") {
      await interaction.editReply({ components: [buildHintRow(hint, ctx)] });
    } else {
      // A mention has nothing to press, so it goes in a follow-up the
      // user can ignore rather than rewriting the answer they asked for.
      await interaction.followUp({
        content: t(hint.textKey),
        flags: MessageFlags.Ephemeral,
      });
    }
    await recordSuggestion(discordSubject(ctx.userId), hint.id);
  } catch (err) {
    log.debug(
      "hint",
      `Follow-up hint for /${interaction.commandName} skipped: ${errMsg(err)}`,
    );
  }
}
