/**
 * How a ServerState is shown to a human, in one place.
 *
 * There are three surfaces that render it — `/status`, the auto-updating
 * status embed, and the downtime alerts — and before this they each carried
 * their own literal. That is how "🔴 Offline" ended up describing a server
 * that was running fine behind an unreachable API wrapper: the copy was
 * written once per call site, against a boolean, and never revisited.
 *
 * Labels come from the locale files so guild language still applies; the
 * emoji and colour do not, because they are not language.
 */
import { EmbedColor } from "./embedColors.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { ServerState, wrapperIsDown } from "@mcbot/schema/serverState.js";
import type { ServerHealth } from "@mcbot/schema/serverState.js";

export interface StateDisplay {
  emoji: string;
  /** Localised short label — "Online", "Not responding", "State unknown". */
  label: string;
  /** Embed accent for this state. */
  color: number;
  /**
   * A sentence explaining a state a user would otherwise misread, or null
   * when the label speaks for itself. Both non-null cases exist because the
   * label alone invites the wrong conclusion.
   */
  hint: string | null;
}

const DISPLAY: Record<ServerState, Omit<StateDisplay, "label" | "hint">> = {
  [ServerState.Online]: { emoji: "🟢", color: EmbedColor.Success },
  // Amber, not red: the server is up. Red here is what trained people to
  // read a lag spike as an outage.
  [ServerState.Unresponsive]: { emoji: "🟠", color: EmbedColor.Warning },
  [ServerState.Offline]: { emoji: "🔴", color: EmbedColor.Error },
  // Grey: we are reporting our own ignorance, not a server state.
  [ServerState.Unknown]: { emoji: "⚫", color: EmbedColor.Neutral },
};

const HINT_KEY: Partial<Record<ServerState, string>> = {
  [ServerState.Unresponsive]: "state.unresponsiveHint",
  [ServerState.Unknown]: "state.unknownHint",
};

export function describeState(state: ServerState): StateDisplay {
  const hintKey = HINT_KEY[state];
  return {
    ...DISPLAY[state],
    label: t(`state.${state}`),
    hint: hintKey ? t(hintKey) : null,
  };
}

/**
 * `describeState` for a whole health value, plus the second fact.
 *
 * The wrapper being down is not a server state, but it is not nothing either:
 * without it there are no controls, no log stream, no chat bridge, no stats.
 * So a server that is demonstrably fine still gets a note saying what is
 * broken — which is the message this whole change exists to get right. The
 * old code had one line for both facts and picked the wrong one.
 */
export function describeHealth(health: ServerHealth): StateDisplay {
  const display = describeState(health.state);
  if (!wrapperIsDown(health) || health.state === ServerState.Unknown) {
    return display;
  }
  return {
    ...display,
    // Keep the state's own emoji and label — the server really is online —
    // and colour it amber, because something still needs attention.
    color: EmbedColor.Warning,
    hint: t("state.wrapperDownHint"),
  };
}

/** "🟢 Online — 4/20 players", when the answering channel knew. */
export function describePlayers(health: ServerHealth): string | null {
  if (!health.players) return null;
  const { online, max, names, sampled } = health.players;
  const counts = `${online}/${max} players`;
  if (names.length === 0) return counts;
  // A ping's names are a capped sample, never the roster — say so rather than
  // letting a partial list read as "these are everyone".
  return sampled && names.length < online
    ? `${counts} — including ${names.join(", ")}`
    : `${counts} — ${names.join(", ")}`;
}

/** The one-line form used in list contexts: "🟢 Online". */
export function stateLine(state: ServerState): string {
  const { emoji, label } = describeState(state);
  return `${emoji} ${label}`;
}
