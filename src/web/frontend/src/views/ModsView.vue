<template>
  <div class="mods-view">
    <ViewHeader :title="t('mods.title')" :server="serverId" :server-state="serverRole">
      <template v-if="serverId" #subtitle>{{ lede }}</template>
      <template v-if="serverId && canRestart" #actions>
        <Button
          class="tap"
          icon="pi pi-refresh"
          :label="t('mods.restart')"
          severity="secondary"
          outlined
          :disabled="!serverStatus || serverActions.isRunning(serverId)"
          :loading="serverActions.isRunning(serverId)"
          @click="restartServer"
        />
      </template>
    </ViewHeader>

    <EmptyState v-if="!serverId" icon="pi pi-server">{{ t("mods.noServer") }}</EmptyState>

    <div v-else class="mods-layout" :class="{ 'has-pending': pendingCount > 0 }">
      <div class="mods-main">
        <section class="summary" :aria-label="t('mods.summary.label')">
          <div v-for="tile in tiles" :key="tile.key" class="stat">
            <span :class="['stat-icon', tile.tone]" aria-hidden="true"><i :class="tile.icon" /></span>
            <span class="stat-text">
              <strong class="stat-n">
                <template v-if="tile.value !== null">{{ tile.value }}</template>
                <template v-else><span aria-hidden="true">{{ t("mods.summary.noValue") }}</span> {{ tile.name }}</template>
              </strong>
              <span class="stat-l">{{ tile.label }}</span>
            </span>
          </div>
          <div v-if="canWrite" class="summary-add">
            <Button
              class="tap"
              icon="pi pi-plus"
              :label="t('mods.summary.add')"
              :aria-describedby="serverOnline ? undefined : 'mods-add-note'"
              @click="focusCatalog"
            />
            <span v-if="!serverOnline" id="mods-add-note" class="summary-add-note">{{ t("mods.summary.addNote") }}</span>
          </div>
        </section>

        <InstalledModsPanel
          ref="panel"
          :inst="inst"
          :server="serverId"
          :can-write="canWrite"
          :players-online="playersOnline"
          :check="check"
          :filter="filter"
          @reload="reload"
          @focus-catalog="focusCatalog"
          @catalog-refresh="refreshCatalog"
          @update-route="emit('update-route', $event)"
        />
      </div>

      <div class="mods-catalog">
        <ModCatalog
          ref="catalog"
          :server="serverId"
          :can-write="canWrite"
          :installed="inst.installed.value"
          :after-install="afterInstall"
        />
      </div>
    </div>

    <div v-if="serverId && pendingCount > 0" class="pending-bar" role="status">
      <span class="stat-icon pending" aria-hidden="true"><i class="pi pi-clock" /></span>
      <span class="pending-text">
        <strong>{{ t("mods.summary.pending", { count: pendingCount }) }}</strong>
        <span class="small dim">{{ t("mods.pendingBar.note", { server: serverId }) }}</span>
      </span>
      <span class="pending-warn"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ t("mods.pendingBar.required") }}</span>
      <Button
        v-if="canRestart"
        class="tap pending-restart"
        icon="pi pi-refresh"
        :label="t('mods.restart')"
        :disabled="!serverStatus || serverActions.isRunning(serverId)"
        :loading="serverActions.isRunning(serverId)"
        @click="restartServer"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import { SERVER_STATE_ROLE, StatusRole, type StatusInput } from "@mcbot/schema";
import { t } from "../i18n";
import { capitalise } from "../utils/modsFormat";
import { useMods } from "../composables/useMods";
import { useInstalledMods } from "../composables/useInstalledMods";
import { useCapabilities } from "../composables/useCapabilities";
import { useServerStatus } from "../composables/useServerStatus";
import { useServerActions } from "../composables/useServerActions";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InstalledModsPanel from "../components/mods/InstalledModsPanel.vue";
import ModCatalog from "../components/mods/ModCatalog.vue";

const props = withDefaults(
  defineProps<{
    activeServer: string;
    /** Minecraft version from the URL (`?check=`) to run the upgrade check for. */
    check?: string;
    /** Result filter from the URL (`?filter=blockers` or `?filter=ready`). */
    filter?: string;
  }>(),
  { check: "", filter: "" },
);
const emit = defineEmits<{
  "update-route": [patch: { query: Record<string, string | undefined> }];
}>();

const serverId = computed(() => props.activeServer);
const mods = useMods(() => props.activeServer);
const inst = useInstalledMods(mods);
const status = useServerStatus();
const { can } = useCapabilities();
const canWrite = computed(() => can("mods:write", props.activeServer));
const canRestart = computed(() => can("server:control", props.activeServer));
const serverActions = useServerActions(() => status.refresh());

const panel = ref<InstanceType<typeof InstalledModsPanel> | null>(null);
const catalog = ref<InstanceType<typeof ModCatalog> | null>(null);

/** Mods changed since this page loaded; the running server only picks them up on a restart. */
const pendingCount = computed(() => inst.changedSinceLoad.size);

const serverStatus = computed(() => status.servers.value.find((s) => s.id === props.activeServer) ?? null);
const serverRole = computed<StatusInput>(() => {
  const state = serverStatus.value?.state;
  return state ? SERVER_STATE_ROLE[state] : StatusRole.Unknown;
});
const playersOnline = computed(() => serverStatus.value?.players?.online ?? 0);

async function restartServer(): Promise<void> {
  const server = serverStatus.value;
  if (!server) return;
  const restarted = await serverActions.runAction(server, "restart");
  if (restarted && props.activeServer === server.id) inst.changedSinceLoad.clear();
}

const lede = computed(() => {
  const list = inst.installed.value;
  const server = props.activeServer;
  const base =
    list?.modLoader && list.gameVersion
      ? t("mods.lede", { loader: capitalise(list.modLoader), version: list.gameVersion, server })
      : t("mods.ledeUnknown", { server });
  return playersOnline.value > 0 ? `${base} ${t("mods.ledePlayers", { count: playersOnline.value })}` : base;
});

const serverOnline = computed(() => serverRole.value === StatusRole.Online);
const serverOffline = computed(() => serverRole.value === StatusRole.Offline);
const listKnown = computed(() => inst.installed.value !== null);
const listFailed = computed(() => !listKnown.value && inst.loadError.value !== null);

const unknownLabel = computed(() => {
  if (serverOffline.value) return t("mods.summary.unknownOffline");
  if (listFailed.value) return t("mods.summary.unknownListFailed");
  return t("mods.summary.unknown");
});
const unknownTile = computed(() =>
  listFailed.value && !serverOffline.value
    ? { tone: "error", icon: "pi pi-exclamation-circle" }
    : { tone: "unknown", icon: "pi pi-minus" },
);

const compatibleWith = computed(() => {
  const list = inst.installed.value;
  if (!list?.gameVersion) return t("mods.summary.versionUnknown");
  return list.modLoader
    ? t("mods.summary.withLoader", { version: list.gameVersion, loader: capitalise(list.modLoader) })
    : t("mods.summary.with", { version: list.gameVersion });
});

interface SummaryTile {
  key: string;
  tone: string;
  icon: string;
  /** Shown beside the dash so unanswered tiles stay tellable apart. */
  name: string;
  /** `null` renders the neutral dash: the page cannot say. */
  value: string | number | null;
  label: string;
}

/** Each tile is known, unknown or failed; an answer the page cannot back up is never drawn as OK. */
const tiles = computed<SummaryTile[]>(() => {
  const unknown = unknownTile.value;
  const list = inst.installed.value;
  const installed: SummaryTile = listKnown.value
    ? { key: "installed", name: t("mods.summary.nameInstalled"), tone: "", icon: "pi pi-box", value: inst.mods.value.length, label: t("mods.summary.installed", { count: inst.mods.value.length }) }
    : { key: "installed", name: t("mods.summary.nameInstalled"), ...unknown, value: null, label: unknownLabel.value };
  const compatible: SummaryTile = list?.gameVersion
    ? { key: "compatible", name: t("mods.summary.compatible"), tone: "ok", icon: "pi pi-check-circle", value: t("mods.summary.compatible"), label: compatibleWith.value }
    : { key: "compatible", name: t("mods.summary.compatible"), ...unknown, value: null, label: listKnown.value ? t("mods.summary.versionUnknown") : unknownLabel.value };
  let pending: SummaryTile;
  if (pendingCount.value > 0) {
    pending = { key: "pending", name: t("mods.summary.namePending"), tone: "pending", icon: "pi pi-clock", value: t("mods.summary.pending", { count: pendingCount.value }), label: t("mods.summary.needsRestart") };
  } else if (serverOnline.value && listKnown.value) {
    pending = { key: "pending", name: t("mods.summary.namePending"), tone: "ok", icon: "pi pi-check", value: t("mods.summary.pending", { count: 0 }), label: t("mods.summary.nothingPending") };
  } else {
    pending = { key: "pending", name: t("mods.summary.namePending"), ...unknown, value: null, label: unknownLabel.value };
  }
  return [installed, compatible, pending];
});

function focusCatalog(): void {
  void catalog.value?.focus();
}

function refreshCatalog(): void {
  void catalog.value?.search();
}

/** A mod was installed from the catalogue: mark it pending and reload the installed list. */
async function afterInstall(slug: string | undefined): Promise<void> {
  if (slug) inst.changedSinceLoad.add(slug);
  await Promise.all([inst.load(), inst.refreshUpdates(true)]);
}

async function reload(): Promise<void> {
  if (!props.activeServer) return;
  void status.refresh();
  await inst.load();
  await Promise.all([inst.refreshUpdates(false), catalog.value?.search()]);
  await panel.value?.afterInstalledLoad();
}

onMounted(reload);
watch(
  () => props.activeServer,
  () => {
    inst.reset();
    panel.value?.reset();
    catalog.value?.reset();
    return reload();
  },
);
</script>

<style scoped src="../components/mods/shared.css"></style>
<style scoped>
.mods-view { container-type: inline-size; min-width: 0; }

.mods-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.mods-main, .mods-catalog { display: grid; gap: var(--space-4); min-width: 0; align-content: start; }
@container (min-width: 1100px) {
  .mods-layout { grid-template-columns: minmax(0, 1fr) minmax(380px, 460px); }
  /* The search results run far longer than the installed list; they scroll inside the column instead of stretching the page. */
  .mods-catalog {
    position: sticky;
    top: var(--space-3);
    max-height: calc(100dvh - 11rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.stat { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.stat-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-surface);
  background: var(--surface-raised);
  color: var(--accent);
  font-size: var(--text-lg);
}
.stat-icon.ok { background: var(--accent-tint); color: var(--st-online); }
.stat-icon.pending { background: var(--st-degraded-bg); color: var(--st-degraded); }
.stat-icon.unknown { background: var(--st-unknown-bg); color: var(--st-unknown); }
.stat-icon.error { background: var(--st-offline-bg); color: var(--st-offline); }
.stat-text { display: grid; min-width: 0; line-height: var(--leading-tight); }
.stat-n { font-size: var(--text-lg); font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-l { color: var(--text-dim); font-size: var(--text-sm); }
.summary-add { display: grid; justify-items: end; gap: var(--space-1); margin-inline-start: auto; }
.summary-add-note { color: var(--text-dim); font-size: var(--text-sm); }
@container (max-width: 760px) {
  .summary-add { margin-inline-start: 0; width: 100%; justify-items: stretch; }
}

.has-pending { padding-bottom: var(--space-2); }
.pending-bar {
  position: sticky;
  bottom: var(--space-3);
  z-index: var(--z-sticky);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--accent);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
  box-shadow: var(--shadow-overlay);
}
.pending-text { display: grid; flex: 1 1 240px; min-width: 0; }
.pending-warn { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--st-degraded); font-size: var(--text-sm); }
.pending-restart { margin-inline-start: auto; }
@container (min-width: 1900px) {
  .mods-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 900px); }
}
</style>
