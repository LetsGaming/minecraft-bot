<template>
  <div class="backups-view">
    <ViewHeader
      :title="t('backups.title')"
      :server="current"
      :server-state="serverRole"
    >
      <template v-if="current" #subtitle>
        {{ t("backups.purposeBefore") }} <strong>{{ current }}</strong>. {{ t("backups.purposeAfter", { server: current }) }}
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server">
      {{ t("backups.noServers") }}
    </EmptyState>

    <template v-else>
      <div class="stack-gap">
        <InlineBanner v-if="missingCaps.length" tone="info" :title="readOnlyTitle">
          {{ readOnlyText }}
        </InlineBanner>

        <StaleBanner :stale="stale">
          {{ t("backups.staleText", { at: staleAt, server: current }) }}
          <template #actions>
            <Button class="tap" :label="t('backups.action.retry')" size="small" outlined :loading="loading" @click="reload" />
          </template>
        </StaleBanner>

        <JobBlock
          v-if="job"
          ref="jobBlock"
          :title="job.title"
          :state="job.state"
          :started-at="job.startedAt"
          :exit-code="job.exitCode"
          :output="job.output"
        >
          <p>{{ job.note }}</p>
          <template v-if="job.state !== 'running'" #actions>
            <Button
              v-if="job.state === 'failed' && job.kind === 'create'"
              class="tap"
              :label="t('backups.action.tryAgain')"
              size="small"
              @click="createBackup"
            />
            <Button
              v-if="job.kind === 'restore'"
              class="tap"
              :label="t('backups.action.openServers')"
              size="small"
              :outlined="job.state === 'failed'"
              @click="openServers"
            />
            <Button class="tap" :label="t('backups.action.dismiss')" size="small" severity="secondary" text @click="job = null" />
          </template>
        </JobBlock>

        <div v-if="metrics" class="metrics">
          <div class="metric">
            <span class="metric-n">{{ metrics.count }}</span>
            <span class="metric-l">{{ t("backups.metric.count", { server: current }) }}</span>
          </div>
          <div v-if="metrics.bytes !== null" class="metric">
            <span class="metric-n">{{ formatBytes(metrics.bytes) }}</span>
            <span class="metric-l">{{ t("backups.metric.bytes") }}</span>
          </div>
          <div v-if="metrics.newest !== null" class="metric">
            <span class="metric-n" :title="timestampTitle(metrics.newest)">{{ relativeAge(metrics.newest) }}</span>
            <span class="metric-l">{{ t("backups.metric.newest") }}</span>
          </div>
        </div>

        <div class="layout">
          <section class="card list-card" aria-labelledby="backups-list-h" :aria-busy="loading ? 'true' : undefined">
            <div class="card-head">
              <h2 id="backups-list-h">{{ t("backups.list.title") }} <span class="mono">{{ current }}</span></h2>
              <span class="card-meta">{{ listMeta }}</span>
              <span class="cluster">
                <Button
                  class="tap"
                  icon="pi pi-refresh"
                  :label="t('backups.action.reload')"
                  size="small"
                  severity="secondary"
                  outlined
                  :loading="loading && !initialLoad"
                  @click="reload"
                />
                <Button
                  v-if="createAvailable"
                  class="tap"
                  icon="pi pi-plus"
                  :label="t('backups.action.create')"
                  size="small"
                  :disabled="!canCreate || jobRunning"
                  @click="createBackup"
                />
              </span>
            </div>

            <div v-if="filterChips.length > 1 && files.length" class="filters" role="group" :aria-label="t('backups.filter.label')">
              <button
                v-for="chip in filterChips"
                :key="chip.key"
                type="button"
                :class="['chip', 'tap', { on: filter === chip.key }]"
                :aria-pressed="filter === chip.key"
                @click="filter = chip.key"
              >
                {{ chip.label }} <span class="chip-n">{{ chip.count }}</span>
              </button>
            </div>

            <div v-if="initialLoad && loading" class="skeleton" role="status">
              <span class="sr-only">{{ t("backups.list.loading", { server: current }) }}</span>
              <span v-for="n in 5" :key="n" class="sk-row" aria-hidden="true" />
            </div>

            <InlineError
              v-else-if="error && files.length === 0"
              :title="t('backups.error.title')"
              :recovery="t('backups.error.recovery', { server: current })"
              :detail="errorDetail"
              :busy="loading"
              @retry="reload"
            >
              <template #actions>
                <Button class="tap" :label="t('backups.action.openServers')" size="small" outlined @click="openServers" />
              </template>
            </InlineError>

            <EmptyState
              v-else-if="files.length === 0"
              icon="pi pi-box"
              :title="t('backups.empty.title', { server: current })"
            >
              {{ t("backups.empty.text") }}
              <template v-if="createAvailable && canCreate" #action>
                <Button class="tap" icon="pi pi-plus" :label="t('backups.action.create')" :disabled="jobRunning" @click="createBackup" />
              </template>
            </EmptyState>

            <template v-else>
              <ResponsiveTable
                :columns="columns"
                :rows="visibleFiles"
                :caption="t('backups.list.caption', { server: current })"
                :row-key="(f: BackupFileInfo) => f.id"
                :busy="(f: BackupFileInfo) => isBusy(f.id)"
                :actions-label="t('backups.actions')"
                :actions-label-visible="false"
              >
                <template #cell-name="{ row }">
                  <span class="file-name mono">{{ row.name }}</span>
                  <span v-if="newIds.includes(row.id)" class="tag tag-new">{{ t("backups.newTag") }}</span>
                </template>
                <template #cell-tier="{ row }">
                  <span :class="['tag', tierClass(row.tier)]">{{ backupTierLabel(row.tier) }}</span>
                </template>
                <template #cell-created="{ row }">
                  <span class="when" :title="timestampTitle(row.mtimeMs)">
                    <span>{{ absoluteStamp(row.mtimeMs) }}</span>
                    <span class="rel">{{ relativeAge(row.mtimeMs) }}</span>
                  </span>
                </template>
                <template #cell-size="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
                <template #actions="{ row, busy }">
                  <span v-if="busy" class="row-busy" role="status">
                    <i class="pi pi-spin pi-spinner" aria-hidden="true" />
                    {{ busyLabel(row.id) }}
                  </span>
                  <span v-else class="cluster row-actions">
                    <Button
                      v-if="canDownload"
                      class="tap"
                      icon="pi pi-download"
                      size="small"
                      severity="secondary"
                      text
                      :aria-label="t('backups.action.downloadNamed', { name: stem(row.name) })"
                      v-tooltip.top="t('backups.action.download')"
                      @click="download(row.id)"
                    />
                    <Button
                      v-if="restoreAvailable"
                      class="tap"
                      icon="pi pi-replay"
                      :label="t('backups.action.restore')"
                      size="small"
                      severity="secondary"
                      outlined
                      :aria-label="t('backups.action.restoreNamed', { name: stem(row.name) })"
                      :disabled="!canRestore || isLocked(row.id) || jobRunning"
                      @click="confirmRestore(row)"
                    />
                    <Button
                      v-if="deleteAvailable"
                      class="tap"
                      icon="pi pi-trash"
                      size="small"
                      severity="danger"
                      text
                      :aria-label="t('backups.action.deleteNamed', { name: stem(row.name) })"
                      v-tooltip.top="t('backups.action.delete')"
                      :disabled="!canDelete || isLocked(row.id)"
                      @click="confirmDelete(row)"
                    />
                  </span>
                </template>
              </ResponsiveTable>

              <div class="foot">
                <span class="foot-count">{{ footText }}</span>
                <Button
                  v-if="hasMore && !stale"
                  class="tap"
                  :label="t('backups.action.loadMore', { count: nextPage })"
                  size="small"
                  severity="secondary"
                  outlined
                  :loading="loading"
                  @click="loadMore"
                />
              </div>
            </template>
          </section>

          <section v-if="latest.length" class="card latest-card" aria-labelledby="backups-latest-h">
            <div class="card-head">
              <h2 id="backups-latest-h">{{ t("backups.latest.title") }}</h2>
              <span class="card-meta">{{ t("backups.latest.meta") }}</span>
            </div>
            <ul class="latest">
              <li v-for="dir in latest" :key="dir.dir">
                <div class="latest-top">
                  <span :class="['tag', tierClass(dir.dir)]">{{ backupTierLabel(dir.dir) }}</span>
                  <span class="latest-count">{{ t("backups.latest.count", { count: dir.count }) }}</span>
                </div>
                <span class="file-name mono">{{ dir.latestFile }}</span>
                <span class="latest-when" :title="timestampTitle(dir.latestMtimeMs)">
                  {{ relativeAge(dir.latestMtimeMs) }}, {{ formatBytes(dir.latestSizeBytes) }}
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick } from "vue";
import Button from "primevue/button";
import { useNotify } from "../composables/useNotify";
import { backupTierLabel, formatBytes, ServerState, StatusRole, SERVER_STATE_ROLE } from "@mcbot/schema";
import { absoluteStamp, relativeAge, timestampTitle } from "../utils/time";
import { useBackups, type ScriptOutcome } from "../composables/useBackups";
import { useCapabilities } from "../composables/useCapabilities";
import { useConfirmAction } from "../composables/useConfirmAction";
import { useRowBusy } from "../composables/useRowBusy";
import { useServerStatus } from "../composables/useServerStatus";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StaleBanner from "../components/ui/StaleBanner.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import InlineError from "../components/ui/InlineError.vue";
import JobBlock from "../components/ui/JobBlock.vue";
import ResponsiveTable from "../components/ui/ResponsiveTable.vue";
import type { ResponsiveColumn } from "../components/ui/types";
import type { BackupDirInfo, BackupFileInfo, ServerStatus } from "../api";
import { t } from "../i18n";

type NeedKey = "create" | "restore" | "delete";

const PAGE_SIZE = 50;
const ARCHIVE_EXT = /\.(tar\.(zst|gz|xz|bz2)|tgz|zip)$/i;

interface Job {
  kind: "create" | "restore";
  title: string;
  state: "running" | "done" | "failed";
  startedAt: number;
  exitCode: number | null | undefined;
  output: string;
  note: string;
}

interface FilterChip {
  key: string;
  label: string;
  count: number;
}

function tierLeaf(tier: string): string {
  return (tier.split("/").pop() ?? tier).toLowerCase();
}

export default defineComponent({
  name: "BackupsView",
  components: {
    Button,
    ViewHeader,
    StaleBanner,
    EmptyState,
    InlineBanner,
    InlineError,
    JobBlock,
    ResponsiveTable,
  },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  emits: ["navigate"],
  setup() {
    const status = useServerStatus();
    const rowBusy = useRowBusy<string>();
    return {
      ...useBackups(),
      ...useCapabilities(),
      isBusy: rowBusy.isBusy,
      isLocked: rowBusy.isLocked,
      busyLabel: rowBusy.busyLabel,
      runRow: rowBusy.run,
      statusServers: status.servers,
      refreshStatus: status.refresh,
      confirmAction: useConfirmAction(),
      notify: useNotify(),
      t,
      formatBytes,
      backupTierLabel,
      absoluteStamp,
      relativeAge,
      timestampTitle,
    };
  },
  data() {
    return {
      current: "",
      filter: "all",
      job: null as Job | null,
      newIds: [] as string[],
      columns: [
        { key: "name", label: t("backups.col.name"), primary: true },
        { key: "tier", label: t("backups.col.tier") },
        { key: "created", label: t("backups.col.created") },
        { key: "size", label: t("backups.col.size"), align: "end", numeric: true },
      ] as ResponsiveColumn[],
    };
  },
  computed: {
    serverStatus(): ServerStatus | null {
      return this.statusServers.find((s) => s.id === this.current) ?? null;
    },
    serverRole(): StatusRole {
      const state = this.serverStatus?.state;
      return state ? SERVER_STATE_ROLE[state] : StatusRole.Unknown;
    },
    jobRunning(): boolean {
      return this.job?.state === "running";
    },
    /** A wrapper that positively lacks the feature hides the control; unknown keeps it. */
    createAvailable(): boolean {
      return this.serverStatus?.features?.scripts?.backup !== false;
    },
    restoreAvailable(): boolean {
      return this.serverStatus?.features?.restore !== false;
    },
    deleteAvailable(): boolean {
      return this.serverStatus?.features?.backupDelete !== false;
    },
    canCreate(): boolean {
      return this.can("server:control", this.current);
    },
    canRestore(): boolean {
      return this.can("backup:restore", this.current);
    },
    canDelete(): boolean {
      return this.can("backup:delete", this.current);
    },
    canDownload(): boolean {
      return this.can("backup:download", this.current);
    },
    missingCaps(): NeedKey[] {
      if (!this.current) return [];
      const missing: NeedKey[] = [];
      if (this.createAvailable && !this.canCreate) missing.push("create");
      if (this.restoreAvailable && !this.canRestore) missing.push("restore");
      if (this.deleteAvailable && !this.canDelete) missing.push("delete");
      return missing;
    },
    readOnlyTitle(): string {
      const offered = [this.createAvailable, this.restoreAvailable, this.deleteAvailable].filter(Boolean).length;
      return this.missingCaps.length === offered ? t("backups.readOnly.all") : t("backups.readOnly.some");
    },
    readOnlyText(): string {
      const parts = this.missingCaps.map((key) => t(`backups.readOnly.needs.${key}`));
      if (parts.length === 0) return "";
      const first = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1);
      const rest = parts.slice(1);
      const sentence =
        rest.length === 0
          ? first
          : t("backups.readOnly.join", { list: [first, ...rest.slice(0, -1)].join(", "), last: rest[rest.length - 1]! });
      return t("backups.readOnly.text", { needs: sentence });
    },
    staleAt(): string {
      return this.stale ? absoluteStamp(this.stale.asOf) : "";
    },
    listMeta(): string {
      if (this.stale) return t("backups.list.readAt", { at: this.staleAt });
      let zone = "";
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      } catch {
        zone = "";
      }
      return zone ? t("backups.list.zoneNamed", { zone }) : t("backups.list.zone");
    },
    metrics(): { count: number; bytes: number | null; newest: number | null } | null {
      const dirs = this.summary?.dirs ?? [];
      if (dirs.length === 0 && this.files.length === 0) return null;
      const count = dirs.length ? dirs.reduce((sum, d) => sum + d.count, 0) : this.total;
      const newestDir = dirs.reduce((max, d) => Math.max(max, d.latestMtimeMs), 0);
      const newest = newestDir || this.files[0]?.mtimeMs || null;
      return { count, bytes: this.summary ? this.summary.totalBytes : null, newest };
    },
    latest(): BackupDirInfo[] {
      return [...(this.summary?.dirs ?? [])].sort((a, b) => b.latestMtimeMs - a.latestMtimeMs);
    },
    filterChips(): FilterChip[] {
      const counts = new Map<string, FilterChip>();
      const dirs = this.summary?.dirs ?? [];
      if (dirs.length) {
        for (const d of dirs) {
          const key = tierLeaf(d.dir);
          const chip = counts.get(key) ?? { key, label: backupTierLabel(d.dir), count: 0 };
          chip.count += d.count;
          counts.set(key, chip);
        }
      } else {
        for (const f of this.files) {
          const key = tierLeaf(f.tier);
          const chip = counts.get(key) ?? { key, label: backupTierLabel(f.tier), count: 0 };
          chip.count += 1;
          counts.set(key, chip);
        }
      }
      const all = this.metrics?.count ?? this.total;
      return [{ key: "all", label: t("backups.filter.all"), count: all }, ...counts.values()];
    },
    visibleFiles(): BackupFileInfo[] {
      if (this.filter === "all") return this.files;
      return this.files.filter((f) => tierLeaf(f.tier) === this.filter);
    },
    nextPage(): number {
      return Math.max(1, Math.min(PAGE_SIZE, this.total - this.files.length));
    },
    footText(): string {
      if (this.stale) return t("backups.list.showingStale", { shown: this.files.length, total: this.total });
      if (this.filter !== "all") {
        const chip = this.filterChips.find((c) => c.key === this.filter);
        return t("backups.list.showingTier", {
          shown: this.visibleFiles.length,
          total: chip?.count ?? this.visibleFiles.length,
          tier: (chip?.label ?? "").toLowerCase(),
        });
      }
      return t("backups.list.showing", { shown: this.files.length, total: this.total });
    },
    errorDetail(): string {
      if (!this.current) return "";
      const status = this.errorStatus ?? t("backups.error.noResponse");
      return `GET /api/servers/${this.current}/backups/files -> ${status}`;
    },
  },
  watch: {
    activeServer(id: string) {
      if (id && id !== this.current) void this.select(id);
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (!this.current && ids.length > 0) {
          void this.select(
            this.activeServer && ids.includes(this.activeServer)
              ? this.activeServer
              : ids[0]!,
          );
        }
      },
    },
  },
  methods: {
    async select(id: string): Promise<void> {
      this.current = id;
      this.filter = "all";
      this.newIds = [];
      if (!this.jobRunning) this.job = null;
      await Promise.all([this.load(id), this.loadSummary(id), this.refreshStatus()]);
    },
    async reload(): Promise<void> {
      await Promise.all([this.load(this.current), this.loadSummary(this.current), this.refreshStatus()]);
    },
    stem(name: string): string {
      return name.replace(ARCHIVE_EXT, "");
    },
    tierClass(tier: string): string {
      const leaf = tierLeaf(tier);
      if (leaf === "update") return "tag-pre";
      if (leaf === "manual") return "tag-manual";
      return "tag-tier";
    },
    /** The row that started the job loses its buttons, so focus moves to the job. */
    async focusJob(): Promise<void> {
      await nextTick();
      const block = this.$refs.jobBlock as { $el?: HTMLElement } | undefined;
      block?.$el?.focus?.();
    },
    openServers(): void {
      this.$emit("navigate", "status");
    },
    async createBackup(): Promise<void> {
      if (this.jobRunning) return;
      const server = this.current;
      const startedAt = Date.now();
      this.job = {
        kind: "create",
        title: t("backups.create.runningTitle", { server }),
        state: "running",
        startedAt,
        exitCode: undefined,
        output: "",
        note: t("backups.create.runningNote"),
      };
      const outcome = await this.create();
      if (this.current !== server) return;
      await this.reload();
      if (outcome.ok) {
        this.job = null;
        const fresh = this.files.find((f) => f.mtimeMs >= startedAt - 1000);
        if (fresh) this.newIds = [fresh.id];
        this.notify.ok(
          t("backups.create.done"),
          fresh
            ? t("backups.create.doneDetail", { name: this.stem(fresh.name), size: formatBytes(fresh.sizeBytes) })
            : t("backups.create.doneNoFile"),
        );
        return;
      }
      this.job = {
        kind: "create",
        title: t("backups.create.failedTitle", { server }),
        state: "failed",
        startedAt,
        exitCode: outcome.exitCode,
        output: outcome.output,
        note: outcome.error
          ? t("backups.create.requestFailed", { message: outcome.error })
          : t("backups.create.failedNote"),
      };
    },
    blockedReason(server: string): string {
      const s = this.serverStatus;
      if (s?.state === ServerState.Offline) return "";
      if (s?.state === ServerState.Online) {
        const players = s.players ? t("backups.restore.withPlayers", { count: s.players.online }) : "";
        return t("backups.restore.blockedOnline", { server, players });
      }
      if (s?.state === ServerState.Unresponsive) return t("backups.restore.blockedUnresponsive", { server });
      return t("backups.restore.blockedUnknown", { server });
    },
    async confirmRestore(file: BackupFileInfo): Promise<void> {
      const server = this.current;
      await this.refreshStatus();
      const blocked = this.blockedReason(server);
      const when = absoluteStamp(file.mtimeMs);
      const result = await this.confirmAction({
        level: "irreversible",
        tone: "warn",
        header: t("backups.restore.header", { server, file: this.stem(file.name) }),
        message: t("backups.restore.message", { server, when }),
        acceptLabel: t("backups.restore.accept", { server }),
        expected: server,
        blockedReason: blocked,
        alternateLabel: blocked ? t("backups.restore.alternate", { server }) : "",
        facts: blocked
          ? [
              { term: t("backups.fact.backup"), detail: `${file.name}, ${when}`, mono: true },
              { term: t("backups.fact.effect"), detail: t("backups.restore.effect") },
              { term: t("backups.fact.recover"), detail: t("backups.restore.noUndo") },
            ]
          : [
              { term: t("backups.fact.server"), detail: t("backups.restore.serverStopped", { server }) },
              { term: t("backups.fact.applies"), detail: t("backups.restore.applies") },
              { term: t("backups.fact.recover"), detail: t("backups.restore.noUndo") },
            ],
      });
      if (result === "alternate") {
        this.openServers();
        return;
      }
      if (result !== "confirm" || blocked) return;
      await this.runRestore(server, file);
    },
    async runRestore(server: string, file: BackupFileInfo): Promise<void> {
      const startedAt = Date.now();
      this.job = {
        kind: "restore",
        title: t("backups.restore.runningTitle", { server, file: this.stem(file.name) }),
        state: "running",
        startedAt,
        exitCode: undefined,
        output: "",
        note: t("backups.restore.runningNote"),
      };
      void this.focusJob();
      const outcome: ScriptOutcome = await this.runRow(file.id, () => this.restore(file), {
        label: t("backups.restore.busy"),
        exclusive: true,
      });
      void this.refreshStatus();
      this.job = {
        kind: "restore",
        title: outcome.ok ? t("backups.restore.doneTitle") : t("backups.restore.failedTitle"),
        state: outcome.ok ? "done" : "failed",
        startedAt,
        exitCode: outcome.exitCode,
        output: outcome.output,
        note: this.restoreNote(server, outcome),
      };
    },
    restoreNote(server: string, outcome: ScriptOutcome): string {
      if (outcome.ok) return t("backups.restore.doneNote", { server });
      if (outcome.error) return t("backups.restore.requestFailed", { server, message: outcome.error });
      if (outcome.exitCode === 3) return t("backups.restore.refusedNote", { server });
      return t("backups.restore.failedNote", { server });
    },
    async confirmDelete(file: BackupFileInfo): Promise<void> {
      const result = await this.confirmAction({
        level: "irreversible",
        tone: "danger",
        header: t("backups.delete.header", { file: this.stem(file.name) }),
        message: t("backups.delete.message", { size: formatBytes(file.sizeBytes) }),
        acceptLabel: t("backups.delete.accept"),
        expected: t("backups.delete.word"),
        facts: [
          { term: t("backups.fact.created"), detail: absoluteStamp(file.mtimeMs) },
          { term: t("backups.fact.applies"), detail: t("backups.delete.applies") },
          { term: t("backups.fact.recover"), detail: t("backups.delete.recover") },
        ],
      });
      if (result !== "confirm") return;
      const outcome = await this.runRow(file.id, () => this.remove(file), { label: t("backups.delete.busy") });
      if (outcome.ok) this.notify.ok(t("backups.delete.done"), this.stem(file.name));
      else this.notify.fail(t("backups.delete.failed"), outcome.error);
    },
  },
});
</script>

<style scoped>
.backups-view { container-type: inline-size; min-width: 0; }
.stack-gap { display: flex; flex-direction: column; gap: var(--space-4); }
.stack-gap :deep(.stale-banner) { margin-bottom: 0; }

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
}
.metric {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.metric-n { font-size: var(--text-2xl); font-weight: 600; font-variant-numeric: tabular-nums; line-height: var(--leading-tight); }
.metric-l { color: var(--text-dim); font-size: var(--text-sm); }

.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); align-items: start; }
@container (min-width: 1100px) {
  .layout { grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); }
}
@container (min-width: 1960px) {
  .layout { grid-template-columns: minmax(0, 1700px) minmax(260px, 380px); }
}

.card {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}
.card-head h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.card-meta { color: var(--text-dim); font-size: var(--text-sm); flex: 1 1 auto; }
.cluster { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }

.filters { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-3); }
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 30px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--dur-fast), border-color var(--dur-fast);
}
.chip:hover { border-color: var(--border-hover); background: var(--surface); }
.chip.on { background: var(--accent-tint); border-color: var(--accent); }
.chip-n { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.chip.on .chip-n { color: var(--text); }

.file-name { font-size: var(--text-xs); overflow-wrap: anywhere; }
.tag {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  font-size: var(--text-xs);
  white-space: nowrap;
}
.tag-tier { background: var(--surface-raised); color: var(--text); }
.tag-pre { background: var(--st-info-bg); color: var(--st-info); }
.tag-manual { border-color: var(--accent); color: var(--accent); }
.tag-new { margin-left: var(--space-2); background: var(--accent); color: var(--on-accent); font-weight: 600; }
.when { display: inline-flex; flex-direction: column; white-space: nowrap; }
.row-actions { flex-wrap: nowrap; justify-content: flex-end; }
.rel { color: var(--text-dim); font-size: var(--text-xs); }
.row-busy { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--st-info); font-size: var(--text-sm); }

.skeleton { display: flex; flex-direction: column; gap: var(--space-2); }
.sk-row { height: 36px; border-radius: var(--radius-control); background: var(--surface-raised); opacity: 0.6; }

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-3);
}
.foot-count { color: var(--text-dim); font-size: var(--text-sm); }

.latest { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.latest li {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.latest li:last-child { border-bottom: none; }
.latest-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.latest-count, .latest-when { color: var(--text-dim); font-size: var(--text-sm); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
  .chip.tap { min-height: var(--touch-min); }
}
</style>
