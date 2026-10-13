<template>
  <div class="prune-view">
    <ViewHeader :title="t('prune.title')" :server="activeServer" :subtitle="t('prune.lede', { server: activeServer })" />

    <InlineBanner v-if="error" tone="danger" :title="t('upgrade.errorTitle')">{{ error }}</InlineBanner>

    <p v-if="prune.supported.value === null" class="pv-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("upgrade.loading") }}
    </p>

    <EmptyState
      v-else-if="prune.supported.value === false"
      icon="pi pi-eraser"
      :title="t('prune.unsupportedTitle')"
      :heading-level="2"
    >
      {{ t("prune.unsupportedText") }}
    </EmptyState>

    <UpgradeRun v-else-if="run.job.value" :upgrade="run" :server="activeServer" @again="clearRun" />

    <template v-else>
      <section class="pv-card" aria-labelledby="pv-params">
        <h2 id="pv-params">{{ t("prune.params.heading") }}</h2>
        <div class="pv-grid">
          <div class="pv-field">
            <label class="pv-label" for="pv-threshold">{{ t("prune.params.threshold") }}</label>
            <InputNumber v-model="prune.params.value.thresholdMinutes" input-id="pv-threshold" :min="0" :max="100000" :max-fraction-digits="1" />
            <span class="pv-help">{{ t("prune.params.thresholdHelp") }}</span>
          </div>
          <div class="pv-field">
            <label class="pv-label" for="pv-spawn">{{ t("prune.params.spawn") }}</label>
            <InputNumber v-model="prune.params.value.spawnRadiusChunks" input-id="pv-spawn" :min="0" :max="512" show-buttons />
            <span class="pv-help">{{ t("prune.params.spawnHelp") }}</span>
          </div>
          <div class="pv-field">
            <label class="pv-label" for="pv-player">{{ t("prune.params.player") }}</label>
            <InputNumber v-model="prune.params.value.playerRadiusChunks" input-id="pv-player" :min="0" :max="512" show-buttons />
            <span class="pv-help">{{ t("prune.params.playerHelp") }}</span>
          </div>
          <div class="pv-field">
            <label class="pv-label" for="pv-buffer">{{ t("prune.params.buffer") }}</label>
            <InputNumber v-model="prune.params.value.bufferChunks" input-id="pv-buffer" :min="0" :max="32" show-buttons />
            <span class="pv-help">{{ t("prune.params.bufferHelp") }}</span>
          </div>
        </div>

        <h3>{{ t("prune.zones.heading") }}</h3>
        <p class="pv-note">{{ t("prune.zones.help") }}</p>
        <ul v-if="prune.params.value.zones.length" class="pv-zones">
          <li v-for="(zone, i) in prune.params.value.zones" :key="i">
            <span class="pv-zone-name">{{ zone.name || t("prune.zones.unnamed") }}</span>
            <span class="pv-zone-where">{{ zone.dimension }}: {{ zone.x1 }}, {{ zone.z1 }} to {{ zone.x2 }}, {{ zone.z2 }}</span>
            <Button
              class="tap"
              icon="pi pi-trash"
              severity="secondary"
              text
              :aria-label="t('prune.zones.remove', { name: zone.name || String(i + 1) })"
              @click="prune.removeZone(i)"
            />
          </li>
        </ul>
        <div class="pv-add">
          <InputText v-model="zoneName" :placeholder="t('prune.zones.name')" :aria-label="t('prune.zones.name')" maxlength="64" />
          <InputText v-model="zoneDimension" :aria-label="t('prune.zones.dimension')" class="pv-dim" />
          <InputNumber v-model="zone.x1" :aria-label="'x1'" placeholder="x1" class="pv-coord" />
          <InputNumber v-model="zone.z1" :aria-label="'z1'" placeholder="z1" class="pv-coord" />
          <InputNumber v-model="zone.x2" :aria-label="'x2'" placeholder="x2" class="pv-coord" />
          <InputNumber v-model="zone.z2" :aria-label="'z2'" placeholder="z2" class="pv-coord" />
          <Button class="tap" icon="pi pi-plus" :label="t('prune.zones.add')" severity="secondary" outlined :disabled="!zoneValid" @click="addZone" />
        </div>

        <div class="pv-actions">
          <Button
            class="tap"
            icon="pi pi-search"
            :label="prune.summary.value ? t('prune.scan.again') : t('prune.scan.button')"
            :loading="prune.scanning.value"
            @click="prune.scan"
          />
          <Button
            class="tap"
            icon="pi pi-save"
            :label="t('prune.params.save')"
            severity="secondary"
            outlined
            :disabled="!prune.dirty.value"
            :loading="prune.savingSettings.value"
            @click="saveSettings"
          />
        </div>
        <p v-if="prune.scanning.value" class="pv-note" role="status">{{ t("prune.scan.running") }}</p>
        <p class="pv-note">{{ t("prune.scan.approximate") }}</p>
      </section>

      <template v-if="prune.summary.value">
        <section class="pv-card" aria-labelledby="pv-result">
          <h2 id="pv-result">{{ t("prune.result.heading") }}</h2>
          <InlineBanner v-if="!prune.summaryCurrent.value" tone="warn" :title="t('prune.result.staleTitle')">
            {{ t("prune.result.staleText") }}
          </InlineBanner>
          <InlineBanner v-for="w in prune.summary.value.warnings" :key="w" tone="info" :title="t('prune.warning.title')">
            {{ warningText(w) }}
          </InlineBanner>
          <p class="pv-total">
            {{ t("prune.result.total", {
              delete: prune.summary.value.totals.delete.toLocaleString(),
              chunks: prune.summary.value.totals.chunks.toLocaleString(),
              size: formatBytes(prune.summary.value.totals.bytes),
            }) }}
          </p>
          <p class="pv-note">{{ t("prune.result.regions", { count: prune.summary.value.totals.regionsEmptied }) }}</p>
          <table class="pv-table">
            <thead>
              <tr>
                <th scope="col">{{ t("prune.table.dimension") }}</th>
                <th scope="col">{{ t("prune.table.delete") }}</th>
                <th scope="col">{{ t("prune.table.active") }}</th>
                <th scope="col">{{ t("prune.table.protected") }}</th>
                <th scope="col">{{ t("prune.table.buffer") }}</th>
                <th scope="col">{{ t("prune.table.unreadable") }}</th>
                <th scope="col">{{ t("prune.table.size") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in prune.summary.value.dimensions" :key="d.id">
                <th scope="row">{{ d.id }}</th>
                <td>{{ d.delete.toLocaleString() }}</td>
                <td>{{ d.active.toLocaleString() }}</td>
                <td>{{ d.protected.toLocaleString() }}</td>
                <td>{{ d.buffer.toLocaleString() }}</td>
                <td>{{ d.unreadable.toLocaleString() }}</td>
                <td>{{ formatBytes(d.bytes) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="prune.summary.value.dimensions.length" class="pv-card" aria-labelledby="pv-map">
          <h2 id="pv-map">{{ t("prune.map.heading") }}</h2>
          <div class="pv-controls">
            <SelectButton v-model="dimensionIndex" :options="dimensionOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="t('prune.table.dimension')" />
            <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="t('prune.map.view')" />
            <Select v-model="scale" :options="scaleOptions" option-label="label" option-value="value" :aria-label="t('prune.map.zoom')" />
            <label class="pv-check"><Checkbox v-model="showGrid" binary input-id="pv-grid" /> {{ t("prune.map.grid") }}</label>
            <label class="pv-check"><Checkbox v-model="drawing" binary input-id="pv-draw" /> {{ t("prune.map.draw") }}</label>
          </div>
          <p v-if="prune.loadingMap.value" class="pv-note" role="status">
            <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("prune.map.loading") }}
          </p>
          <PruneMap
            v-if="currentMap"
            :map="currentMap"
            :zones="prune.params.value.zones"
            :view="view"
            :scale="scale"
            :show-grid="showGrid"
            :drawing="drawing"
            :label="t('prune.map.label', { dimension: currentDimension })"
            @zone="onDrawn"
          />
          <ul class="pv-legend">
            <li v-for="item in legend" :key="item.cell"><span class="pv-swatch" :class="`is-${item.role}`" aria-hidden="true" /> {{ t(item.label) }}</li>
          </ul>
        </section>

        <section class="pv-card" aria-labelledby="pv-apply">
          <h2 id="pv-apply">{{ t("prune.apply.heading") }}</h2>
          <p class="pv-note">{{ t("prune.apply.text") }}</p>
          <div class="pv-field">
            <label class="pv-label" for="pv-countdown">{{ t("upgrade.options.countdown") }}</label>
            <Select v-model="countdown" input-id="pv-countdown" :options="countdownOptions" option-label="label" option-value="value" />
          </div>
          <Button
            class="tap"
            icon="pi pi-trash"
            severity="danger"
            :label="t('prune.apply.button', { count: prune.summary.value.totals.delete.toLocaleString() })"
            :disabled="!prune.summaryCurrent.value || !prune.hasDeletions.value || prune.starting.value"
            :loading="prune.starting.value"
            @click="confirmApply"
          />
          <p v-if="!prune.hasDeletions.value" class="pv-note">{{ t("prune.apply.nothing") }}</p>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { formatBytes } from "@mcbot/schema";
import { apiGet, apiSend } from "../api";
import { CELL, usePrune } from "../composables/usePrune";
import { useServerUpgrade } from "../composables/useServerUpgrade";
import { useConfirmAction } from "../composables/useConfirmAction";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import PruneMap from "../components/PruneMap.vue";
import UpgradeRun from "../components/UpgradeRun.vue";
import { t, type MessageKey } from "../i18n";
import type {
  PruneMap as PruneMapBody,
  PruneParams,
  PruneParamsRequest,
  PruneScanJob,
  UpgradeJob,
  UpgradeStarted,
} from "@mcbot/schema/wire/index.js";

const props = defineProps<{ activeServer: string }>();

const confirmAction = useConfirmAction();
const error = ref("");
const server = computed(() => props.activeServer);
const base = (): string => `/api/servers/${encodeURIComponent(server.value)}`;

const prune = usePrune({
  api: {
    support: () => apiGet<{ supported: boolean }>(`${base()}/prune/support`),
    settings: () => apiGet<PruneParams>(`${base()}/prune/settings`),
    save: (p: PruneParamsRequest) => apiSend<PruneParams>("PUT", `${base()}/prune/settings`, p),
    scan: (p: PruneParamsRequest) => apiSend<{ jobId: string }>("POST", `${base()}/prune/scans`, p),
    poll: (jobId) => apiGet<PruneScanJob>(`${base()}/prune/scans/${jobId}`),
    map: (planId, index) => apiGet<PruneMapBody>(`${base()}/prune/plans/${planId}/map/${index}`),
    apply: (planId, countdownSeconds) =>
      apiSend<UpgradeStarted>("POST", `${base()}/prune`, { planId, countdownSeconds }),
  },
  onError: (message) => (error.value = message),
});

/** The delete is an upgrade-style job: followed through the same routes. */
const run = useServerUpgrade({
  api: {
    support: () => apiGet<{ supported: boolean }>(`${base()}/upgrade/support`),
    start: () => Promise.reject(new Error("The prune is started from this page.")),
    poll: (jobId, since) => apiGet<UpgradeJob>(`${base()}/upgrade/${jobId}?since=${since}`),
    current: async (since) => {
      try {
        return await apiGet<UpgradeJob>(`${base()}/upgrade/current?since=${since}`);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
  },
  onError: (message) => (error.value = message),
});

// ── Zones ─────────────────────────────────────────────────────────────────

const zoneName = ref("");
const zoneDimension = ref("overworld");
const zone = reactive<{ x1: number | null; z1: number | null; x2: number | null; z2: number | null }>({
  x1: null, z1: null, x2: null, z2: null,
});
const zoneValid = computed(
  () => /^[a-z0-9_.:-]{1,64}$/.test(zoneDimension.value) && [zone.x1, zone.z1, zone.x2, zone.z2].every((n) => typeof n === "number"),
);

function addZone(): void {
  if (!zoneValid.value) return;
  prune.addZone({
    name: zoneName.value.trim(),
    dimension: zoneDimension.value,
    x1: zone.x1 as number,
    z1: zone.z1 as number,
    x2: zone.x2 as number,
    z2: zone.z2 as number,
  });
  zoneName.value = "";
  zone.x1 = zone.z1 = zone.x2 = zone.z2 = null;
}

function onDrawn(rect: { x1: number; z1: number; x2: number; z2: number }): void {
  prune.addZone({ name: t("prune.zones.drawn", { n: prune.params.value.zones.length + 1 }), dimension: currentDimension.value, ...rect });
  drawing.value = false;
}

// ── Map ───────────────────────────────────────────────────────────────────

const dimensionIndex = ref(0);
const view = ref<"class" | "heat">("class");
const scale = ref(4);
const showGrid = ref(true);
const drawing = ref(false);

const dimensionOptions = computed(() =>
  (prune.summary.value?.dimensions ?? []).map((d, i) => ({ label: d.id, value: i })),
);
const viewOptions = computed(() => [
  { label: t("prune.map.viewClass"), value: "class" as const },
  { label: t("prune.map.viewHeat"), value: "heat" as const },
]);
const scaleOptions = computed(() => [1, 2, 4, 8].map((n) => ({ label: t("prune.map.scale", { n }), value: n })));
const currentDimension = computed(() => prune.summary.value?.dimensions[dimensionIndex.value]?.id ?? "overworld");
const currentMap = computed(() => prune.maps.value[dimensionIndex.value] ?? null);

const legend = [
  { cell: CELL.DELETE, role: "offline", label: "prune.cell.delete" as MessageKey },
  { cell: CELL.ACTIVE, role: "online", label: "prune.cell.active" as MessageKey },
  { cell: CELL.PROTECTED, role: "info", label: "prune.cell.protected" as MessageKey },
  { cell: CELL.BUFFER, role: "pending", label: "prune.cell.buffer" as MessageKey },
  { cell: CELL.UNREADABLE, role: "degraded", label: "prune.cell.unreadable" as MessageKey },
];

watch(
  [() => prune.summary.value?.id, dimensionIndex],
  () => {
    if (prune.summary.value) void prune.loadMap(dimensionIndex.value);
  },
);

// ── Actions ───────────────────────────────────────────────────────────────

const countdown = ref(30);
const countdownOptions = computed(() => [
  { label: t("upgrade.options.noWarning"), value: 0 },
  { label: t("upgrade.options.seconds", { count: 30 }), value: 30 },
  { label: t("upgrade.options.minute"), value: 60 },
  { label: t("upgrade.options.minutes", { count: 2 }), value: 120 },
]);

function warningText(code: string): string {
  return code === "spawn_unknown" ? t("prune.warning.spawnUnknown") : code;
}

async function saveSettings(): Promise<void> {
  error.value = "";
  await prune.saveSettings();
}

async function confirmApply(): Promise<void> {
  const summary = prune.summary.value;
  if (!summary) return;
  error.value = "";
  const name = server.value;
  const answer = await confirmAction({
    level: "irreversible",
    tone: "danger",
    header: t("prune.confirm.header", { server: name }),
    message: t("prune.confirm.message", {
      server: name,
      count: summary.totals.delete.toLocaleString(),
      size: formatBytes(summary.totals.bytes),
    }),
    acceptLabel: t("prune.confirm.accept", { server: name }),
    expected: name,
    facts: [
      { term: t("upgrade.fact.steps"), detail: t("prune.fact.stepsDetail") },
      { term: t("prune.fact.what"), detail: t("prune.fact.whatDetail") },
      { term: t("upgrade.fact.fallback"), detail: t("prune.fact.fallbackDetail") },
      { term: t("upgrade.fact.recover"), detail: t("prune.fact.recoverDetail") },
    ],
  });
  if (answer !== "confirm") return;
  const jobId = await prune.apply(countdown.value);
  if (jobId) await run.attach();
}

function clearRun(): void {
  run.reset();
  void load();
}

async function load(): Promise<void> {
  await prune.loadSupport();
  if (!prune.supported.value) return;
  await Promise.all([prune.loadSettings(), run.attach()]);
}

watch(server, () => {
  prune.reset();
  run.reset();
  error.value = "";
  if (server.value) void load();
}, { immediate: true });

onBeforeUnmount(() => {
  prune.dispose();
  run.dispose();
});
</script>

<style scoped>
.prune-view {
  display: grid;
  gap: var(--space-4);
}
.pv-card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-3, 8px);
}
.pv-card h2,
.pv-card h3 {
  margin: 0;
}
.pv-card h2 {
  font-size: var(--text-xl);
}
.pv-card h3 {
  font-size: var(--text-lg);
  margin-top: var(--space-2);
}
.pv-note,
.pv-help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.pv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-4);
}
.pv-field {
  display: grid;
  gap: var(--space-2);
  align-content: start;
}
.pv-label {
  font-weight: 600;
}
.pv-zones {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.pv-zones li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.pv-zone-name {
  font-weight: 600;
}
.pv-zone-where {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.pv-add,
.pv-actions,
.pv-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.pv-dim {
  width: 9rem;
}
.pv-coord {
  width: 6rem;
}
.pv-coord :deep(input) {
  width: 100%;
  min-width: 0;
}
.pv-total {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
}
.pv-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.pv-table th,
.pv-table td {
  padding: var(--space-2) var(--space-3);
  text-align: right;
  border-bottom: 1px solid var(--border);
}
.pv-table th[scope="col"]:first-child,
.pv-table th[scope="row"] {
  text-align: left;
}
.pv-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.pv-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.pv-swatch {
  display: inline-block;
  width: 0.9em;
  height: 0.9em;
  border-radius: 2px;
  vertical-align: -0.1em;
}
.pv-swatch.is-offline { background: var(--st-offline); }
.pv-swatch.is-online { background: var(--st-online); }
.pv-swatch.is-info { background: var(--st-info); }
.pv-swatch.is-pending { background: var(--st-pending); }
.pv-swatch.is-degraded { background: var(--st-degraded); }
</style>
