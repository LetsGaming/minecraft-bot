/**
 * How a ServerState is shown to a human, in one place: `/status`, `/uptime`,
 * the auto-updating status embed and the downtime alerts all read it here.
 *
 * Labels come from the locale files so guild language still applies; the
 * circle and colour do not, because they are not language. The colour is the
 * state's status role from `@mcbot/schema`, the same as the dashboard chip.
 */
import { EmbedColor } from "./embedColors.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { ServerState, wrapperIsDown } from "@mcbot/schema/serverState.js";
import type { ServerHealth } from "@mcbot/schema/serverState.js";
import { statusEmbedColor } from "@mcbot/schema/status.js";

export interface StateDisplay {
  emoji: string;
  /** Localised short label: "Online", "Not responding", "State unknown". */
  label: string;
  /** Embed accent for this state. */
  color: number;
  /** How much attention the state needs; higher is worse. See `stateSeverity`. */
  severity: number;
  /**
   * A sentence explaining a state a user would otherwise misread, or null
   * when the label speaks for itself.
   */
  hint: string | null;
}

const CIRCLE: Record<ServerState, string> = {
  [ServerState.Online]: "🟢",
  [ServerState.Unresponsive]: "🟡",
  [ServerState.Offline]: "🔴",
  [ServerState.Unknown]: "⚪",
};

/** The one leading emoji a title may carry: the server state's circle. */
export function statusCircle(state: ServerState): string {
  return CIRCLE[state];
}

const SEVERITY: Record<ServerState, number> = {
  [ServerState.Online]: 0,
  [ServerState.Unknown]: 1,
  [ServerState.Unresponsive]: 2,
  [ServerState.Offline]: 3,
};

/** Higher is worse: online, unknown, needs a look, offline. */
export function stateSeverity(state: ServerState): number {
  return SEVERITY[state];
}

const HINT_KEY: Partial<Record<ServerState, string>> = {
  [ServerState.Unresponsive]: "state.unresponsiveHint",
  [ServerState.Unknown]: "state.unknownHint",
};

export function describeState(state: ServerState): StateDisplay {
  const hintKey = HINT_KEY[state];
  return {
    emoji: statusCircle(state),
    color: statusEmbedColor(state),
    severity: stateSeverity(state),
    label: t(`state.${state}`),
    hint: hintKey ? t(hintKey) : null,
  };
}

/**
 * `describeState` for a whole health value, plus the second fact.
 *
 * The wrapper being down is not a server state, but without it there are no
 * controls, no log stream, no chat bridge and no stats. A server that is
 * demonstrably fine keeps its own circle and label and is coloured amber,
 * with a note saying what is broken.
 */
export function describeHealth(health: ServerHealth): StateDisplay {
  const display = describeState(health.state);
  if (!wrapperIsDown(health) || health.state === ServerState.Unknown) {
    return display;
  }
  return {
    ...display,
    color: EmbedColor.Warning,
    severity: Math.max(display.severity, stateSeverity(ServerState.Unresponsive)),
    hint: t("state.wrapperDownHint"),
  };
}

/** "4/20 players, Steve, Alex", when the answering channel knew. */
export function describePlayers(health: ServerHealth): string | null {
  if (!health.players) return null;
  const { online, max, names, sampled } = health.players;
  const counts = t("state.playerCount", { online, max });
  if (names.length === 0) return counts;
  // A ping's names are a capped sample, never the roster: say so rather than
  // letting a partial list read as "these are everyone".
  return sampled && names.length < online
    ? t("state.playersIncluding", { counts, names: names.join(", ") })
    : t("state.playersNamed", { counts, names: names.join(", ") });
}
