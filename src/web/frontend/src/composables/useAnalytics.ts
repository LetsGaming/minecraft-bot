import { ref } from "vue";
import type {
  AnalyticsCaps,
  ActivityHour,
  BusyHour,
  CommandUsageResponse,
  CommandUsageRow,
  LeaderboardEntry,
  LeaderboardResponse,
  PlayerRow,
  PlayersResponse,
  ServerAnalyticsResponse,
  StatOption,
  UptimeStats,
} from "@mcbot/schema";
import { apiGet } from "../api";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";
import { t } from "../i18n";
import { latest } from "./useLoader";

/**
 * The bot's own history, for the dashboard.
 *
 * All of this already existed behind `/uptime`, `/activity` and the counters
 * `/help` uses. None of it is collected here; these are read paths, which is
 * why this composable is thin. The point was never new data, it was that a
 * time series rendered as block characters in a Discord embed is a table
 * pretending to be a chart.
 *
 * Every section takes the same range, and each backend store keeps a
 * different amount of history, so the response carries the range it actually
 * answered and `caps` says how far each section can go.
 */

export type {
  UptimeStats,
  ActivityHour,
  BusyHour,
  CommandUsageRow,
  PlayerRow,
  LeaderboardEntry,
  StatOption,
};

const DAY_HOURS = 24;

export function formatHours(hours: number): string {
  return hours % DAY_HOURS === 0 ? `${hours / DAY_HOURS}d` : `${hours}h`;
}

/**
 * The sentence for a section that answered less than was asked, or "" when it
 * covered the whole range.
 */
export function clampNote(requestedHours: number, appliedHours: number | null): string {
  if (appliedHours === null || appliedHours >= requestedHours) return "";
  return t("analytics.clampNote", { range: formatHours(appliedHours) });
}

/** One section's failed read: the message for the detail line and its kind. */
export interface SectionFailure {
  error: string;
  kind: LoadFailure;
}

function sectionFailure(err: unknown): SectionFailure {
  return { error: errorMessage(err), kind: loadFailure(err) };
}

export function useAnalytics() {
  const uptime = ref<UptimeStats | null>(null);
  const activity = ref<ActivityHour[]>([]);
  const activityRangeHours = ref<number | null>(null);
  const busiest = ref<BusyHour[]>([]);
  const commands = ref<CommandUsageRow[]>([]);
  const commandsRangeHours = ref<number | null>(null);
  const players = ref<PlayerRow[]>([]);
  const playersRangeHours = ref<number | null>(null);
  const sessionsKeptPerPlayer = ref<number | null>(null);
  const board = ref<LeaderboardEntry[]>([]);
  const boardTitle = ref("");
  const boardRangeHours = ref<number | null>(null);
  const boardBaselineAt = ref<number | null>(null);
  const boardHistoryShort = ref(false);
  const availableStats = ref<StatOption[]>([]);
  const caps = ref<AnalyticsCaps | null>(null);
  /**
   * Its own error, because the leaderboard is the only panel here that goes
   * through the wrapper (the world folder is where stats live). It failing
   * says nothing about uptime, sessions or command usage, so it must not
   * blank them.
   */
  const boardError = ref("");
  const boardFailure = ref<LoadFailure | null>(null);
  const boardLoading = ref(false);
  const loading = ref(false);
  /** False until the first load has answered, success or failure. */
  const loaded = ref(false);
  const error = ref("");
  const failure = ref<LoadFailure | null>(null);
  const usageFailure = ref<SectionFailure | null>(null);
  const playersFailure = ref<SectionFailure | null>(null);

  /**
   * Server history, players and command usage load independently.
   *
   * Command usage is global and server history is per server, so one failing
   * must not blank the other: a server that has never been polled still has
   * meaningful command numbers, and vice versa.
   */
  const loads = latest();
  const boardLoads = latest();

  async function load(serverId: string, hours: number): Promise<void> {
    const isCurrent = loads.begin();
    loading.value = true;
    error.value = "";
    failure.value = null;
    caps.value = null;
    const base = `/api/servers/${encodeURIComponent(serverId)}`;
    const [server, usage, playerList] = await Promise.allSettled([
      apiGet<ServerAnalyticsResponse>(`${base}/analytics?hours=${hours}`),
      apiGet<CommandUsageResponse>(`/api/analytics/commands?hours=${hours}`),
      apiGet<PlayersResponse>(`${base}/analytics/players?hours=${hours}`),
    ]);
    if (!isCurrent()) return;

    if (server.status === "fulfilled") {
      uptime.value = server.value.uptime;
      activity.value = server.value.activity.hours;
      activityRangeHours.value = server.value.activity.rangeHours;
      busiest.value = server.value.activity.busiest;
      caps.value = server.value.caps;
    } else {
      uptime.value = null;
      activity.value = [];
      activityRangeHours.value = null;
      busiest.value = [];
      error.value = errorMessage(server.reason);
      failure.value = loadFailure(server.reason);
    }

    if (usage.status === "fulfilled") {
      commands.value = usage.value.commands;
      commandsRangeHours.value = usage.value.rangeHours;
      caps.value ??= usage.value.caps;
      usageFailure.value = null;
    } else {
      commands.value = [];
      commandsRangeHours.value = null;
      usageFailure.value = sectionFailure(usage.reason);
    }

    if (playerList.status === "fulfilled") {
      players.value = playerList.value.players;
      playersRangeHours.value = playerList.value.rangeHours;
      sessionsKeptPerPlayer.value = playerList.value.sessionsKeptPerPlayer;
      playersFailure.value = null;
    } else {
      players.value = [];
      playersRangeHours.value = null;
      playersFailure.value = sectionFailure(playerList.reason);
    }
    loading.value = false;
    loaded.value = true;
  }

  /** Load one stat board. Separate from `load` because the picker re-runs it. */
  async function loadBoard(serverId: string, stat: string, hours: number): Promise<void> {
    const isCurrent = boardLoads.begin();
    boardLoading.value = true;
    boardError.value = "";
    boardFailure.value = null;
    try {
      const res = await apiGet<LeaderboardResponse>(
        `/api/servers/${encodeURIComponent(serverId)}/analytics/leaderboard?stat=${encodeURIComponent(stat)}&hours=${hours}`,
      );
      if (!isCurrent()) return;
      board.value = res.entries;
      boardTitle.value = res.title;
      boardRangeHours.value = res.rangeHours;
      boardBaselineAt.value = res.baselineAt;
      boardHistoryShort.value = res.historyShorterThanRange;
      availableStats.value = res.available;
      caps.value = res.caps;
    } catch (err) {
      if (!isCurrent()) return;
      board.value = [];
      boardError.value = errorMessage(err);
      boardFailure.value = loadFailure(err);
    } finally {
      if (isCurrent()) boardLoading.value = false;
    }
  }

  return {
    uptime, activity, activityRangeHours, busiest, commands, commandsRangeHours,
    players, playersRangeHours, sessionsKeptPerPlayer,
    board, boardTitle, boardRangeHours, boardBaselineAt, boardHistoryShort,
    availableStats, caps, boardError, boardFailure, boardLoading,
    loading, loaded, error, failure, usageFailure, playersFailure, load, loadBoard,
  };
}
