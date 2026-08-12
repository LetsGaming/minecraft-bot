import { ref } from "vue";
import { apiGet } from "../api";
import { errorMessage } from "../utils/errorMessage";

/**
 * The bot's own history, for the dashboard.
 *
 * All of this already existed behind `/uptime`, `/activity` and the counters
 * `/help` uses. None of it is collected here; these are read paths, which is
 * why this composable is thin. The point was never new data, it was that a
 * time series rendered as block characters in a Discord embed is a table
 * pretending to be a chart.
 */

export interface UptimeStats {
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
  checks24h: { total: number; online: number };
  checks7d: { total: number; online: number };
  checks30d: { total: number; online: number };
  currentState: "online" | "offline" | "unknown";
  currentStateDuration: number;
}

export interface ActivityHour {
  at: number;
  /** Mean concurrent players in that hour. */
  avg: number;
  peak: number;
  samples: number;
}

export interface BusyHour {
  hour: number;
  avg: number;
}

export interface CommandUsageRow {
  command: string;
  surface: string;
  uses: number;
  users: number;
  lastUsed: number;
}

export interface PlayerRow {
  name: string;
  playtimeMs: number;
  sessions: number;
  lastSeen: number | null;
  online: boolean;
  firstSeen: number | null;
}

export interface LeaderboardEntry {
  name: string;
  value: number;
  formatted: string;
}

export interface StatOption {
  key: string;
  label: string;
}

export function useAnalytics() {
  const uptime = ref<UptimeStats | null>(null);
  const activity = ref<ActivityHour[]>([]);
  const busiest = ref<BusyHour[]>([]);
  const commands = ref<CommandUsageRow[]>([]);
  const players = ref<PlayerRow[]>([]);
  const board = ref<LeaderboardEntry[]>([]);
  const boardTitle = ref("");
  const availableStats = ref<StatOption[]>([]);
  /**
   * Its own error, because the leaderboard is the only panel here that goes
   * through the wrapper — the world folder is where stats live. It failing
   * says nothing about uptime, sessions or command usage, so it must not
   * blank them.
   */
  const boardError = ref("");
  const loading = ref(false);
  const error = ref("");

  /**
   * Server history and command usage load independently.
   *
   * Command usage is global and server history is per server, so one failing
   * must not blank the other: a server that has never been polled still has
   * meaningful command numbers, and vice versa.
   */
  async function load(serverId: string): Promise<void> {
    loading.value = true;
    error.value = "";
    const [server, usage, playerList] = await Promise.allSettled([
      apiGet<{
        uptime: UptimeStats;
        activity: { hours: ActivityHour[]; busiest: BusyHour[] };
      }>(`/api/servers/${encodeURIComponent(serverId)}/analytics`),
      apiGet<{ commands: CommandUsageRow[] }>("/api/analytics/commands"),
      apiGet<{ players: PlayerRow[] }>(
        `/api/servers/${encodeURIComponent(serverId)}/analytics/players`,
      ),
    ]);

    if (server.status === "fulfilled") {
      uptime.value = server.value.uptime;
      activity.value = server.value.activity.hours;
      busiest.value = server.value.activity.busiest;
    } else {
      uptime.value = null;
      activity.value = [];
      busiest.value = [];
      error.value = errorMessage(server.reason);
    }

    commands.value = usage.status === "fulfilled" ? usage.value.commands : [];
    players.value = playerList.status === "fulfilled" ? playerList.value.players : [];
    loading.value = false;
  }

  /** Load one stat board. Separate from `load` because the picker re-runs it. */
  async function loadBoard(serverId: string, stat: string): Promise<void> {
    boardError.value = "";
    try {
      const res = await apiGet<{
        title: string;
        entries: LeaderboardEntry[];
        available: StatOption[];
      }>(
        `/api/servers/${encodeURIComponent(serverId)}/analytics/leaderboard?stat=${encodeURIComponent(stat)}`,
      );
      board.value = res.entries;
      boardTitle.value = res.title;
      availableStats.value = res.available;
    } catch (err) {
      board.value = [];
      boardError.value = errorMessage(err);
    }
  }

  return {
    uptime, activity, busiest, commands, players,
    board, boardTitle, availableStats, boardError,
    loading, error, load, loadBoard,
  };
}
