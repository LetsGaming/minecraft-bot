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
      <InlineBanner v-if="prune.unfinishedApply.value" tone="danger" :title="t('prune.unfinished.title')">
        {{ t("prune.unfinished.text", { when: prune.unfinishedApply.value.startedAt }) }}
      </InlineBanner>

      <div v-if="prune.scanning.value" class="pv-progress" role="status">
        <p class="pv-note">{{ t("prune.scan.running") }}</p>
        <template v-if="prune.progress.value && prune.progress.value.total > 0">
          <progress :max="prune.progress.value.total" :value="prune.progress.value.done" :aria-label="t('prune.scan.running')" />
          <p class="pv-note">
            {{ t("prune.scan.progress", {
              done: prune.progress.value.done.toLocaleString(),
              total: prune.progress.value.total.toLocaleString(),
              chunks: prune.progress.value.chunks.toLocaleString(),
              rate: prune.progress.value.chunksPerSecond.toLocaleString(),
            }) }}
            <template v-if="prune.progress.value.etaSeconds !== null">
              {{ t("prune.scan.eta", { seconds: prune.progress.value.etaSeconds }) }}
            </template>
          </p>
        </template>
        <Button
          class="tap"
          icon="pi pi-stop"
          :label="prune.cancelling.value ? t('prune.scan.cancelling') : t('prune.scan.cancel')"
          severity="secondary"
          outlined
          :disabled="prune.cancelling.value"
          @click="prune.cancelScan"
        />
      </div>

      <template v-if="prune.summary.value">
        <section class="pv-card pv-summary" aria-labelledby="pv-result">
          <div class="pv-summary-head">
            <h2 id="pv-result">{{ t("prune.result.heading") }}</h2>
            <Button
              class="tap"
              icon="pi pi-search"
              :label="t('prune.scan.again')"
              severity="secondary"
              outlined
              :loading="prune.scanning.value"
              @click="prune.scan"
            />
          </div>
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
          <p v-if="breakdown.soft + breakdown.hard > 0" class="pv-note">
            {{ t("prune.apply.breakdown", { auto: breakdown.auto.toLocaleString(), soft: breakdown.soft.toLocaleString(), hard: breakdown.hard.toLocaleString() }) }}
          </p>
          <p v-if="breakdown.blocked > 0" class="pv-note">{{ t("prune.apply.blocked", { count: breakdown.blocked.toLocaleString() }) }}</p>
        </section>

        <section v-if="prune.summary.value.dimensions.length" class="pv-workspace" aria-labelledby="pv-map">
          <h2 id="pv-map" class="sr-only">{{ t("prune.map.heading") }}</h2>
          <div class="pv-stage">
            <div class="pv-controls">
              <SelectButton v-model="dimensionIndex" :options="dimensionOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="t('prune.table.dimension')" />
              <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="t('prune.map.view')" />
              <SelectButton v-model="tool" :options="toolOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="t('prune.tool.label')" />
              <span class="pv-zoom">
                <Button class="tap" icon="pi pi-search-minus" severity="secondary" text :aria-label="t('prune.map.zoomOut')" @click="mapRef?.zoomOut()" />
                <Button class="tap" icon="pi pi-search-plus" severity="secondary" text :aria-label="t('prune.map.zoomIn')" @click="mapRef?.zoomIn()" />
                <Button class="tap" icon="pi pi-expand" severity="secondary" text :aria-label="t('prune.map.fit')" @click="mapRef?.fit()" />
                <span class="pv-note">{{ t("prune.map.zoomLevel", { zoom: zoomLabel }) }}</span>
              </span>
              <label class="pv-check"><Checkbox v-model="showGrid" binary input-id="pv-grid" /> {{ t("prune.map.grid") }}</label>
              <span v-if="view === 'terrain'" class="pv-opacity">
                <span id="pv-overlay-label">{{ t("prune.map.overlay") }}</span>
                <Slider v-model="overlayPercent" :min="0" :max="100" :step="5" class="pv-opacity-slider" aria-labelledby="pv-overlay-label" />
                <span class="pv-note">{{ t("prune.map.overlayValue", { percent: overlayPercent }) }}</span>
              </span>
              <span v-if="view === 'terrain' && zoom < 2.5" class="pv-note" role="status">{{ t("prune.map.terrainHint") }}</span>
              <span v-if="prune.loadingMap.value" class="pv-note" role="status">
                <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("prune.map.loading") }}
              </span>
            </div>
            <PruneMap
              v-if="currentMap"
              ref="mapRef"
              :map="currentMap"
              :zones="prune.params.value.zones"
              :view="view"
              :show-grid="showGrid"
              :overlay-opacity="overlayPercent / 100"
              :tool="tool"
              :selection="selection"
              :selection-version="selectionVersion"
              :inspected="inspectedAt"
              :tile-loader="tileLoader"
              height="var(--pv-map-height)"
              :label="t('prune.map.label', { dimension: currentDimension })"
              @inspect="onInspect"
              @zone="onDrawn"
              @select="onSelect"
              @camera="onCamera"
              @undo="undoSelection"
              @redo="redoSelection"
            />
          </div>
          <aside class="pv-side" :aria-label="t('prune.side.label')">
            <section v-if="prune.inspected.value" class="pv-inspector" aria-labelledby="pv-inspect-title">
              <div class="pv-inspector-head">
                <h3 id="pv-inspect-title">{{ t("prune.inspect.heading", { x: prune.inspected.value.cx, z: prune.inspected.value.cz }) }}</h3>
                <Button class="tap" icon="pi pi-times" severity="secondary" text :label="t('prune.inspect.close')" @click="prune.clearInspection" />
              </div>
              <p v-if="prune.inspected.value.loading" class="pv-note" role="status">{{ t("prune.inspect.loading") }}</p>
              <template v-else-if="prune.inspected.value.info">
                <p v-if="!prune.inspected.value.info.present" class="pv-note">{{ t("prune.inspect.empty") }}</p>
                <p v-else-if="prune.inspected.value.info.readable === false" class="pv-note">
                  {{ t("prune.inspect.unreadable", { reason: prune.inspected.value.info.unreadableReason ?? "?" }) }}
                </p>
                <ul v-else class="pv-facts">
                  <li>{{ t("prune.inspect.plan", { answer: prune.inspected.value.info.plannedForDeletion ? t("prune.inspect.yes") : t("prune.inspect.no") }) }}</li>
                  <li v-if="inspectedClass">{{ inspectedClass }}</li>
                  <li>
                    {{ prune.inspected.value.info.inhabitedMinutes == null
                      ? t("prune.inspect.unknownTime")
                      : t("prune.inspect.used", { minutes: prune.inspected.value.info.inhabitedMinutes.toLocaleString(), threshold: prune.inspected.value.info.thresholdMinutes }) }}
                  </li>
                  <li v-if="prune.inspected.value.info.status">
                    {{ t("prune.inspect.status", { status: prune.inspected.value.info.status, version: prune.inspected.value.info.dataVersion ?? "?" }) }}
                  </li>
                  <li v-if="prune.inspected.value.info.bytes">
                    {{ t("prune.inspect.size", {
                      region: formatBytes(prune.inspected.value.info.bytes.region),
                      entities: formatBytes(prune.inspected.value.info.bytes.entities),
                      poi: formatBytes(prune.inspected.value.info.bytes.poi),
                    }) }}
                  </li>
                  <li>
                    {{ (prune.inspected.value.info.blockEntities ?? []).length
                      ? t("prune.inspect.blockEntities", { list: (prune.inspected.value.info.blockEntities ?? []).map((b) => `${b.id.replace("minecraft:", "")} x${b.count}`).join(", ") })
                      : t("prune.inspect.noBlockEntities") }}
                  </li>
                  <li>
                    {{ structureNames.length ? t("prune.inspect.structures", { list: structureNames.join(", ") }) : t("prune.inspect.noStructures") }}
                  </li>
                  <li v-if="prune.inspected.value.info.unexplained">{{ t("prune.inspect.unexplained") }}</li>
                  <li v-if="(prune.inspected.value.info.protectedBy ?? []).length">
                    {{ t("prune.inspect.protectedBy", { list: (prune.inspected.value.info.protectedBy ?? []).map(protectionText).join(", ") }) }}
                  </li>
                </ul>
              </template>
            </section>
            <div class="pv-panel" role="group" :aria-label="t('prune.selection.heading')">
              <h3>{{ t("prune.selection.heading") }}</h3>
              <p class="pv-note">{{ t("prune.selection.help") }}</p>
              <p class="pv-total" role="status">
                {{ selectedCount > 0 ? t("prune.selection.count", { count: selectedCount.toLocaleString(), dimension: currentDimension }) : t("prune.selection.none", { dimension: currentDimension }) }}
              </p>
              <div class="pv-actions">
                <Button class="tap" icon="pi pi-undo" :label="t('prune.selection.undo')" severity="secondary" outlined :disabled="!canUndo" @click="undoSelection" />
                <Button class="tap" icon="pi pi-refresh" :label="t('prune.selection.redo')" severity="secondary" outlined :disabled="!canRedo" @click="redoSelection" />
                <Button class="tap" icon="pi pi-times" :label="t('prune.selection.clear')" severity="secondary" outlined :disabled="selectionOpCount === 0" @click="clearSelection" />
                <Button class="tap" icon="pi pi-search" :label="t('prune.selection.update')" :loading="prune.scanning.value" :disabled="prune.summaryCurrent.value" @click="prune.scan" />
              </div>
              <label class="pv-check">
                <Checkbox :model-value="allowProtected" binary input-id="pv-allow-protected" @update:model-value="toggleAllowProtected" />
                {{ t("prune.selection.allowProtected") }}
              </label>
              <p class="pv-note">{{ t("prune.selection.allowProtectedHelp") }}</p>
            </div>
            <section class="pv-panel" aria-labelledby="pv-apply">
              <h3 id="pv-apply">{{ t("prune.apply.heading") }}</h3>
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
            <div class="pv-panel">
              <ul class="pv-legend">
                <li v-for="item in legend" :key="item.cell"><span class="pv-swatch" :class="`is-${item.role}`" aria-hidden="true" /> {{ t(item.label) }}</li>
              </ul>
              <p class="pv-note">{{ t("prune.legend.manual") }}</p>
              <p class="pv-note">{{ t("prune.map.keys") }}</p>
            </div>
          </aside>
        </section>

        <details class="pv-card pv-fold">
          <summary>{{ t("prune.result.perDimension") }}</summary>
          <div class="pv-fold-body is-scroll">
            <table class="pv-table">
              <thead>
                <tr>
                  <th scope="col">{{ t("prune.table.dimension") }}</th>
                  <th scope="col">{{ t("prune.table.delete") }}</th>
                  <th scope="col">{{ t("prune.table.active") }}</th>
                  <th scope="col">{{ t("prune.table.protected") }}</th>
                  <th scope="col">{{ t("prune.table.buffer") }}</th>
                  <th scope="col">{{ t("prune.table.unreadable") }}</th>
                  <th scope="col">{{ t("prune.table.uncertain") }}</th>
                  <th scope="col">{{ t("prune.table.manual") }}</th>
                  <th scope="col">{{ t("prune.table.blocked") }}</th>
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
                  <td>{{ (d.uncertain ?? 0).toLocaleString() }}</td>
                  <td>{{ ((d.manualSoft ?? 0) + (d.manualHard ?? 0)).toLocaleString() }}</td>
                  <td>{{ (d.manualBlocked ?? 0).toLocaleString() }}</td>
                  <td>{{ formatBytes(d.bytes) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>

      <details class="pv-card pv-fold" :open="!prune.summary.value">
        <summary><h2 id="pv-params">{{ t("prune.params.heading") }}</h2></summary>
        <div class="pv-fold-body">
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
            <div class="pv-field">
              <label class="pv-check">
                <Checkbox :model-value="buildProtected" binary input-id="pv-build" @update:model-value="setBuildProtection" />
                {{ t("prune.params.build") }}
              </label>
              <span class="pv-help">{{ t("prune.params.buildHelp") }}</span>
            </div>
          </div>

          <fieldset v-if="prune.dimensions.value.length > 1" class="pv-dims">
            <legend>{{ t("prune.dimensions.heading") }}</legend>
            <p class="pv-note">{{ t("prune.dimensions.help") }}</p>
            <SelectButton
              :model-value="prune.selectedDimensions.value"
              :options="scanDimensionOptions"
              option-label="label"
              option-value="value"
              multiple
              :allow-empty="false"
              :disabled="prune.scanning.value"
              :aria-label="t('prune.dimensions.heading')"
              @update:model-value="prune.setDimensions"
            >
              <template #option="{ option }">
                <span class="pv-dim-label">
                  <i :class="prune.selectedDimensions.value.includes(option.value) ? 'pi pi-check' : 'pi pi-minus'" aria-hidden="true" />
                  {{ option.label }}
                </span>
              </template>
            </SelectButton>
          </fieldset>

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
          <p class="pv-note">{{ t("prune.scan.approximate") }}</p>
        </div>
      </details>
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
import Slider from "primevue/slider";
import { formatBytes } from "@mcbot/schema";
import { apiBlob } from "../api";
import { CELL, usePrune, usePruneApi } from "../composables/usePrune";
import { SelectionModel } from "../composables/pruneSelection";
import { useServerUpgrade, useUpgradeApi } from "../composables/useServerUpgrade";
import { useConfirmAction } from "../composables/useConfirmAction";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import PruneMap from "../components/PruneMap.vue";
import type { MapTool } from "../composables/usePruneMapInput";
import { regionKey, regionOf, slotOf } from "../composables/pruneRegion";
import { OVER_TERRAIN_OPACITY } from "../composables/pruneMapRender";
import UpgradeRun from "../components/UpgradeRun.vue";
import { t, type MessageKey } from "../i18n";

const props = defineProps<{ activeServer: string }>();

const confirmAction = useConfirmAction();
const error = ref("");
const server = computed(() => props.activeServer);
const base = (): string => `/api/servers/${encodeURIComponent(server.value)}`;

const prune = usePrune({
  api: usePruneApi(() => server.value),
  onError: (message) => (error.value = message),
});

/** The delete is an upgrade-style job: followed through the same routes. */
const run = useServerUpgrade({
  api: {
    ...useUpgradeApi(() => server.value),
    start: () => Promise.reject(new Error("The prune is started from this page.")),
  },
  onError: (message) => (error.value = message),
  kind: "prune",
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
  tool.value = "pan";
}

// ── Map ───────────────────────────────────────────────────────────────────

const dimensionIndex = ref(0);
const view = ref<"class" | "heat" | "terrain">("class");

/** Terrain pictures come from the dashboard backend one region at a time; a region without one is null. */
const tileLoader = computed(() => {
  const dimension = currentDimension.value;
  const root = base();
  return async (rx: number, rz: number): Promise<ImageBitmap | null> => {
    const blob = await apiBlob(`${root}/prune/tiles/${encodeURIComponent(dimension)}/${rx}/${rz}`);
    return blob ? createImageBitmap(blob) : null;
  };
});
const showGrid = ref(true);
/** How strongly the class colours cover the terrain view, in percent; 0 leaves the bare terrain. */
const overlayPercent = ref(Math.round(OVER_TERRAIN_OPACITY * 100));
const tool = ref<MapTool>("pan");
const mapRef = ref<{ fit(): void; zoomIn(): void; zoomOut(): void } | null>(null);
const zoom = ref(1);
const zoomLabel = computed(() => (zoom.value < 1 ? zoom.value.toFixed(2) : zoom.value.toFixed(1)));

function onCamera(info: { zoom: number }): void {
  zoom.value = info.zoom;
}

const toolOptions = computed(() => [
  { label: t("prune.tool.pan"), value: "pan" as const },
  { label: t("prune.tool.select"), value: "select" as const },
  { label: t("prune.tool.deselect"), value: "deselect" as const },
  { label: t("prune.tool.zone"), value: "zone" as const },
  { label: t("prune.tool.inspect"), value: "inspect" as const },
]);

// ── Inspector and build protection ────────────────────────────────────────

const buildProtected = computed(() => prune.params.value.buildProtection !== "off");

function setBuildProtection(on: boolean): void {
  prune.params.value = { ...prune.params.value, buildProtection: on ? "likely" : "off" };
}

const inspectedAt = computed(() => {
  const open = prune.inspected.value;
  return open && open.dimension === currentDimension.value ? { cx: open.cx, cz: open.cz } : null;
});

function onInspect(at: { cx: number; cz: number }): void {
  void prune.inspect(currentDimension.value, at.cx, at.cz);
}

const structureNames = computed(() => {
  const info = prune.inspected.value?.info;
  if (!info) return [];
  return [...new Set([...(info.structureStarts ?? []), ...(info.structureReferences ?? [])])].map((n) => n.replace("minecraft:", ""));
});

const INSPECT_CLASS: Record<number, MessageKey> = {
  [CELL.DELETE]: "prune.cell.delete",
  [CELL.ACTIVE]: "prune.cell.active",
  [CELL.PROTECTED]: "prune.cell.protected",
  [CELL.BUFFER]: "prune.cell.buffer",
  [CELL.UNREADABLE]: "prune.cell.unreadable",
  [CELL.UNCERTAIN]: "prune.cell.uncertain",
  [CELL.MANUAL_SOFT]: "prune.cell.manualSoft",
  [CELL.MANUAL_HARD]: "prune.cell.manualHard",
};

/** The cell grid of each region of the current map, by region key. */
const mapCells = computed(
  () => new Map((currentMap.value?.regions ?? []).map((r) => [regionKey(r.rx, r.rz), r.cell] as const)),
);

/** The class the map shows for the open chunk, as words. */
const inspectedClass = computed(() => {
  const open = prune.inspected.value;
  const map = currentMap.value;
  if (!open || !map) return "";
  const cell = mapCells.value.get(regionKey(regionOf(open.cx), regionOf(open.cz)))?.[slotOf(open.cx, open.cz)];
  return cell ? t(INSPECT_CLASS[cell] ?? "prune.cell.empty") : "";
});

function protectionText(p: { kind: string; name?: string }): string {
  if (p.kind === "zone") return t("prune.inspect.zone", { name: p.name || "?" });
  return t(p.kind === "spawn" ? "prune.inspect.spawn" : "prune.inspect.player");
}

// ── Selection by hand ─────────────────────────────────────────────────────

const allowProtected = ref(false);
const selectionVersion = ref(0);
const selection = new SelectionModel((dimension) => {
  const index = prune.summary.value?.dimensions.findIndex((d) => d.id === dimension) ?? -1;
  return prune.maps.value[index]?.regions ?? [];
});

function syncSelection(): void {
  selectionVersion.value++;
  prune.setSelection({ ops: selection.ops, allowProtected: allowProtected.value });
}

function onSelect(rect: { mode: "add" | "remove"; x1: number; z1: number; x2: number; z2: number }): void {
  if (!selection.apply([{ dimension: currentDimension.value, ...rect }])) {
    error.value = t("prune.selection.full");
    return;
  }
  syncSelection();
}

function undoSelection(): void {
  if (selection.undo()) syncSelection();
}

function redoSelection(): void {
  if (selection.redo()) syncSelection();
}

function clearSelection(): void {
  selection.clear();
  syncSelection();
}

async function toggleAllowProtected(on: boolean): Promise<void> {
  if (!on) {
    allowProtected.value = false;
    syncSelection();
    return;
  }
  const answer = await confirmAction({
    level: "irreversible",
    tone: "danger",
    header: t("prune.selection.allowProtectedConfirm"),
    message: t("prune.selection.allowProtectedConfirmText"),
    acceptLabel: t("prune.selection.allowProtectedAccept"),
  });
  allowProtected.value = answer === "confirm";
  syncSelection();
}

// The reactive reads below are what makes the counts follow every change.
const canUndo = computed(() => (selectionVersion.value, selection.canUndo));
const canRedo = computed(() => (selectionVersion.value, selection.canRedo));
const selectionOpCount = computed(() => (selectionVersion.value, selection.ops.length));

/** Chosen chunks that exist on the map (a rectangle also covers empty cells). */
const selectedCount = computed(() => {
  selectionVersion.value;
  if (!currentMap.value) return 0;
  const cells = mapCells.value;
  return selection.count(currentDimension.value, (rx, rz, slot) => {
    const cell = cells.get(regionKey(rx, rz));
    return !!cell && cell[slot] !== CELL.EMPTY;
  });
});

const breakdown = computed(() => {
  let soft = 0;
  let hard = 0;
  let blocked = 0;
  let total = 0;
  for (const d of prune.summary.value?.dimensions ?? []) {
    soft += d.manualSoft ?? 0;
    hard += d.manualHard ?? 0;
    blocked += d.manualBlocked ?? 0;
    total += d.delete;
  }
  return { auto: total - soft - hard, soft, hard, blocked };
});

const scanDimensionOptions = computed(() =>
  prune.dimensions.value.map((d) => ({ label: t("prune.dimensions.option", { id: d.id, regions: d.regions.toLocaleString() }), value: d.id })),
);

const dimensionOptions = computed(() =>
  (prune.summary.value?.dimensions ?? []).map((d, i) => ({ label: d.id, value: i })),
);
const viewOptions = computed(() => [
  { label: t("prune.map.viewClass"), value: "class" as const },
  { label: t("prune.map.viewHeat"), value: "heat" as const },
  { label: t("prune.map.viewTerrain"), value: "terrain" as const },
]);
const currentDimension = computed(() => prune.summary.value?.dimensions[dimensionIndex.value]?.id ?? "overworld");
const currentMap = computed(() => prune.maps.value[dimensionIndex.value] ?? null);

const legend = [
  { cell: CELL.DELETE, role: "offline", label: "prune.cell.delete" as MessageKey },
  { cell: CELL.ACTIVE, role: "online", label: "prune.cell.active" as MessageKey },
  { cell: CELL.PROTECTED, role: "info", label: "prune.cell.protected" as MessageKey },
  { cell: CELL.BUFFER, role: "pending", label: "prune.cell.buffer" as MessageKey },
  { cell: CELL.UNREADABLE, role: "degraded", label: "prune.cell.unreadable" as MessageKey },
  { cell: CELL.UNCERTAIN, role: "unknown", label: "prune.cell.uncertain" as MessageKey },
  { cell: CELL.MANUAL_SOFT, role: "offline", label: "prune.cell.manualSoft" as MessageKey },
  { cell: CELL.MANUAL_HARD, role: "offline", label: "prune.cell.manualHard" as MessageKey },
];

watch(
  [() => prune.summary.value?.id, dimensionIndex],
  () => {
    if (prune.summary.value) void prune.loadMap(dimensionIndex.value);
  },
);

// Selection bitsets follow the loaded maps: repaint them once a map (re)appears.
watch(currentMap, () => {
  selection.refresh();
  selectionVersion.value++;
});

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
    }) + (breakdown.value.soft + breakdown.value.hard > 0
      ? " " + t("prune.apply.breakdown", { auto: breakdown.value.auto.toLocaleString(), soft: breakdown.value.soft.toLocaleString(), hard: breakdown.value.hard.toLocaleString() })
      : ""),
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
  if (jobId) {
    clearSelection();
    await run.attach();
  }
}

function clearRun(): void {
  run.dismiss();
  void load();
}

async function load(): Promise<void> {
  await prune.loadSupport();
  if (!prune.supported.value) return;
  await Promise.all([prune.loadSettings(), prune.loadDimensions(), prune.loadStatus(), run.attach()]);
}

watch(server, () => {
  prune.reset();
  run.reset();
  selection.clear();
  allowProtected.value = false;
  selectionVersion.value++;
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
.pv-field :deep(.p-inputnumber),
.pv-field :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}
.pv-dims {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}
.pv-dims legend {
  font-weight: 600;
  padding: 0;
}
.pv-dim-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.pv-dim-label .pi {
  font-size: 0.75rem;
}
.pv-progress {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}
.pv-progress progress {
  width: min(100%, 28rem);
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
.pv-opacity {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.pv-opacity-slider {
  width: 8rem;
  /* The handle overhangs the track's ends; keep it off the label and the value. */
  margin-inline: var(--space-2);
}
.pv-zoom {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.pv-summary-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
/* The map is the page's main tool: it takes the width the sidebar leaves and
   the height of the window, and the sidebar scrolls on its own beside it. */
.pv-workspace {
  --pv-map-height: max(26rem, calc(100dvh - 10rem));
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(18rem, 24vw, 26rem);
  align-items: start;
  gap: var(--space-4);
}
.pv-stage {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.pv-side {
  position: sticky;
  top: var(--space-3);
  max-height: calc(100dvh - 2 * var(--space-3));
  overflow-y: auto;
  display: grid;
  gap: var(--space-3);
  align-content: start;
}
.pv-panel {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.pv-panel h3 {
  margin: 0;
  font-size: var(--text-lg);
}
.pv-panel .pv-total {
  font-size: var(--text-lg);
}
.pv-fold {
  display: block;
}
.pv-fold > summary {
  cursor: pointer;
  font-weight: 600;
}
.pv-fold > summary h2 {
  display: inline;
}
.pv-fold-body {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.pv-fold-body.is-scroll {
  overflow-x: auto;
}
@media (max-width: 1100px) {
  .pv-workspace {
    --pv-map-height: max(20rem, 70dvh);
    grid-template-columns: minmax(0, 1fr);
  }
  .pv-side {
    position: static;
    max-height: none;
    overflow: visible;
  }
}
.pv-inspector {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.pv-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.pv-facts {
  margin: 0;
  padding-left: var(--space-4);
  display: grid;
  gap: var(--space-1);
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
  display: grid;
  gap: var(--space-1);
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
.pv-swatch.is-unknown { background: var(--st-unknown); }
</style>
