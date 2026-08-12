<template>
  <div>
    <ViewHeader
      title="Analytics"
      subtitle="Uptime, activity and command usage from the bot's own history."
    >
      <template #actions>
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          :loading="loading"
          @click="reload"
        />
      </template>
    </ViewHeader>

    <div v-if="serverIds.length > 1" class="picker">
      <Button
        v-for="id in serverIds"
        :key="id"
        :label="id"
        size="small"
        :outlined="id !== currentServer"
        @click="select(id)"
      />
    </div>

    <Message v-if="error" severity="warn" :closable="false">{{ error }}</Message>

    <!-- Uptime. Percentages first because that is the question; the check
         counts sit underneath so a 100% built from nine samples cannot pass
         for a month of evidence. -->
    <section class="panel">
      <h3>Uptime</h3>
      <div v-if="uptime" class="uptime-row">
        <div v-for="w in uptimeWindows" :key="w.label" class="u-cell">
          <span class="u-pct">{{ w.pct === null ? "—" : `${w.pct.toFixed(1)}%` }}</span>
          <span class="u-label muted small">{{ w.label }}</span>
          <span class="u-checks muted small">
            {{ w.checks.online }} / {{ w.checks.total }} checks
          </span>
        </div>
        <div class="u-cell">
          <span class="u-pct" :class="uptime.currentState">{{ stateWord }}</span>
          <span class="u-label muted small">right now</span>
          <span class="u-checks muted small">for {{ duration(uptime.currentStateDuration) }}</span>
        </div>
      </div>
      <p v-else class="muted small">No uptime history recorded for this server yet.</p>
    </section>

    <!-- Activity. A real chart rather than eight block characters: the shape
         over two weeks is the whole point, and an embed could never show it. -->
    <section class="panel">
      <h3>Players over the last two weeks</h3>
      <div v-if="activity.length" class="chart" role="img" :aria-label="chartLabel">
        <div
          v-for="hour in activity"
          :key="hour.at"
          class="bar"
          :style="{ height: `${barHeight(hour.avg)}%` }"
          :title="`${absolute(hour.at)} · avg ${hour.avg.toFixed(1)}, peak ${hour.peak}`"
        />
      </div>
      <p v-else class="muted small">No activity samples recorded yet.</p>

      <div v-if="busiest.length" class="busiest">
        <span class="muted small">Busiest hours</span>
        <Tag
          v-for="slot in busiest"
          :key="slot.hour"
          :value="`${String(slot.hour).padStart(2, '0')}:00 · ${slot.avg.toFixed(1)} avg`"
          severity="secondary"
        />
      </div>
    </section>

    <!-- Leaderboard. Same builder the bot uses, so a board here and a board
         in Discord cannot rank the same players differently. -->
    <section class="panel">
      <div class="p-head">
        <h3>{{ boardTitle || "Leaderboard" }}</h3>
        <Select
          v-if="availableStats.length"
          v-model="stat"
          :options="availableStats"
          optionLabel="label"
          optionValue="key"
          size="small"
          class="stat-picker"
          @change="reloadBoard"
        />
      </div>
      <Message v-if="boardError" severity="warn" :closable="false" class="panel-msg">
        {{ boardError }}
      </Message>
      <ol v-else-if="board.length" class="board">
        <li v-for="(entry, i) in board" :key="entry.name" class="b-row">
          <span class="b-rank muted mono">{{ i + 1 }}</span>
          <span class="b-name">{{ entry.name }}</span>
          <span class="b-bar">
            <span class="b-fill" :style="{ width: `${boardWidth(entry.value)}%` }" />
          </span>
          <span class="b-value mono">{{ entry.formatted }}</span>
        </li>
      </ol>
      <p v-else class="muted small">No stats recorded for this board yet.</p>
    </section>

    <!-- Players. "Who is still around and who stopped coming" is a sorted
         table, and it has been one row per Discord message until now. -->
    <section class="panel">
      <h3>Players · {{ players.length }} seen</h3>
      <DataTable
        v-if="players.length"
        :value="players"
        size="small"
        sortField="playtimeMs"
        :sortOrder="-1"
        paginator
        :rows="15"
      >
        <Column field="name" header="Player" sortable>
          <template #body="{ data }">
            <span class="p-name">
              <StatusDot v-if="data.online" state="up" />
              {{ data.name }}
            </span>
          </template>
        </Column>
        <Column field="playtimeMs" header="Playtime" sortable>
          <template #body="{ data }">{{ duration(data.playtimeMs) }}</template>
        </Column>
        <Column field="sessions" header="Sessions" sortable />
        <Column field="lastSeen" header="Last seen" sortable>
          <template #body="{ data }">
            <span v-if="data.online" class="muted small">online now</span>
            <span
              v-else-if="data.lastSeen"
              class="muted small"
              :title="timestampTitle(data.lastSeen)"
            >{{ relativeAge(data.lastSeen) }}</span>
            <span v-else class="muted small">—</span>
          </template>
        </Column>
        <Column field="firstSeen" header="First seen" sortable>
          <template #body="{ data }">
            <span v-if="data.firstSeen" class="muted small" :title="timestampTitle(data.firstSeen)">
              {{ relativeAge(data.firstSeen) }}
            </span>
            <span v-else class="muted small">—</span>
          </template>
        </Column>
      </DataTable>
      <p v-else class="muted small">No sessions recorded for this server yet.</p>
    </section>

    <!-- Command usage: the data that used to be a one-line footnote under 57
         cards on the Commands page, where it could not be sorted or compared. -->
    <section class="panel">
      <h3>Command usage, last 30 days</h3>
      <DataTable
        v-if="commands.length"
        :value="commands"
        size="small"
        sortField="uses"
        :sortOrder="-1"
        paginator
        :rows="15"
      >
        <Column field="command" header="Command" sortable>
          <template #body="{ data }">
            <code class="mono">{{ data.surface === "ingame" ? "!" : "/" }}{{ data.command }}</code>
          </template>
        </Column>
        <Column field="surface" header="Surface" sortable />
        <Column field="uses" header="Uses" sortable />
        <Column field="users" header="People" sortable />
        <Column field="lastUsed" header="Last used" sortable>
          <template #body="{ data }">
            <span class="muted small" :title="timestampTitle(data.lastUsed)">
              {{ relativeAge(data.lastUsed) }}
            </span>
          </template>
        </Column>
      </DataTable>
      <p v-else class="muted small">Nothing recorded in the last 30 days.</p>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Select from "primevue/select";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusDot from "../components/ui/StatusDot.vue";
import { useAnalytics } from "../composables/useAnalytics";
import { relativeAge, timestampTitle, absoluteStamp } from "../utils/time";

export default defineComponent({
  name: "AnalyticsView",
  components: { Button, Message, Tag, DataTable, Column, Select, ViewHeader, StatusDot },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return {
      ...useAnalytics(),
      relativeAge,
      timestampTitle,
    };
  },
  data() {
    return { currentServer: "", stat: "playtime" };
  },
  computed: {
    uptimeWindows(): { label: string; pct: number | null; checks: { total: number; online: number } }[] {
      const u = this.uptime;
      if (!u) return [];
      return [
        { label: "24 hours", pct: u.pct24h, checks: u.checks24h },
        { label: "7 days", pct: u.pct7d, checks: u.checks7d },
        { label: "30 days", pct: u.pct30d, checks: u.checks30d },
      ];
    },
    stateWord(): string {
      const state = this.uptime?.currentState ?? "unknown";
      return state === "online" ? "Up" : state === "offline" ? "Down" : "Unknown";
    },
    /** The top entry's value, so board bars scale to the board shown. */
    boardPeak(): number {
      return this.board.reduce((max, e) => Math.max(max, e.value), 0);
    },
    /** The tallest average in the window, so bars scale to the data shown. */
    peakAvg(): number {
      return this.activity.reduce((max, h) => Math.max(max, h.avg), 0);
    },
    chartLabel(): string {
      return `Average concurrent players per hour over ${this.activity.length} hours, peaking at ${this.peakAvg.toFixed(1)}.`;
    },
  },
  watch: {
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (ids.length === 0) return;
        const next =
          this.activeServer && ids.includes(this.activeServer) ? this.activeServer : ids[0]!;
        void this.select(next);
      },
    },
  },
  methods: {
    async select(id: string): Promise<void> {
      this.currentServer = id;
      // The board is fetched alongside rather than inside `load`, because
      // changing the stat picker re-runs only this half.
      await Promise.all([this.load(id), this.loadBoard(id, this.stat)]);
    },
    async reload(): Promise<void> {
      if (this.currentServer) await this.select(this.currentServer);
    },
    async reloadBoard(): Promise<void> {
      if (this.currentServer) await this.loadBoard(this.currentServer, this.stat);
    },
    /** Bar width relative to first place, which is what a rank reads against. */
    boardWidth(value: number): number {
      if (this.boardPeak <= 0) return 0;
      return Math.max(1, (value / this.boardPeak) * 100);
    },
    /**
     * Bar height as a share of the window's own peak.
     *
     * Scaling to max-players instead would flatten every server that never
     * fills, which is nearly all of them, and hide the shape this chart
     * exists to show. A floor of 2% keeps a quiet hour visible as a quiet
     * hour rather than as missing data.
     */
    barHeight(avg: number): number {
      if (this.peakAvg <= 0) return 2;
      return Math.max(2, (avg / this.peakAvg) * 100);
    },
    absolute(at: number): string {
      return absoluteStamp(at);
    },
    duration(ms: number): string {
      const hours = Math.floor(ms / 3_600_000);
      if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
      if (hours < 48) return `${hours} h`;
      return `${Math.round(hours / 24)} days`;
    },
  },
});
</script>

<style scoped>
.picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }

.panel {
  border: 0.5px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-card);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.panel h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }

.uptime-row { display: flex; flex-wrap: wrap; gap: 28px; }
.u-cell { display: flex; flex-direction: column; gap: 1px; }
.u-pct { font-size: 26px; font-weight: 500; line-height: 1.1; }
.u-pct.online { color: var(--mc-accent); }
.u-pct.offline { color: var(--mc-bad); }
.u-pct.unknown { color: var(--mc-dim); }

.chart {
  display: flex; align-items: flex-end; gap: 1px;
  height: 140px; padding: 4px 0;
}
.bar {
  flex: 1; min-width: 1px;
  background: var(--mc-accent);
  border-radius: 1px 1px 0 0;
  opacity: 0.85;
}
.bar:hover { opacity: 1; }

.busiest { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

.p-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.p-head h3 { margin-bottom: 12px; }
.stat-picker { min-width: 180px; margin-bottom: 12px; }
.panel-msg { margin: 0; }

.board { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.b-row {
  display: grid;
  grid-template-columns: 26px minmax(90px, 1fr) minmax(0, 3fr) auto;
  align-items: center; gap: 10px;
}
.b-rank { font-size: 12px; text-align: right; }
.b-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.b-bar { height: 6px; border-radius: 999px; background: var(--mc-border-strong); overflow: hidden; }
.b-fill { display: block; height: 100%; background: var(--mc-accent); border-radius: 999px; }
.b-value { font-size: 12.5px; white-space: nowrap; }

.p-name { display: inline-flex; align-items: center; gap: 7px; }

@media (max-width: 700px) {
  .b-row { grid-template-columns: 22px 1fr auto; }
  .b-bar { display: none; }
}
</style>
