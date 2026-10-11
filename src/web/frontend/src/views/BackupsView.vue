<template>
  <div class="backups-view">
    <ViewHeader
      :title="COPY.title"
      :server="current"
      :server-state="serverRole"
    >
      <template v-if="current" #subtitle>
        {{ COPY.purposeBefore }} <strong>{{ current }}</strong>. {{ COPY.purposeAfter(current) }}
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server">
      {{ COPY.noServers }}
    </EmptyState>

    <template v-else>
      <div v-if="serverIds.length > 1" class="picker" role="group" :aria-label="COPY.pickServer">
        <Button
          v-for="id in serverIds"
          :key="id"
          class="tap"
          :label="id"
          size="small"
          :severity="id === current ? 'primary' : 'secondary'"
          :outlined="id !== current"
          :aria-pressed="id === current"
          @click="select(id)"
        />
      </div>

      <div class="stack-gap">
        <InlineBanner v-if="missingCaps.length" tone="info" :title="readOnlyTitle">
          {{ readOnlyText }}
        </InlineBanner>

        <StaleBanner :stale="stale">
          {{ COPY.staleText(staleAt, current) }}
          <template #actions>
            <Button class="tap" :label="COPY.retry" size="small" outlined :loading="loading" @click="reload" />
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
              :label="COPY.tryAgain"
              size="small"
              @click="createBackup"
            />
            <Button
              v-if="job.kind === 'restore'"
              class="tap"
              :label="COPY.openServers"
              size="small"
              :outlined="job.state === 'failed'"
              @click="openServers"
            />
            <Button class="tap" :label="COPY.dismiss" size="small" severity="secondary" text @click="job = null" />
          </template>
        </JobBlock>

        <div v-if="metrics" class="metrics">
          <div class="metric">
            <span class="metric-n">{{ metrics.count }}</span>
            <span class="metric-l">{{ COPY.metricCount(current) }}</span>
          </div>
          <div v-if="metrics.bytes !== null" class="metric">
            <span class="metric-n">{{ formatBytes(metrics.bytes) }}</span>
            <span class="metric-l">{{ COPY.metricBytes }}</span>
          </div>
          <div v-if="metrics.newest !== null" class="metric">
            <span class="metric-n" :title="timestampTitle(metrics.newest)">{{ relativeAge(metrics.newest) }}</span>
            <span class="metric-l">{{ COPY.metricNewest }}</span>
          </div>
        </div>

        <div class="layout">
          <section class="card list-card" aria-labelledby="backups-list-h" :aria-busy="loading ? 'true' : undefined">
            <div class="card-head">
              <h2 id="backups-list-h">{{ COPY.listTitle }} <span class="mono">{{ current }}</span></h2>
              <span class="card-meta">{{ listMeta }}</span>
              <span class="cluster">
                <Button
                  class="tap"
                  icon="pi pi-refresh"
                  :label="COPY.reload"
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
                  :label="COPY.create"
                  size="small"
                  :disabled="!canCreate || jobRunning"
                  @click="createBackup"
                />
              </span>
            </div>

            <div v-if="filterChips.length > 1 && files.length" class="filters" role="group" :aria-label="COPY.filterLabel">
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
              <span class="sr-only">{{ COPY.loading(current) }}</span>
              <span v-for="n in 5" :key="n" class="sk-row" aria-hidden="true" />
            </div>

            <InlineError
              v-else-if="error && files.length === 0"
              :title="COPY.errorTitle"
              :recovery="COPY.errorRecovery(current)"
              :detail="errorDetail"
              :busy="loading"
              @retry="reload"
            >
              <template #actions>
                <Button class="tap" :label="COPY.openServers" size="small" outlined @click="openServers" />
              </template>
            </InlineError>

            <EmptyState
              v-else-if="files.length === 0"
              icon="pi pi-box"
              :title="COPY.emptyTitle(current)"
            >
              {{ COPY.emptyText }}
              <template v-if="createAvailable && canCreate" #action>
                <Button class="tap" icon="pi pi-plus" :label="COPY.create" :disabled="jobRunning" @click="createBackup" />
              </template>
            </EmptyState>

            <template v-else>
              <ResponsiveTable
                :columns="columns"
                :rows="visibleFiles"
                :caption="COPY.caption(current)"
                :row-key="(f: BackupFileInfo) => f.id"
                :busy="(f: BackupFileInfo) => isBusy(f.id)"
                :actions-label="COPY.actions"
                :actions-label-visible="false"
              >
                <template #cell-name="{ row }">
                  <span class="file-name mono">{{ row.name }}</span>
                  <span v-if="newIds.includes(row.id)" class="tag tag-new">{{ COPY.newTag }}</span>
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
                      :aria-label="`${COPY.download} ${stem(row.name)}`"
                      v-tooltip.top="COPY.download"
                      @click="download(row.id)"
                    />
                    <Button
                      v-if="restoreAvailable"
                      class="tap"
                      icon="pi pi-replay"
                      :label="COPY.restore"
                      size="small"
                      severity="secondary"
                      outlined
                      :aria-label="`${COPY.restore} ${stem(row.name)}`"
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
                      :aria-label="`${COPY.delete} ${stem(row.name)}`"
                      v-tooltip.top="COPY.delete"
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
                  :label="COPY.loadMore(nextPage)"
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
              <h2 id="backups-latest-h">{{ COPY.latestTitle }}</h2>
              <span class="card-meta">{{ COPY.latestMeta }}</span>
            </div>
            <ul class="latest">
              <li v-for="dir in latest" :key="dir.dir">
                <div class="latest-top">
                  <span :class="['tag', tierClass(dir.dir)]">{{ backupTierLabel(dir.dir) }}</span>
                  <span class="latest-count">{{ COPY.countBackups(dir.count) }}</span>
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
import { useToast } from "primevue/usetoast";
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

const COPY = {
  title: "Backups",
  purposeBefore: "Browse, create, restore and delete backups of",
  purposeAfter: (server: string) =>
    `Restoring replaces the server files and needs ${server} stopped first.`,
  noServers: "No servers you can view.",
  pickServer: "Server",
  retry: "Retry",
  tryAgain: "Try again",
  dismiss: "Dismiss",
  openServers: "Open Servers",
  reload: "Reload",
  create: "Create backup",
  restore: "Restore",
  delete: "Delete",
  download: "Download",
  actions: "Actions",
  newTag: "New",
  listTitle: "Backups of",
  latestTitle: "Latest per type",
  latestMeta: "One folder per type",
  filterLabel: "Filter by type",
  all: "All",
  caption: (server: string) => `Backups of ${server}, newest first`,
  loading: (server: string) => `Loading backups of ${server}`,
  metricCount: (server: string) => `backups of ${server}`,
  metricBytes: "used by backups",
  metricNewest: "newest backup",
  countBackups: (n: number) => (n === 1 ? "1 backup" : `${n} backups`),
  zone: (zone: string) => `Times in your zone${zone ? `, ${zone}` : ""}`,
  readAt: (at: string) => `Read at ${at}`,
  showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  showingTier: (shown: number, total: number, tier: string) =>
    `Showing ${shown} of ${total} ${tier.toLowerCase()}`,
  showingStale: (shown: number, total: number) =>
    `Showing ${shown} of ${total}, from memory. Loading more needs the wrapper.`,
  loadMore: (n: number) => `Load ${n} more`,
  staleText: (at: string, server: string) =>
    `Showing the list from ${at}. The API wrapper for ${server} is not answering, so newer backups may be missing. Restore and Delete need the wrapper and will fail until it is back.`,
  readOnlyAll: "You can see the backups but not change them.",
  readOnlySome: "Some backup actions are off for you.",
  needs: {
    create: "Creating needs server:control",
    restore: "restoring backup:restore",
    delete: "deleting backup:delete",
  },
  askSysadmin: "Ask a sysadmin for the ones you need.",
  errorTitle: "The backup list did not load",
  errorRecovery: (server: string) =>
    `The dashboard could not get the list from the API wrapper for ${server}, and it has no earlier copy to show. Your backup files are not affected. Try again, or check that the wrapper is running.`,
  emptyTitle: (server: string) => `No backups of ${server} yet`,
  emptyText:
    "The wrapper lists no backup for this server. You can make one now; the list updates when the script finishes.",
  creatingTitle: (server: string) => `Creating a backup of ${server}`,
  creatingNote:
    "The script does not report progress, so this bar only shows that it is still running. The result appears here when it ends.",
  createFailedTitle: (server: string) => `Creating a backup of ${server} failed`,
  createFailedNote: "Check the output, fix the cause, then try again.",
  createRequestFailed: (message: string) =>
    `The dashboard did not get a result: ${message}. The script may still have run; reload the list to check.`,
  createdSummary: "Backup created",
  createdDetail: (name: string, size: string) => `${name}, ${size}. It is at the top of the list.`,
  createdNoFile: "The script finished. The list is reloaded.",
  restoringTitle: (server: string, file: string) => `Restoring ${server} from ${file}`,
  restoringNote:
    "The restore script unpacks the archive next to the server folder and swaps it in when that worked. The wrapper waits up to 10 minutes. Keep this tab open: the result is reported here. Restore and Delete are off in the list until it ends.",
  restoredTitle: "Restore finished",
  restoredNote: (server: string) =>
    `${server} is still stopped. Start it in Servers. The last 4000 characters of the output are shown.`,
  restoreFailedTitle: "Restore failed",
  restoreFailedNote: (server: string) =>
    `The archive is unpacked next to the server folder and swapped in only when that worked, so the current files were not replaced. ${server} is still stopped. Check the output, fix the cause, then try again.`,
  restoreRefusedNote: (server: string) =>
    `The restore script refused to run because ${server} was not stopped. Nothing was changed. Stop ${server} in Servers, then try again.`,
  restoreRequestFailed: (server: string, message: string) =>
    `The dashboard did not get a result from the wrapper: ${message}. Check the bot logs, and check ${server} before starting it.`,
  restoreHeader: (server: string, file: string) => `Restore ${server} from ${file}?`,
  restoreMessage: (server: string, when: string) =>
    `This replaces the server files of ${server} with the backup from ${when}. Everything changed since then is gone from the live files.`,
  restoreAccept: (server: string) => `Restore ${server}`,
  restoreAlternate: (server: string) => `Open Servers to stop ${server}`,
  blockedOnline: (server: string, players: string) =>
    `${server} is online${players}. The restore script refuses to run while the server is up. Stop ${server} first, then come back.`,
  blockedUnresponsive: (server: string) =>
    `${server} is not responding, which still counts as running. The restore only runs on a server that is confirmed stopped. Stop ${server} first, then come back.`,
  blockedUnknown: (server: string) =>
    `The dashboard cannot tell whether ${server} is stopped. The restore only runs on a server that is confirmed stopped. Check ${server} in Servers, then come back.`,
  withPlayers: (n: number) => (n === 1 ? " with 1 player" : ` with ${n} players`),
  factBackup: "Backup",
  factServer: "Server",
  factEffect: "Effect",
  factApplies: "Applies",
  factRecover: "Recover",
  factCreated: "Created",
  serverStopped: (server: string) => `${server} is stopped, so the restore can run. It stays stopped afterwards.`,
  effect: "Replaces the server files (world, mods, config) with the archive. Everything changed since is gone.",
  appliesRestore: "Now. The archive is unpacked next to the server folder first and swapped in only when that worked.",
  noUndo: "There is no undo. Create a backup of the current state first if you may want it back.",
  deleteHeader: (file: string) => `Delete ${file}?`,
  deleteMessage: (size: string) => `The backup file (${size}) is removed from the host. It cannot be recovered.`,
  deleteApplies: "Now. No player is affected.",
  deleteRecover: "Not possible. If you may need it, copy it off the host first.",
  deleteAccept: "Delete backup",
  deleteWord: "delete",
  deleting: "Deleting",
  restoring: "Restoring",
  deletedSummary: "Backup deleted",
  deleteFailed: "Delete failed",
} as const;

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
      toast: useToast(),
      COPY,
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
        { key: "name", label: "Backup", primary: true },
        { key: "tier", label: "Type" },
        { key: "created", label: "Created" },
        { key: "size", label: "Size", align: "end", numeric: true },
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
    missingCaps(): Array<keyof typeof COPY.needs> {
      if (!this.current) return [];
      const missing: Array<keyof typeof COPY.needs> = [];
      if (this.createAvailable && !this.canCreate) missing.push("create");
      if (this.restoreAvailable && !this.canRestore) missing.push("restore");
      if (this.deleteAvailable && !this.canDelete) missing.push("delete");
      return missing;
    },
    readOnlyTitle(): string {
      const offered = [this.createAvailable, this.restoreAvailable, this.deleteAvailable].filter(Boolean).length;
      return this.missingCaps.length === offered ? COPY.readOnlyAll : COPY.readOnlySome;
    },
    readOnlyText(): string {
      const parts = this.missingCaps.map((key) => COPY.needs[key]);
      if (parts.length === 0) return "";
      const first = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1);
      const rest = parts.slice(1);
      const sentence =
        rest.length === 0
          ? first
          : `${[first, ...rest.slice(0, -1)].join(", ")} and ${rest[rest.length - 1]}`;
      return `${sentence}. ${COPY.askSysadmin}`;
    },
    staleAt(): string {
      return this.stale ? absoluteStamp(this.stale.asOf) : "";
    },
    listMeta(): string {
      if (this.stale) return COPY.readAt(this.staleAt);
      let zone = "";
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      } catch {
        zone = "";
      }
      return COPY.zone(zone);
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
      return [{ key: "all", label: COPY.all, count: all }, ...counts.values()];
    },
    visibleFiles(): BackupFileInfo[] {
      if (this.filter === "all") return this.files;
      return this.files.filter((f) => tierLeaf(f.tier) === this.filter);
    },
    nextPage(): number {
      return Math.max(1, Math.min(PAGE_SIZE, this.total - this.files.length));
    },
    footText(): string {
      if (this.stale) return COPY.showingStale(this.files.length, this.total);
      if (this.filter !== "all") {
        const chip = this.filterChips.find((c) => c.key === this.filter);
        return COPY.showingTier(this.visibleFiles.length, chip?.count ?? this.visibleFiles.length, chip?.label ?? "");
      }
      return COPY.showing(this.files.length, this.total);
    },
    errorDetail(): string {
      if (!this.current) return "";
      const status = this.errorStatus ?? "no response";
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
        title: COPY.creatingTitle(server),
        state: "running",
        startedAt,
        exitCode: undefined,
        output: "",
        note: COPY.creatingNote,
      };
      const outcome = await this.create();
      if (this.current !== server) return;
      await this.reload();
      if (outcome.ok) {
        this.job = null;
        const fresh = this.files.find((f) => f.mtimeMs >= startedAt - 1000);
        if (fresh) this.newIds = [fresh.id];
        this.toast.add({
          severity: "success",
          summary: COPY.createdSummary,
          detail: fresh ? COPY.createdDetail(this.stem(fresh.name), formatBytes(fresh.sizeBytes)) : COPY.createdNoFile,
          life: 5000,
        });
        return;
      }
      this.job = {
        kind: "create",
        title: COPY.createFailedTitle(server),
        state: "failed",
        startedAt,
        exitCode: outcome.exitCode,
        output: outcome.output,
        note: outcome.error ? COPY.createRequestFailed(outcome.error) : COPY.createFailedNote,
      };
    },
    blockedReason(server: string): string {
      const s = this.serverStatus;
      if (s?.state === ServerState.Offline) return "";
      if (s?.state === ServerState.Online) {
        const players = s.players ? COPY.withPlayers(s.players.online) : "";
        return COPY.blockedOnline(server, players);
      }
      if (s?.state === ServerState.Unresponsive) return COPY.blockedUnresponsive(server);
      return COPY.blockedUnknown(server);
    },
    async confirmRestore(file: BackupFileInfo): Promise<void> {
      const server = this.current;
      await this.refreshStatus();
      const blocked = this.blockedReason(server);
      const when = absoluteStamp(file.mtimeMs);
      const result = await this.confirmAction({
        level: "irreversible",
        tone: "warn",
        header: COPY.restoreHeader(server, this.stem(file.name)),
        message: COPY.restoreMessage(server, when),
        acceptLabel: COPY.restoreAccept(server),
        expected: server,
        blockedReason: blocked,
        alternateLabel: blocked ? COPY.restoreAlternate(server) : "",
        facts: blocked
          ? [
              { term: COPY.factBackup, detail: `${file.name}, ${when}`, mono: true },
              { term: COPY.factEffect, detail: COPY.effect },
              { term: COPY.factRecover, detail: COPY.noUndo },
            ]
          : [
              { term: COPY.factServer, detail: COPY.serverStopped(server) },
              { term: COPY.factApplies, detail: COPY.appliesRestore },
              { term: COPY.factRecover, detail: COPY.noUndo },
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
        title: COPY.restoringTitle(server, this.stem(file.name)),
        state: "running",
        startedAt,
        exitCode: undefined,
        output: "",
        note: COPY.restoringNote,
      };
      void this.focusJob();
      const outcome: ScriptOutcome = await this.runRow(file.id, () => this.restore(file), {
        label: COPY.restoring,
        exclusive: true,
      });
      void this.refreshStatus();
      this.job = {
        kind: "restore",
        title: outcome.ok ? COPY.restoredTitle : COPY.restoreFailedTitle,
        state: outcome.ok ? "done" : "failed",
        startedAt,
        exitCode: outcome.exitCode,
        output: outcome.output,
        note: this.restoreNote(server, outcome),
      };
    },
    restoreNote(server: string, outcome: ScriptOutcome): string {
      if (outcome.ok) return COPY.restoredNote(server);
      if (outcome.error) return COPY.restoreRequestFailed(server, outcome.error);
      if (outcome.exitCode === 3) return COPY.restoreRefusedNote(server);
      return COPY.restoreFailedNote(server);
    },
    async confirmDelete(file: BackupFileInfo): Promise<void> {
      const result = await this.confirmAction({
        level: "irreversible",
        tone: "danger",
        header: COPY.deleteHeader(this.stem(file.name)),
        message: COPY.deleteMessage(formatBytes(file.sizeBytes)),
        acceptLabel: COPY.deleteAccept,
        expected: COPY.deleteWord,
        facts: [
          { term: COPY.factCreated, detail: absoluteStamp(file.mtimeMs) },
          { term: COPY.factApplies, detail: COPY.deleteApplies },
          { term: COPY.factRecover, detail: COPY.deleteRecover },
        ],
      });
      if (result !== "confirm") return;
      const outcome = await this.runRow(file.id, () => this.remove(file), { label: COPY.deleting });
      this.toast.add({
        severity: outcome.ok ? "success" : "error",
        summary: outcome.ok ? COPY.deletedSummary : COPY.deleteFailed,
        detail: outcome.ok ? this.stem(file.name) : outcome.error,
        life: outcome.ok ? 4000 : 6000,
      });
    },
  },
});
</script>

<style scoped>
.backups-view { container-type: inline-size; min-width: 0; }
.picker { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-3); }
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
