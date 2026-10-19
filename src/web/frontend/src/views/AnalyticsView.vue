<template>
  <div class="analytics-view">
    <ViewHeader
      :title="t('analytics.title')"
      :subtitle="currentServer ? t('analytics.ledeServer', { server: currentServer }) : t('analytics.lede')"
    >
      <template #actions>
        <Button
          class="tap"
          :label="t('analytics.refresh')"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          :loading="loading"
          @click="reload"
        />
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server" :title="t('analytics.noServersTitle')">
      {{ t("analytics.noServers") }}
    </EmptyState>

    <div v-else class="stack-gap">
      <div class="scope-bar">
        <span :id="rangeLabelId" class="ctl-label">{{ t("analytics.range") }}</span>
        <SelectButton
          v-model="rangeHours"
          class="ranges"
          :options="rangeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          size="small"
          :aria-labelledby="rangeLabelId"
        />
      </div>

      <TabList
        :tabs="tabs"
        :model-value="shownTab"
        :label="t('analytics.tabs')"
        id-prefix="an"
        panel-id="an-panel"
        @select="selectTab"
      />

      <div id="an-panel" role="tabpanel" :aria-labelledby="`an-tab-${shownTab}`" class="stack-gap">
        <p v-if="!loaded" class="note" role="status">{{ t("analytics.loading", { server: currentServer }) }}</p>

        <InlineError
          v-if="failure"
          :title="historyFailureCopy.title"
          :recovery="historyFailureCopy.recovery"
          :detail="historyFailureCopy.detail"
          :retryable="historyFailureCopy.retryable"
          :retry-label="historyFailureCopy.retryLabel"
          :busy="loading"
          :heading-level="2"
          @retry="retry(failure, reload)"
        />

        <template v-if="shownTab === 'players'">
          <!-- Activity. A real chart rather than eight block characters: the
               shape over weeks is the whole point, and an embed could never
               show it. Each bar is the average, the tick on it the peak. -->
          <section v-if="loaded && !failure" class="panel" aria-labelledby="an-activity-h">
            <h2 id="an-activity-h">
              {{ t("analytics.activity") }}
              <span class="h-meta">{{ activityCoverage }}</span>
            </h2>
            <div v-if="chartBars.length" class="chart" role="img" :aria-label="chartLabel">
              <div
                v-for="bar in chartBars"
                :key="bar.at"
                class="bar"
                :title="t('analytics.barTitle', { at: absolute(bar.at), avg: bar.avg.toFixed(1), peak: bar.peak })"
              >
                <span class="bar-avg" :style="{ height: `${barHeight(bar.avg)}%` }" />
                <span class="bar-peak" :style="{ bottom: `${barHeight(bar.peak)}%` }" />
              </div>
            </div>
            <p v-else class="note">{{ t("analytics.noActivity") }}</p>
            <p v-if="chartBars.length" class="note section-note">{{ chartNote }}</p>

            <div v-if="busiest.length" class="busiest">
              <span class="note">{{ t("analytics.busiest") }}</span>
              <span v-for="slot in busiest" :key="slot.hour" class="slot">
                {{ t("analytics.busySlot", { hour: String(slot.hour).padStart(2, "0"), avg: slot.avg.toFixed(1) }) }}
              </span>
            </div>
          </section>

          <!-- Leaderboard. Same builder the bot uses, so a board here and a
               board in Discord cannot rank the same players differently. -->
          <section class="panel" aria-labelledby="an-board-h" :aria-busy="boardLoading ? 'true' : undefined">
            <div class="p-head">
              <h2 id="an-board-h">
                {{ boardTitle || t("analytics.leaderboard") }}
                <span v-if="boardCoverage" class="h-meta">{{ boardCoverage }}</span>
              </h2>
              <span v-if="availableStats.length" class="stat-field">
                <label id="an-stat-label" for="an-stat" class="sr-only">{{ t("analytics.statLabel") }}</label>
                <Select
                  v-model="stat"
                  inputId="an-stat"
                  ariaLabelledby="an-stat-label"
                  :options="availableStats"
                  optionLabel="label"
                  optionValue="key"
                  size="small"
                  class="stat-picker"
                  @change="reloadBoard"
                />
              </span>
            </div>
            <p v-if="boardLoading" class="note" role="status">{{ t("analytics.boardLoading") }}</p>
            <InlineError
              v-else-if="boardFailure"
              :title="boardFailureCopy.title"
              :recovery="boardFailureCopy.recovery"
              :detail="boardFailureCopy.detail"
              :retryable="boardFailureCopy.retryable"
              :retry-label="boardFailureCopy.retryLabel"
              @retry="retry(boardFailure, reloadBoard)"
            />
            <ol v-else-if="board.length" class="board">
              <li v-for="(entry, i) in board" :key="entry.name" class="b-row">
                <span class="b-rank mono">{{ i + 1 }}</span>
                <button type="button" class="b-name link-btn" @click="$emit('open-player', entry.name)">
                  {{ entry.name }}
                </button>
                <span class="b-bar" aria-hidden="true">
                  <span class="b-fill" :style="{ width: `${boardWidth(entry.value)}%` }" />
                </span>
                <span class="b-value mono">{{ boardValue(entry) }}</span>
              </li>
            </ol>
            <p v-else class="note">{{ t("analytics.boardEmpty") }}</p>
            <p v-if="boardNote" class="note section-note">{{ boardNote }}</p>
          </section>

          <PlayersPanel
            v-if="currentServer"
            :server-id="currentServer"
            :range-hours="rangeHours"
            @open-player="$emit('open-player', $event)"
            @open-all="$emit('navigate', 'players')"
          />
        </template>

        <template v-else>
          <!-- Uptime. Percentages first because that is the question; the check
               counts sit underneath so a 100% built from nine samples cannot
               pass for a month of evidence. -->
          <section v-if="uptime" class="panel" aria-labelledby="an-uptime-h">
            <h2 id="an-uptime-h">
              {{ t("analytics.uptime") }}
              <span v-if="hasChecks" class="h-meta">{{ uptimeCoverage }}</span>
            </h2>
            <div class="uptime-row">
              <template v-if="hasChecks">
                <div v-for="w in uptimeWindows" :key="w.label" :class="['u-cell', { 'u-selected': w.selected }]">
                  <span :class="['u-pct', { 'u-none': w.pct === null }]">
                    {{ w.pct === null ? t("analytics.noChecks") : `${w.pct.toFixed(1)}%` }}
                  </span>
                  <span class="u-label">{{ w.label }}</span>
                  <span class="u-checks">{{ t("analytics.checks", { online: w.checks.online, count: w.checks.total }) }}</span>
                </div>
              </template>
              <div class="u-cell">
                <StatusChip :state="currentRole" :label="currentLabel" />
                <span class="u-label">{{ t("analytics.rightNow") }}</span>
                <span v-if="uptime.currentState !== 'unknown'" class="u-checks">
                  {{ t("analytics.forDuration", { duration: formatSpan(uptime.currentStateDuration) }) }}
                </span>
              </div>
            </div>
            <p v-if="!hasChecks" class="note section-note">{{ t("analytics.noChecksYet", { server: currentServer }) }}</p>
          </section>

          <!-- Command usage: sortable and comparable, which a footnote under
               the command cards never was. -->
          <section class="panel" aria-labelledby="an-commands-h">
            <h2 id="an-commands-h">
              {{ t("analytics.commands") }}
              <span v-if="commandsCoverage" class="h-meta">{{ commandsCoverage }}</span>
            </h2>
            <InlineError
              v-if="usageFailure"
              :title="usageFailureCopy.title"
              :recovery="usageFailureCopy.recovery"
              :detail="usageFailureCopy.detail"
              :retryable="usageFailureCopy.retryable"
              :retry-label="usageFailureCopy.retryLabel"
              :busy="loading"
              @retry="retry(usageFailure?.kind ?? null, reload)"
            />
            <template v-else-if="commands.length">
              <SortControl
                v-model:field="commandsSort.field"
                v-model:order="commandsSort.order"
                :options="commandsSortOptions"
              />
              <DataTable
                v-model:sortField="commandsSort.field"
                v-model:sortOrder="commandsSort.order"
                :value="commands"
                :pt="{ pcPaginator: { paginatorContainer: { 'aria-label': t('analytics.commandsPages') } } }"
                size="small"
                paginator
                :rows="15"
                class="table stack-table"
              >
                <Column field="command" :header="t('analytics.col.command')" :pt="{ bodyCell: { 'data-label': t('analytics.col.command') } }" sortable>
                  <template #body="{ data }">
                    <code class="mono">{{ data.surface === "ingame" ? "!" : "/" }}{{ data.command }}</code>
                  </template>
                </Column>
                <Column field="surface" :header="t('analytics.col.surface')" :pt="{ bodyCell: { 'data-label': t('analytics.col.surface') } }" sortable />
                <Column field="uses" :header="t('analytics.col.uses')" :pt="{ bodyCell: { 'data-label': t('analytics.col.uses') } }" sortable />
                <Column field="users" :header="t('analytics.col.people')" :pt="{ bodyCell: { 'data-label': t('analytics.col.people') } }" sortable />
                <Column field="lastUsed" :header="t('analytics.col.lastUsed')" :pt="{ bodyCell: { 'data-label': t('analytics.col.lastUsed') } }" sortable>
                  <template #body="{ data }">
                    <span v-if="data.lastUsed" class="dim" :title="timestampTitle(data.lastUsed)">{{ relativeAge(data.lastUsed) }}</span>
                    <span v-else class="dim">{{ t("analytics.notRecorded") }}</span>
                  </template>
                </Column>
              </DataTable>
            </template>
            <p v-else-if="loaded" class="note">{{ t("analytics.noCommands", { range: rangeLabel }) }}</p>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, useId } from "vue";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { StatusRole } from "@mcbot/schema";
import { formatSpan, MS } from "@mcbot/core/utils/duration.js";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineError from "../components/ui/InlineError.vue";
import SortControl from "../components/ui/SortControl.vue";
import TabList from "../components/ui/TabList.vue";
import PlayersPanel from "../components/analytics/PlayersPanel.vue";
import {
  useAnalytics,
  bucketActivity,
  coverageLabel,
  formatHours,
  HOURLY_CHART_MAX_HOURS,
  type ActivityHour,
  type LeaderboardEntry,
} from "../composables/useAnalytics";
import { failureCopy, signIn, type FailureCopy, type LoadFailure } from "../utils/loadFailure";
import { relativeAge, timestampTitle, absoluteStamp } from "../utils/time";
import { t } from "../i18n";

/** Minecraft counts playtime in game ticks, 20 per second. */
const MS_PER_TICK = MS.second / 20;

/** Stats whose value is a playtime in ticks. */
const TICK_STATS = new Set(["playtime"]);

type AnalyticsTab = "players" | "server";

interface UptimeWindow {
  label: string;
  pct: number | null;
  checks: { total: number; online: number };
  selected: boolean;
}

export default defineComponent({
  name: "AnalyticsView",
  components: {
    Button, DataTable, Column, Select, SelectButton, ViewHeader, StatusChip, EmptyState, InlineError, SortControl,
    TabList, PlayersPanel,
  },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
    /** The open tab, from the route: "server" or empty for the default Players tab. */
    tab: { type: String, default: "" },
  },
  emits: {
    "update-route": (_patch: { params?: Record<string, string | undefined> }) => true,
    "open-player": (_name: string) => true,
    navigate: (_id: string) => true,
  },
  setup() {
    return {
      ...useAnalytics(),
      relativeAge,
      timestampTitle,
      formatSpan,
      t,
      rangeLabelId: `analytics-range-${useId()}`,
    };
  },
  data() {
    return {
      currentServer: "",
      stat: "playtime",
      // One control for every section. Each section keeps a different amount
      // of history, so a range past a section's cap is clamped and the panel
      // title says how far it actually reached.
      rangeHours: 24 * 14,
      commandsSort: { field: "uses", order: -1 as 1 | -1 },
      rangeOptions: [
        { label: "24h", value: 24 },
        { label: "3d", value: 24 * 3 },
        { label: "7d", value: 24 * 7 },
        { label: "14d", value: 24 * 14 },
        { label: "30d", value: 24 * 30 },
        { label: "90d", value: 24 * 90 },
      ],
    };
  },
  computed: {
    shownTab(): AnalyticsTab {
      return this.tab === "server" ? "server" : "players";
    },
    tabs(): Array<{ id: AnalyticsTab; label: string }> {
      return [
        { id: "players", label: t("analytics.tab.players") },
        { id: "server", label: t("analytics.tab.server") },
      ];
    },
    commandsSortOptions(): Array<{ field: string; label: string }> {
      return [
        { field: "command", label: t("analytics.col.command") },
        { field: "surface", label: t("analytics.col.surface") },
        { field: "uses", label: t("analytics.col.uses") },
        { field: "users", label: t("analytics.col.people") },
        { field: "lastUsed", label: t("analytics.col.lastUsed") },
      ];
    },
    uptimeWindows(): UptimeWindow[] {
      const u = this.uptime;
      if (!u) return [];
      const fixed = [
        { hours: 24, label: t("analytics.window24h"), pct: u.pct24h, checks: u.checks24h },
        { hours: 24 * 7, label: t("analytics.window7d"), pct: u.pct7d, checks: u.checks7d },
        { hours: 24 * 30, label: t("analytics.window30d"), pct: u.pct30d, checks: u.checks30d },
      ];
      const range = u.range;
      const rows = fixed.map((w) => ({
        label: w.label,
        pct: w.pct,
        checks: w.checks,
        selected: range?.rangeHours === w.hours,
      }));
      if (range && !fixed.some((w) => w.hours === range.rangeHours)) {
        rows.push({
          label: t("analytics.windowRange", { range: formatHours(range.rangeHours) }),
          pct: range.pct,
          checks: range.checks,
          selected: true,
        });
      }
      return rows;
    },
    /** A server the bot never polled has empty windows; one sentence says so instead of a row of blanks. */
    hasChecks(): boolean {
      return this.uptimeWindows.some((w) => w.checks.total > 0);
    },
    currentRole(): StatusRole {
      const state = this.uptime?.currentState ?? "unknown";
      if (state === "online") return StatusRole.Online;
      if (state === "offline") return StatusRole.Offline;
      return StatusRole.Unknown;
    },
    currentLabel(): string {
      const state = this.uptime?.currentState ?? "unknown";
      if (state === "online") return t("status.online");
      if (state === "offline") return t("status.offline");
      return t("status.unknown");
    },
    uptimeCoverage(): string {
      return coverageLabel(this.rangeHours, this.uptime?.range?.rangeHours ?? null);
    },
    activityCoverage(): string {
      return coverageLabel(this.rangeHours, this.activityRangeHours);
    },
    commandsCoverage(): string {
      return coverageLabel(this.rangeHours, this.commandsRangeHours);
    },
    boardCoverage(): string {
      return this.boardFailure ? "" : coverageLabel(this.rangeHours, this.boardRangeHours);
    },
    boardNote(): string {
      if (this.boardFailure || !this.boardHistoryShort) return "";
      return this.boardBaselineAt
        ? t("analytics.boardShort", { at: absoluteStamp(this.boardBaselineAt) })
        : t("analytics.boardAllTime");
    },
    /** The top entry's value, so board bars scale to the board shown. */
    boardPeak(): number {
      return this.board.reduce((max, e) => Math.max(max, e.value), 0);
    },
    /** Whether the bars are hours or, for a long range, days. */
    chartBucket(): "hour" | "day" {
      const range = this.activityRangeHours ?? this.rangeHours;
      return range > HOURLY_CHART_MAX_HOURS ? "day" : "hour";
    },
    chartBars(): ActivityHour[] {
      return bucketActivity(this.activity, this.chartBucket);
    },
    /** The tallest peak in the window, so bars scale to the data shown. */
    chartScale(): number {
      return this.chartBars.reduce((max, h) => Math.max(max, h.peak, h.avg), 0);
    },
    chartLabel(): string {
      return t("analytics.chartLabel", { count: this.chartBars.length, peak: this.chartScale });
    },
    chartNote(): string {
      return t(this.chartBucket === "day" ? "analytics.chartNoteDay" : "analytics.chartNoteHour");
    },
    rangeLabel(): string {
      return this.rangeOptions.find((o) => o.value === this.rangeHours)?.label ?? formatHours(this.rangeHours);
    },
    historyFailureCopy(): FailureCopy {
      return failureCopy(this.failure ?? "failed", {
        failedTitle: t("analytics.historyFailedTitle", { server: this.currentServer }),
        failedText: t("analytics.historyFailedText"),
        forbiddenTitle: t("analytics.forbiddenTitle", { server: this.currentServer }),
        capability: "server:read",
        request: `GET /api/servers/${this.currentServer}/analytics`,
        error: this.error,
      });
    },
    boardFailureCopy(): FailureCopy {
      // The board is the one panel read through the wrapper (stats live in the
      // world folder), so "did not answer" points there, not at the dashboard.
      return failureCopy(this.boardFailure ?? "failed", {
        failedTitle: t("analytics.boardFailedTitle"),
        failedText:
          this.boardFailure === "unreachable"
            ? t("analytics.boardWrapperText", { server: this.currentServer })
            : t("analytics.boardFailedText"),
        forbiddenTitle: t("analytics.forbiddenTitle", { server: this.currentServer }),
        capability: "server:read",
        request: `GET /api/servers/${this.currentServer}/analytics/leaderboard`,
        error: this.boardError,
      });
    },
    usageFailureCopy(): FailureCopy {
      // Command usage is bot-wide, not per server, so it asks for the audit
      // capability under "*" rather than server:read.
      return failureCopy(this.usageFailure?.kind ?? "failed", {
        failedTitle: t("analytics.commandsFailedTitle"),
        failedText: t("analytics.sectionFailedText"),
        forbiddenTitle: t("analytics.commandsForbiddenTitle"),
        capability: "audit:read",
        request: "GET /api/analytics/commands",
        error: this.usageFailure?.error ?? "",
      });
    },
  },
  watch: {
    activeServer(id: string) {
      if (id && id !== this.currentServer) void this.select(id);
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (ids.length === 0 || ids.includes(this.currentServer)) return;
        const next =
          this.activeServer && ids.includes(this.activeServer) ? this.activeServer : ids[0]!;
        void this.select(next);
      },
    },
    rangeHours() {
      void this.reload();
    },
  },
  methods: {
    async select(id: string): Promise<void> {
      this.currentServer = id;
      // The board is fetched alongside rather than inside `load`, because
      // changing the stat picker re-runs only this half.
      await Promise.all([
        this.load(id, this.rangeHours),
        this.loadBoard(id, this.stat, this.rangeHours),
      ]);
    },
    async reload(): Promise<void> {
      if (this.currentServer) await this.select(this.currentServer);
    },
    async reloadBoard(): Promise<void> {
      if (this.currentServer) await this.loadBoard(this.currentServer, this.stat, this.rangeHours);
    },
    selectTab(id: string): void {
      this.$emit("update-route", { params: { tab: id === "server" ? "server" : undefined } });
    },
    retry(kind: LoadFailure | null, again: () => Promise<void>): void {
      if (kind === "signedOut") signIn();
      else void again();
    },
    boardValue(entry: LeaderboardEntry): string {
      return TICK_STATS.has(this.stat) ? formatSpan(entry.value * MS_PER_TICK) : entry.formatted;
    },
    /** Bar width relative to first place, which is what a rank reads against. */
    boardWidth(value: number): number {
      if (this.boardPeak <= 0) return 0;
      return Math.max(1, (value / this.boardPeak) * 100);
    },
    /**
     * Height as a share of the window's own peak. Scaling to max-players
     * would flatten every server that never fills. A floor of 2% keeps a
     * quiet hour visible as a quiet hour rather than as missing data.
     */
    barHeight(value: number): number {
      if (this.chartScale <= 0) return 2;
      return Math.max(2, (value / this.chartScale) * 100);
    },
    absolute(at: number): string {
      return absoluteStamp(at);
    },
  },
});
</script>

<style scoped>
.analytics-view { min-width: 0; }
.scope-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.ctl-label { color: var(--text-dim); font-size: var(--text-sm); }
.h-meta { margin-left: var(--space-2); color: var(--text-dim); font-size: var(--text-sm); font-weight: 400; }

.panel {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.panel h2 { margin: 0 0 var(--space-3); font-size: var(--text-lg); font-weight: 600; }
.section-note { margin-top: var(--space-3); }
.dim { font-size: var(--text-sm); }

.uptime-row { display: flex; flex-wrap: wrap; gap: var(--space-4) var(--space-6); }
.u-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.u-pct { font-size: var(--text-3xl); font-weight: 600; line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.u-pct.u-none { font-size: var(--text-lg); font-weight: 400; color: var(--text-dim); line-height: 2.25rem; }
.u-label, .u-checks { color: var(--text-dim); font-size: var(--text-sm); }
.u-selected .u-label { color: var(--accent); }

.chart { display: flex; align-items: stretch; gap: 1px; height: 140px; padding: var(--space-1) 0; }
.bar { position: relative; display: flex; flex: 1; align-items: flex-end; min-width: 1px; }
.bar-avg { display: block; width: 100%; border-radius: 1px 1px 0 0; background: var(--accent); opacity: 0.85; }
.bar:hover .bar-avg { opacity: 1; }
.bar-peak { position: absolute; left: 0; right: 0; height: 2px; background: var(--text); opacity: 0.55; pointer-events: none; }

.busiest { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
.slot { padding: 2px var(--space-2); border-radius: var(--radius-control); background: var(--surface-raised); font-size: var(--text-xs); }

.p-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-3); }
.p-head h2 { margin: 0; }
.stat-picker { min-width: 180px; }

.board { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.b-row { display: grid; grid-template-columns: 26px minmax(90px, 1fr) minmax(0, 3fr) auto; align-items: center; gap: var(--space-3); }
.b-rank { color: var(--text-dim); font-size: var(--text-xs); text-align: right; }
.b-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
.link-btn {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.link-btn:hover { text-decoration: underline; }
.b-bar { height: 6px; overflow: hidden; border-radius: var(--radius-full); background: var(--border-strong); }
.b-fill { display: block; height: 100%; border-radius: var(--radius-full); background: var(--accent); }
.b-value { font-size: var(--text-xs); white-space: nowrap; }

@media (max-width: 700px) {
  .b-row { grid-template-columns: 22px 1fr auto; }
  .b-bar { display: none; }
}
@media (pointer: coarse), (max-width: 760px) {
  .ranges :deep(.p-togglebutton) { min-height: var(--touch-min); }
  .stat-picker { min-height: var(--touch-min); }
  .table :deep(.p-paginator button) { min-width: var(--touch-min); min-height: var(--touch-min); }
}
</style>
