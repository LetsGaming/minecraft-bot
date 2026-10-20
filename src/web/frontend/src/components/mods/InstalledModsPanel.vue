<template>
  <section class="card" aria-labelledby="mods-installed-h" :aria-busy="inst.loading.value ? 'true' : undefined">
    <div class="card-head">
      <h2 id="mods-installed-h">{{ t("mods.installed.title") }}</h2>
      <span class="card-meta">{{ installedMeta }}</span>
      <span v-if="inst.installed.value" class="cluster">
        <Button
          class="tap"
          icon="pi pi-refresh"
          :label="t('mods.installed.lookForUpdates')"
          size="small"
          severity="secondary"
          outlined
          :loading="inst.checkingUpdates.value"
          @click="inst.refreshUpdates(true)"
        />
        <Button
          v-if="canWrite && inst.updateCount.value > 0"
          class="tap"
          icon="pi pi-arrow-circle-up"
          :label="t('mods.installed.updateAll', { count: inst.updateCount.value })"
          size="small"
          :loading="inst.applyingAll.value"
          @click="applyAll"
        />
      </span>
    </div>

    <ModCompatCheck
      ref="compatCheck"
      :server="server"
      :installed="inst.installed.value"
      :check="check"
      :filter="filter"
      @update-route="emit('update-route', $event)"
    >
      <template #default>
        <div v-if="inst.loading.value && !inst.installed.value" class="skeleton" role="status">
          <span class="sr-only">{{ t("mods.installed.loading", { server }) }}</span>
          <span v-for="n in 5" :key="n" class="sk-row" aria-hidden="true">
            <span class="sk-tile" />
            <span class="sk-lines"><span /><span /></span>
          </span>
        </div>

        <InlineError
          v-else-if="inst.loadError.value && !inst.installed.value"
          :title="t('mods.installed.loadFailed')"
          :recovery="t('mods.installed.loadFailedRecovery', { server })"
          :detail="loadErrorDetail"
          :retry-label="t('mods.reload')"
          :busy="inst.loading.value"
          @retry="emit('reload')"
        />

        <EmptyState
          v-else-if="inst.installed.value && inst.mods.value.length === 0"
          icon="pi pi-box"
          :title="t('mods.installed.emptyTitle', { server })"
        >
          {{ t("mods.installed.emptyText") }}
          <template v-if="canWrite" #action>
            <Button class="tap" icon="pi pi-search" :label="t('mods.installed.searchModrinth')" @click="emit('focus-catalog')" />
          </template>
        </EmptyState>

        <template v-else-if="inst.installed.value">
          <div class="notices">
            <StaleBanner v-if="inst.installed.value.stale" :stale="inst.installed.value.stale">
              {{ t("mods.installed.staleText", { age: relativeAgeLong(inst.installed.value.stale.asOf), server }) }}
              <template #actions>
                <Button class="tap" :label="t('mods.reload')" size="small" outlined :loading="inst.loading.value" @click="emit('reload')" />
              </template>
            </StaleBanner>
            <InlineBanner v-if="inst.loadError.value" tone="warn" :title="t('mods.installed.reloadFailed')">
              {{ t("mods.installed.reloadFailedText", { server, message: inst.loadError.value.message || String(inst.loadError.value.status ?? "") }) }}
              <template #actions>
                <Button class="tap" :label="t('mods.reload')" size="small" outlined :loading="inst.loading.value" @click="emit('reload')" />
              </template>
            </InlineBanner>
            <InlineBanner v-if="inst.updatesError.value" tone="warn" :title="t('mods.installed.updatesFailed')">
              {{ t("mods.installed.updatesFailedText", { message: inst.updatesError.value }) }}
              <template #actions>
                <Button
                  class="tap"
                  :label="t('mods.installed.lookForUpdates')"
                  size="small"
                  outlined
                  :loading="inst.checkingUpdates.value"
                  @click="inst.refreshUpdates(true)"
                />
              </template>
            </InlineBanner>
          </div>

          <div class="toolbar">
            <span class="search">
              <i class="pi pi-search" aria-hidden="true" />
              <label class="sr-only" for="mods-installed-q">{{ t("mods.installed.search") }}</label>
              <InputText
                id="mods-installed-q"
                v-model="installedQuery"
                type="search"
                class="tap"
                :placeholder="t('mods.installed.searchPlaceholder', { count: inst.mods.value.length })"
              />
            </span>
            <Select
              v-model="statusFilter"
              class="tap filter-select"
              :options="statusOptions"
              option-label="label"
              option-value="value"
              :aria-label="t('mods.installed.filterStatus')"
            />
            <Select
              v-model="installedSort"
              class="tap filter-select"
              :options="installedSortOptions"
              option-label="label"
              option-value="value"
              :aria-label="t('mods.installed.sortLabel')"
            />
          </div>

          <div v-if="canWrite && selection.selected.size > 0" class="bulk" role="group" :aria-label="t('mods.bulk.label')">
            <span class="bulk-count" aria-live="polite">{{ t("mods.bulk.selected", { count: selection.selected.size }) }}</span>
            <span class="cluster">
              <Button
                class="tap"
                :label="t('mods.installed.disable')"
                size="small"
                severity="secondary"
                outlined
                :disabled="bulkRunning"
                @click="bulkDisable()"
              />
              <Button
                class="tap"
                :label="t('mods.installed.remove')"
                icon="pi pi-trash"
                size="small"
                severity="danger"
                outlined
                :disabled="bulkRunning"
                @click="bulkRemove()"
              />
              <Button
                class="tap"
                :label="t('mods.bulk.clear')"
                size="small"
                severity="secondary"
                text
                :disabled="bulkRunning"
                @click="selection.clear()"
              />
            </span>
          </div>

          <ResponsiveTable
            v-if="pagedInstalled.length"
            stack-below="narrow"
            :columns="installedColumns"
            :rows="pagedInstalled"
            :caption="t('mods.installed.caption', { server })"
            :row-key="(m: InstalledMod) => m.slug"
            :busy="(m: InstalledMod) => inst.isBusy(m.slug)"
            :actions-label="t('mods.installed.actions')"
            :actions-label-visible="false"
          >
            <template v-if="canWrite" #select-head>
              <Checkbox
                binary
                :model-value="selection.allPageSelected.value"
                :aria-label="t('mods.bulk.selectPage')"
                @update:model-value="selection.togglePage"
              />
            </template>
            <template v-if="canWrite" #select="{ row }">
              <Checkbox
                binary
                :model-value="selection.selected.has(row.slug)"
                :aria-label="t('mods.bulk.selectNamed', { name: nameOf(row) })"
                @update:model-value="selection.toggle(row.slug)"
              />
            </template>
            <template #cell-mod="{ row }">
              <ModCell
                :name="nameOf(row)"
                :slug="row.slug"
                :icon-url="row.iconUrl ?? ''"
                :size="36"
                :filename="row.filename ?? ''"
                :off="row.enabled === false"
              />
            </template>
            <template #cell-version="{ row }">
              <span class="mono version">{{ row.versionId ?? "" }}</span>
            </template>
            <template #cell-status="{ row }">
              <StatusChip v-bind="statusOf(row)" />
            </template>
            <template #actions="{ row, busy }">
              <span v-if="busy" class="row-busy" role="status">
                {{ inst.busyLabel(row.slug) }}. {{ t("mods.installed.rowBusyNote") }}
              </span>
              <span v-else class="cluster row-actions">
                <Button
                  v-if="canWrite && inst.hasUpdate(row.slug)"
                  class="tap"
                  :label="t('mods.installed.update')"
                  size="small"
                  :aria-label="t('mods.installed.updateNamed', { name: nameOf(row) })"
                  :disabled="inst.isLocked(row.slug)"
                  @click="act(row, 'update')"
                />
                <Button
                  v-if="canWrite"
                  class="tap"
                  :label="row.enabled === false ? t('mods.installed.enable') : t('mods.installed.disable')"
                  size="small"
                  severity="secondary"
                  outlined
                  :aria-label="
                    row.enabled === false
                      ? t('mods.installed.enableNamed', { name: nameOf(row) })
                      : t('mods.installed.disableNamed', { name: nameOf(row) })
                  "
                  :disabled="inst.isLocked(row.slug)"
                  @click="act(row, row.enabled === false ? 'enable' : 'disable')"
                />
                <a
                  class="icon-link tap"
                  :href="modrinthUrl(row.slug)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="t('mods.installed.openNamed', { name: nameOf(row) })"
                  :title="t('mods.installed.openModrinth')"
                ><i class="pi pi-external-link" aria-hidden="true" /></a>
                <Button
                  v-if="canWrite"
                  class="tap"
                  :label="t('mods.installed.remove')"
                  icon="pi pi-trash"
                  size="small"
                  severity="danger"
                  outlined
                  :aria-label="t('mods.installed.removeNamed', { name: nameOf(row) })"
                  :disabled="inst.isLocked(row.slug)"
                  @click="confirmRemove(row)"
                />
              </span>
            </template>
          </ResponsiveTable>
          <p v-else class="none-in-filter small dim">{{ t("mods.installed.noMatch") }}</p>

          <div class="foot">
            <span class="foot-count" aria-live="polite">
              {{ t("mods.installed.showingRange", { from: pageFrom, to: pageTo, total: visibleInstalled.length }) }}
            </span>
            <PagerNav
              v-if="installedPages > 1"
              v-model:page="installedPage"
              :pages="installedPages"
              :label="t('mods.installed.pagination')"
            />
          </div>
        </template>
      </template>
    </ModCompatCheck>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { StatusRole, type StatusInput } from "@mcbot/schema";
import { t, type MessageKey } from "../../i18n";
import { relativeAgeLong } from "../../utils/time";
import { modrinthUrl } from "../../utils/modsFormat";
import type { InstalledMod } from "../../api";
import { useConfirmAction } from "../../composables/useConfirmAction";
import type { RowAction, RowOutcome, useInstalledMods } from "../../composables/useInstalledMods";
import { useModSelection } from "../../composables/useModSelection";
import { useNotify } from "../../composables/useNotify";
import EmptyState from "../ui/EmptyState.vue";
import InlineBanner from "../ui/InlineBanner.vue";
import InlineError from "../ui/InlineError.vue";
import ResponsiveTable from "../ui/ResponsiveTable.vue";
import StaleBanner from "../ui/StaleBanner.vue";
import StatusChip from "../ui/StatusChip.vue";
import type { ResponsiveColumn } from "../ui/types";
import ModCell from "./ModCell.vue";
import ModCompatCheck from "./ModCompatCheck.vue";
import PagerNav from "./PagerNav.vue";

const props = withDefaults(
  defineProps<{
    /** The installed-mods state; the page owns it because its summary and pending bar read it too. */
    inst: ReturnType<typeof useInstalledMods>;
    server: string;
    canWrite: boolean;
    playersOnline: number;
    /** Minecraft version from the URL (`?check=`) to run the upgrade check for. */
    check?: string;
    /** Result filter from the URL (`?filter=blockers` or `?filter=ready`). */
    filter?: string;
  }>(),
  { check: "", filter: "" },
);
const emit = defineEmits<{
  reload: [];
  "focus-catalog": [];
  /** A mod was removed or updated, so the catalogue's installed flags are out of date. */
  "catalog-refresh": [];
  "update-route": [patch: { query: Record<string, string | undefined> }];
}>();

const INSTALLED_PAGE = 15;
const BUSY_LABEL: Record<RowAction, MessageKey> = {
  update: "mods.busy.update",
  remove: "mods.busy.remove",
  disable: "mods.busy.disable",
  enable: "mods.busy.enable",
};
const FAILED: Record<RowAction, MessageKey> = {
  update: "mods.toast.updateFailed",
  remove: "mods.toast.removeFailed",
  disable: "mods.toast.toggleFailed",
  enable: "mods.toast.toggleFailed",
};

type StatusFilter = "all" | "enabled" | "disabled" | "updates";
type InstalledSort = "name-asc" | "name-desc";

const inst = props.inst;
const confirmAction = useConfirmAction();
const notify = useNotify();
const compatCheck = ref<InstanceType<typeof ModCompatCheck> | null>(null);

const installedQuery = ref("");
const statusFilter = ref<StatusFilter>("all");
const installedSort = ref<InstalledSort>("name-asc");
const installedPage = ref(1);
const bulkRunning = ref(false);

/** The compat check knows a project's display name; the installed list only has the slug. */
function nameOf(m: { slug: string; name?: string }): string {
  return compatCheck.value?.nameOf(m) ?? (m.name || m.slug);
}

const statusOptions = computed<Array<{ value: StatusFilter; label: string }>>(() => [
  { value: "all", label: t("mods.installed.statusAll") },
  { value: "enabled", label: t("mods.installed.statusEnabled") },
  { value: "disabled", label: t("mods.installed.statusDisabled") },
  ...(inst.updateCount.value > 0
    ? [{ value: "updates" as const, label: `${t("mods.installed.onlyUpdates")} (${inst.updateCount.value})` }]
    : []),
]);
const installedSortOptions = computed<Array<{ value: InstalledSort; label: string }>>(() => [
  { value: "name-asc", label: t("mods.installed.sortNameAsc") },
  { value: "name-desc", label: t("mods.installed.sortNameDesc") },
]);

const installedColumns = computed<ResponsiveColumn[]>(() => [
  { key: "mod", label: t("mods.installed.colMod"), primary: true },
  { key: "version", label: t("mods.installed.colVersion") },
  { key: "status", label: t("mods.installed.colStatus") },
]);

const installedMeta = computed(() => {
  const list = inst.installed.value;
  if (!list) return "";
  const parts = [t("mods.installed.count", { count: list.mods.length })];
  if (inst.updateCount.value > 0) parts.push(t("mods.installed.updates", { count: inst.updateCount.value }));
  return parts.join(", ");
});

const visibleInstalled = computed(() => {
  const q = installedQuery.value.trim().toLowerCase();
  const filter = statusFilter.value;
  const list = inst.mods.value.filter((m) => {
    if (filter === "updates" && !inst.hasUpdate(m.slug)) return false;
    if (filter === "enabled" && m.enabled === false) return false;
    if (filter === "disabled" && m.enabled !== false) return false;
    if (!q) return true;
    return (
      m.slug.toLowerCase().includes(q) ||
      (m.filename ?? "").toLowerCase().includes(q) ||
      nameOf(m).toLowerCase().includes(q)
    );
  });
  const dir = installedSort.value === "name-asc" ? 1 : -1;
  return list.sort((a, b) => dir * nameOf(a).localeCompare(nameOf(b)));
});

const installedPages = computed(() => Math.max(1, Math.ceil(visibleInstalled.value.length / INSTALLED_PAGE)));
const pagedInstalled = computed(() => {
  const start = (installedPage.value - 1) * INSTALLED_PAGE;
  return visibleInstalled.value.slice(start, start + INSTALLED_PAGE);
});
const pageFrom = computed(() => (visibleInstalled.value.length === 0 ? 0 : (installedPage.value - 1) * INSTALLED_PAGE + 1));
const pageTo = computed(() => (installedPage.value - 1) * INSTALLED_PAGE + pagedInstalled.value.length);

const selection = useModSelection(() => pagedInstalled.value.map((m) => m.slug));

watch(inst.updateCount, (n) => {
  if (n === 0 && statusFilter.value === "updates") statusFilter.value = "all";
});
watch([installedQuery, statusFilter, installedSort], () => {
  installedPage.value = 1;
});
watch(installedPages, (pages) => {
  if (installedPage.value > pages) installedPage.value = pages;
});
watch(inst.mods, (list) => selection.keepOnly(list.map((m) => m.slug)));

const loadErrorDetail = computed(() => {
  const err = inst.loadError.value;
  if (!err) return "";
  const outcome = err.status !== null ? String(err.status) : err.message || "no response";
  return `GET /api/servers/${props.server}/mods/installed -> ${outcome}`;
});

function statusOf(m: InstalledMod): { state: StatusInput; label: string; busy?: boolean } {
  if (inst.isBusy(m.slug)) return { state: StatusRole.Info, label: inst.busyLabel(m.slug), busy: true };
  if (inst.changedSinceLoad.has(m.slug)) return { state: StatusRole.Pending, label: t("mods.installed.statusChanged") };
  if (m.enabled === false) return { state: StatusRole.Unknown, label: t("mods.installed.statusDisabled") };
  if (inst.hasUpdate(m.slug)) return { state: StatusRole.Info, label: t("mods.installed.statusUpdate") };
  return { state: StatusRole.Applied, label: t("mods.installed.statusUpToDate") };
}

function report(action: RowAction, name: string, outcome: RowOutcome): void {
  if (!outcome.ok) {
    if (outcome.error || outcome.changed === 0) {
      notify.fail(t(FAILED[action]), `${name}: ${outcome.error || t("mods.toast.noDetail")}`);
    }
    return;
  }
  const restart = t("mods.toast.restartNote", { server: props.server });
  if (action === "update") {
    if (outcome.changed > 0) notify.ok(t("mods.toast.updated", { name }), restart);
    else notify.ok(t("mods.toast.upToDate", { name }));
  } else if (action === "remove") notify.ok(t("mods.toast.removed", { name }), restart);
  else if (action === "disable") notify.ok(t("mods.toast.disabled", { name }), restart);
  else notify.ok(t("mods.toast.enabled", { name }), restart);
}

async function act(m: InstalledMod, action: RowAction): Promise<void> {
  if (inst.isLocked(m.slug)) return;
  const name = nameOf(m);
  const outcome = await inst.runRow(m.slug, action, t(BUSY_LABEL[action]));
  report(action, name, outcome);
  if (outcome.ok && (action === "remove" || action === "update")) emit("catalog-refresh");
}

async function confirmRemove(m: InstalledMod): Promise<void> {
  const name = nameOf(m);
  const server = props.server;
  const players = props.playersOnline;
  const result = await confirmAction({
    level: "disruptive",
    levelLabel: t("mods.remove.level"),
    tone: "danger",
    header: t("mods.remove.header", { name, server }),
    message: t("mods.remove.message"),
    acceptLabel: t("mods.remove.accept", { name }),
    cancelLabel: t("mods.remove.cancel", { name }),
    media: { name, slug: m.slug, src: m.iconUrl ?? "" },
    facts: [
      ...(m.filename ? [{ term: t("mods.remove.factFile"), detail: m.filename, mono: true }] : []),
      {
        term: t("mods.remove.factEffect"),
        detail: players > 0 ? t("mods.remove.effectPlayers", { name, count: players }) : t("mods.remove.effect", { name }),
      },
      { term: t("mods.remove.factRecover"), detail: t("mods.remove.recover", { name }) },
    ],
  });
  if (result !== "confirm" || props.server !== server) return;
  await act(m, "remove");
}

async function applyAll(): Promise<void> {
  const outcome = await inst.applyAll();
  if (!outcome.ok) {
    notify.fail(t("mods.toast.updateFailed"), outcome.error || t("mods.toast.noDetail"));
    return;
  }
  if (outcome.changed > 0) {
    notify.ok(t("mods.toast.updatedAll", { count: outcome.changed }), t("mods.toast.restartNote", { server: props.server }));
  } else {
    notify.ok(t("mods.toast.allUpToDate"));
  }
}

async function bulkDisable(): Promise<void> {
  if (bulkRunning.value) return;
  bulkRunning.value = true;
  try {
    for (const m of inst.mods.value.filter((x) => selection.selected.has(x.slug) && x.enabled !== false)) {
      const outcome = await inst.runRow(m.slug, "disable", t(BUSY_LABEL.disable));
      report("disable", nameOf(m), outcome);
      if (outcome.ok) selection.remove(m.slug);
    }
  } finally {
    bulkRunning.value = false;
  }
}

async function bulkRemove(): Promise<void> {
  if (bulkRunning.value) return;
  const targets = inst.mods.value.filter((m) => selection.selected.has(m.slug));
  if (targets.length === 0) return;
  const server = props.server;
  const count = targets.length;
  const result = await confirmAction({
    level: "disruptive",
    levelLabel: t("mods.remove.level"),
    tone: "danger",
    header: t("mods.bulk.removeHeader", { count, server }),
    message: t("mods.bulk.removeMessage", { count }),
    acceptLabel: t("mods.bulk.removeAccept", { count }),
    cancelLabel: t("mods.bulk.removeCancel"),
    facts: [
      { term: t("mods.remove.factFile"), detail: targets.map((m) => nameOf(m)).join(", ") },
      { term: t("mods.remove.factRecover"), detail: t("mods.bulk.removeRecover") },
    ],
  });
  if (result !== "confirm" || props.server !== server) return;
  bulkRunning.value = true;
  try {
    for (const m of targets) {
      const outcome = await inst.runRow(m.slug, "remove", t(BUSY_LABEL.remove));
      report("remove", nameOf(m), outcome);
      if (outcome.ok) selection.remove(m.slug);
    }
    emit("catalog-refresh");
  } finally {
    bulkRunning.value = false;
  }
}

/** After the installed list loaded: version choices and the check the URL asks for. */
function afterInstalledLoad(): Promise<void> {
  return compatCheck.value?.afterInstalledLoad() ?? Promise.resolve();
}

/** A server switch: forget the old server's check, filters and selection. */
function reset(): void {
  compatCheck.value?.reset();
  installedQuery.value = "";
  statusFilter.value = "all";
  selection.clear();
}

defineExpose({ afterInstalledLoad, reset });
</script>

<style scoped src="./shared.css"></style>
<style scoped>
.filter-select { min-width: 160px; }
.bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-control);
  background: var(--accent-tint);
}
.bulk-count { font-size: var(--text-sm); font-weight: 600; }

.notices { display: grid; gap: var(--space-3); margin-bottom: var(--space-3); }
.notices:empty { display: none; }
.notices :deep(.stale-banner) { margin-bottom: 0; }

.version { font-size: var(--text-xs); white-space: nowrap; }
.row-actions { flex-wrap: nowrap; justify-content: flex-end; }
.row-busy { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--st-info); font-size: var(--text-sm); }
</style>
