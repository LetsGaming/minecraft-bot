<template>
  <div v-if="showCheck" class="check" role="group" aria-labelledby="mods-check-label">
    <div class="check-row">
      <div class="check-field">
        <label id="mods-check-label" for="mods-check-target">{{ t("mods.check.target") }}</label>
        <Select
          v-if="!compat.useCustom.value"
          v-model="compat.selected.value"
          class="check-select tap"
          :options="versionOptions"
          option-label="label"
          option-value="value"
          label-id="mods-check-target"
          aria-labelledby="mods-check-label"
          :loading="compat.loadingVersions.value"
          :disabled="compat.checkingCompat.value || compat.loadingVersions.value"
        />
        <InputText
          v-else
          id="mods-check-target"
          v-model="compat.customVersion.value"
          class="check-input tap mono"
          :placeholder="t('mods.check.customPlaceholder')"
          :disabled="compat.checkingCompat.value"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="startCheck()"
        />
      </div>
      <Button
        class="tap"
        :label="compat.checkingCompat.value ? t('mods.check.checking') : checkButtonLabel"
        :loading="compat.checkingCompat.value"
        :disabled="compat.checkingCompat.value || !compat.targetValid.value || modList.length === 0"
        @click="startCheck()"
      />
      <Button
        class="tap"
        :label="compat.useCustom.value ? t('mods.check.pickFromList') : t('mods.check.typeVersion')"
        severity="secondary"
        text
        :disabled="compat.checkingCompat.value || (compat.useCustom.value && compat.releases.value.length === 0)"
        @click="compat.useCustom.value = !compat.useCustom.value"
      />
    </div>

    <p v-if="checkedAtText" class="small dim">{{ checkedAtText }}</p>

    <JobBlock
      v-if="compat.checkingCompat.value"
      :title="progressTitle"
      state="running"
      :progress="compat.job.value?.progress ?? null"
      :heading-level="3"
    >
      <p>{{ t("mods.check.runningNote", { version: checkVersionShown }) }}</p>
    </JobBlock>

    <JobBlock
      v-else-if="checkFailed"
      :title="t('mods.check.failedTitle', { version: checkVersionShown })"
      state="failed"
      :heading-level="3"
    >
      <p class="failure">{{ failureText }}</p>
      <template #actions>
        <Button class="tap" :label="t('mods.check.again')" size="small" @click="startCheck(true)" />
        <Button class="tap" :label="t('mods.check.close')" size="small" severity="secondary" text @click="closeResults" />
        <span class="small dim nothing-changed">{{ t("mods.check.nothingChanged") }}</span>
      </template>
    </JobBlock>

    <InlineBanner v-else-if="checkNotice" tone="warn">{{ checkNotice }}</InlineBanner>

    <p v-if="compat.emptyResult.value" class="small dim">{{ t("mods.check.emptyResult") }}</p>

    <template v-if="compat.hasResult.value && !compat.emptyResult.value">
      <InlineBanner v-if="compat.stale.value" tone="warn" :title="t('mods.check.staleTitle')">
        {{ t("mods.check.staleText") }}
        <template #actions>
          <Button class="tap" :label="t('mods.check.again')" size="small" outlined @click="startCheck(true)" />
        </template>
      </InlineBanner>
      <InlineBanner
        v-else
        :tone="blockerCount > 0 ? 'warn' : 'info'"
        :title="blockerCount > 0 ? t('mods.check.blockedTitle') : t('mods.check.readyTitle')"
      >
        {{ verdictText }}
        <template v-if="blockerCount > 0" #actions>
          <Button
            class="tap"
            icon="pi pi-copy"
            :label="t('mods.check.copyBlockers')"
            size="small"
            severity="secondary"
            outlined
            @click="copyBlockers"
          />
        </template>
      </InlineBanner>

      <div class="check-results">
        <div class="minimeter">
          <div class="metric metric-ready">
            <span class="metric-n">{{ summary.available }}</span>
            <span class="metric-l">{{ t("mods.check.metricReady") }}</span>
          </div>
          <div class="metric metric-missing">
            <span class="metric-n">{{ summary.unavailable }}</span>
            <span class="metric-l">{{ t("mods.check.metricMissing") }}</span>
          </div>
          <div class="metric metric-unknown">
            <span class="metric-n">{{ summary.unknown }}</span>
            <span class="metric-l">{{ t("mods.check.metricUnknown") }}</span>
          </div>
        </div>
        <div v-if="blockerRows.length" class="blockers">
          <span id="mods-blockers-l" class="caps">{{ t("mods.check.blocking") }}</span>
          <ul class="iconstrip" aria-labelledby="mods-blockers-l">
            <li v-for="row in blockerRows.slice(0, BLOCKER_ICONS)" :key="row.slug">
              <ModIcon :name="nameOf(row)" :slug="row.slug" :src="iconOf(row.slug, row.iconUrl)" :size="32" />
            </li>
            <li v-if="blockerRows.length > BLOCKER_ICONS" class="more">
              {{ t("mods.check.more", { count: blockerRows.length - BLOCKER_ICONS }) }}
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>

  <template v-if="compat.checkingCompat.value">
    <div class="subhead">
      <h3>{{ t("mods.check.progressTitle") }}</h3>
      <span class="card-meta">{{ t("mods.check.progressMeta") }}</span>
    </div>
    <ResponsiveTable
      stack-below="narrow"
      :columns="checkColumns"
      :rows="progressRows"
      :caption="t('mods.check.progressCaption')"
      :row-key="(r: CheckRow) => r.slug"
    >
      <template #cell-mod="{ row }">
        <ModCell :name="row.name" :slug="row.slug" :icon-url="row.iconUrl" />
      </template>
      <template #cell-installed="{ row }"><span class="mono">{{ row.installedVersion }}</span></template>
      <template #cell-at="{ row }">
        <StatusChip v-if="row.result" :state="CHIP[row.result.availability].role" :label="t(CHIP[row.result.availability].label)" />
        <StatusChip v-else state="unknown" :label="t('mods.check.waiting')" />
      </template>
      <template #cell-detail="{ row }">
        <span class="small dim">{{ row.result ? detailOf(row.result) : t("mods.check.detailQueued") }}</span>
      </template>
    </ResponsiveTable>
  </template>

  <template v-else-if="compat.hasResult.value && !compat.emptyResult.value">
    <div class="subhead">
      <h3>{{ t("mods.check.resultsTitle", { version: checkVersionShown }) }}</h3>
      <span class="card-meta">{{ t("mods.check.resultsOrder") }}</span>
      <Button
        class="tap"
        icon="pi pi-arrow-left"
        :label="t('mods.check.close')"
        size="small"
        severity="secondary"
        text
        @click="closeResults"
      />
    </div>
    <div class="toolbar" role="group" :aria-label="t('mods.check.filterLabel')">
      <button
        v-for="chip in resultFilters"
        :key="chip.key"
        type="button"
        :class="['chip', 'tap', { on: compat.filter.value === chip.key }]"
        :aria-pressed="compat.filter.value === chip.key"
        @click="compat.filter.value = chip.key"
      >
        {{ chip.label }} <span class="chip-n">{{ chip.count }}</span>
      </button>
    </div>
    <ResponsiveTable
      v-if="visibleResults.length"
      stack-below="narrow"
      :columns="checkColumns"
      :rows="visibleResults"
      :caption="t('mods.check.caption', { version: checkVersionShown })"
      :row-key="(r: CheckRow) => r.slug"
      :actions-label="t('mods.installed.actions')"
      :actions-label-visible="false"
    >
      <template #cell-mod="{ row }">
        <ModCell :name="row.name" :slug="row.slug" :icon-url="row.iconUrl" />
      </template>
      <template #cell-installed="{ row }"><span class="mono">{{ row.installedVersion }}</span></template>
      <template #cell-at="{ row }">
        <StatusChip
          v-if="row.result"
          :state="CHIP[row.result.availability].role"
          :label="t(CHIP[row.result.availability].label)"
        />
      </template>
      <template #cell-detail="{ row }">
        <span class="small dim detail">{{ row.result ? detailOf(row.result) : "" }}</span>
      </template>
      <template #actions="{ row }">
        <a
          v-if="row.result && row.result.availability !== 'available'"
          class="link-btn tap"
          :href="modrinthUrl(row.slug)"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('mods.check.openProjectNamed', { name: row.name })"
        >{{ t("mods.check.openProject") }}</a>
      </template>
    </ResponsiveTable>
    <p v-else class="none-in-filter small dim">{{ t("mods.check.noneInFilter") }}</p>
    <div class="foot">
      <span class="foot-count" aria-live="polite">
        {{ t("mods.check.showing", { shown: visibleResults.length, total: allResults.length }) }}
      </span>
    </div>
  </template>

  <slot v-else />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import { StatusRole } from "@mcbot/schema";
import { t, type MessageKey } from "../../i18n";
import { absoluteStamp } from "../../utils/time";
import { modrinthUrl } from "../../utils/modsFormat";
import type { InstalledMod, InstalledMods, ModCompatMod } from "../../api";
import { useMods } from "../../composables/useMods";
import { useModCompat, type CompatFilter } from "../../composables/useModCompat";
import { useNotify } from "../../composables/useNotify";
import InlineBanner from "../ui/InlineBanner.vue";
import JobBlock from "../ui/JobBlock.vue";
import ModIcon from "../ui/ModIcon.vue";
import ResponsiveTable from "../ui/ResponsiveTable.vue";
import StatusChip from "../ui/StatusChip.vue";
import type { ResponsiveColumn } from "../ui/types";
import ModCell from "./ModCell.vue";

interface CheckRow {
  slug: string;
  name: string;
  iconUrl: string;
  installedVersion: string;
  result: ModCompatMod | undefined;
}

const props = withDefaults(
  defineProps<{
    server: string;
    installed: InstalledMods | null;
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

defineSlots<{
  /** What shows when no check is running and none has a result: the installed list. */
  default(): unknown;
}>();

const BLOCKER_ICONS = 6;
const ORDER: Record<ModCompatMod["availability"], number> = { unavailable: 0, unknown: 1, available: 2 };
const CHIP: Record<ModCompatMod["availability"], { role: StatusRole; label: MessageKey }> = {
  available: { role: StatusRole.Online, label: "mods.check.ready" },
  unavailable: { role: StatusRole.Offline, label: "mods.check.noBuild" },
  // Unknown blocks an upgrade decision, so it reads as "needs a look", not as grey.
  unknown: { role: StatusRole.Degraded, label: "mods.check.unknown" },
};

const mods = useMods(() => props.server);
const notify = useNotify();
const modList = computed<InstalledMod[]>(() => props.installed?.mods ?? []);

const checkError = ref("");
const compat = useModCompat({
  api: { start: mods.compatStart, poll: mods.compatPoll, versions: mods.compatVersions },
  installedVersion: () => props.installed?.gameVersion,
  onError: (text) => (checkError.value = text),
});

/** The compat check knows a project's display name; the installed list only has the slug. */
function nameOf(m: { slug: string; name?: string }): string {
  return m.name || compat.forSlug(m.slug)?.name || m.slug;
}

function iconOf(slug: string, own?: string): string {
  return own || modList.value.find((m) => m.slug === slug)?.iconUrl || "";
}

const versionOptions = computed(() =>
  compat.versionChoices.value.map((v) => ({
    value: v,
    label: v === props.installed?.gameVersion ? t("mods.check.installedSuffix", { version: v }) : v,
  })),
);

/** The check group, unless there is nothing to check and no check to show. */
const showCheck = computed(
  () =>
    !!props.installed?.compat &&
    (modList.value.length > 0 || compat.checkedVersion.value !== null || compat.checkingCompat.value),
);

const checkButtonLabel = computed(() =>
  compat.targetValid.value
    ? t("mods.check.button", { count: modList.value.length, version: compat.targetVersion.value })
    : t("mods.check.buttonNoVersion"),
);

const checkVersionShown = computed(() => compat.checkedVersion.value ?? compat.targetVersion.value);

const progressTitle = computed(() => {
  const p = compat.job.value?.progress;
  if (!p || p.total === 0) return t("mods.check.starting", { version: checkVersionShown.value });
  return t("mods.check.progress", { done: Math.min(p.done, p.total), total: p.total });
});

/** A finished job that failed, or a start or poll that failed before any job answered. */
const checkFailed = computed(
  () =>
    compat.failed.value ||
    (!!checkError.value && compat.checkedVersion.value !== null && !compat.checkingCompat.value && !compat.hasResult.value),
);
const failureText = computed(() => compat.job.value?.error || checkError.value || t("mods.check.failedNoReason"));
/** Problems outside a check, such as the version list not loading. */
const checkNotice = computed(() => (checkFailed.value ? "" : checkError.value));

const checkedAtText = computed(() => {
  const at = compat.job.value?.checkedAt;
  if (!compat.hasResult.value || !at || compat.stale.value) return "";
  return t("mods.check.checkedAt", { version: checkVersionShown.value, time: absoluteStamp(at) });
});

const summary = computed(() => compat.summary.value ?? { available: 0, unavailable: 0, unknown: 0, total: 0 });
const blockerCount = computed(() => summary.value.unavailable + summary.value.unknown);

const verdictText = computed(() => {
  const version = checkVersionShown.value;
  if (blockerCount.value === 0) return t("mods.check.readyText", { version });
  const parts: string[] = [];
  if (summary.value.unavailable > 0) parts.push(t("mods.check.blockedMissing", { count: summary.value.unavailable, version }));
  if (summary.value.unknown > 0) parts.push(t("mods.check.blockedUnknown", { count: summary.value.unknown }));
  parts.push(t("mods.check.blockedAdvice"));
  return parts.join(" ");
});

function toCheckRow(slug: string, result: ModCompatMod | undefined, name?: string): CheckRow {
  return {
    slug,
    name: name || result?.name || nameOf({ slug }),
    iconUrl: iconOf(slug, result?.iconUrl),
    installedVersion: modList.value.find((m) => m.slug === slug)?.versionId ?? "",
    result,
  };
}

const allResults = computed<CheckRow[]>(() =>
  [...compat.rows.value]
    .sort((a, b) => ORDER[a.availability] - ORDER[b.availability] || nameOf(a).localeCompare(nameOf(b)))
    .map((r) => toCheckRow(r.slug, r)),
);
const blockerRows = computed(() =>
  compat.rows.value
    .filter((r) => r.availability !== "available")
    .sort((a, b) => ORDER[a.availability] - ORDER[b.availability]),
);
const visibleResults = computed(() => {
  const f = compat.filter.value;
  if (f === "blockers") return allResults.value.filter((r) => r.result?.availability !== "available");
  if (f === "ready") return allResults.value.filter((r) => r.result?.availability === "available");
  return allResults.value;
});
const resultFilters = computed<Array<{ key: CompatFilter; label: string; count: number }>>(() => [
  { key: "all", label: t("mods.check.filterAll"), count: allResults.value.length },
  { key: "blockers", label: t("mods.check.filterBlockers"), count: blockerCount.value },
  { key: "ready", label: t("mods.check.filterReady"), count: summary.value.available },
]);
const progressRows = computed<CheckRow[]>(() =>
  modList.value.map((m) => toCheckRow(m.slug, compat.forSlug(m.slug), nameOf(m))),
);

const checkColumns = computed<ResponsiveColumn[]>(() => [
  { key: "mod", label: t("mods.installed.colMod"), primary: true },
  { key: "installed", label: t("mods.check.colInstalled") },
  { key: "at", label: t("mods.check.colAt", { version: checkVersionShown.value }) },
  { key: "detail", label: t("mods.check.colDetail") },
]);

function detailOf(r: ModCompatMod): string {
  if (r.availability === "available") {
    return r.target
      ? t("mods.check.detailBuild", { name: r.target.versionName })
      : t("mods.check.detailNewest", { version: checkVersionShown.value });
  }
  return r.reason || t("mods.check.detailNoReason");
}

/** What a finished check was computed from: slug, build and enabled state. */
function installedSignature(list: InstalledMod[]): string {
  return list
    .map((m) => `${m.slug}:${m.versionId ?? ""}:${m.enabled === false ? 0 : 1}`)
    .sort()
    .join("|");
}
let checkedSignature = "";

function runCheck(refresh: boolean): Promise<void> {
  checkError.value = "";
  checkedSignature = installedSignature(modList.value);
  return compat.check(refresh);
}

function startCheck(refresh = false): Promise<void> {
  compat.filter.value = "blockers";
  return runCheck(refresh);
}

function closeResults(): void {
  compat.reset();
  checkError.value = "";
}

async function copyBlockers(): Promise<void> {
  const lines = blockerRows.value.map((r) => `${nameOf(r)} (${t(CHIP[r.availability].label)})`);
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    notify.ok(t("mods.check.copied"));
  } catch {
    notify.warn(t("mods.check.copyFailed"));
  }
}

watch(modList, (next) => {
  if (compat.hasResult.value && installedSignature(next) !== checkedSignature) compat.markStale();
});

function routeFilter(value: string): CompatFilter {
  return value === "blockers" || value === "ready" ? value : "all";
}

/** Runs the check the URL names, once the installed list says checks are possible. */
async function applyRouteCheck(): Promise<void> {
  if (!props.check || !props.installed?.compat || compat.checkingCompat.value) return;
  if (compat.versionChoices.value.includes(props.check)) {
    compat.useCustom.value = false;
    compat.selected.value = props.check;
  } else {
    compat.useCustom.value = true;
    compat.customVersion.value = props.check;
  }
  compat.filter.value = routeFilter(props.filter);
  await runCheck(false);
}

watch(
  () => props.check,
  (version) => {
    if (version && version !== compat.checkedVersion.value) void applyRouteCheck();
  },
);
watch(
  () => props.filter,
  (value) => {
    if (compat.hasResult.value) compat.filter.value = routeFilter(value);
  },
);
watch([compat.checkedVersion, compat.filter], ([version, filter]) => {
  const check = version ?? "";
  const shownFilter = version && filter !== "all" ? filter : "";
  if (check === props.check && shownFilter === props.filter) return;
  emit("update-route", { query: { check: check || undefined, filter: shownFilter || undefined } });
});

/** After the installed list loaded: fetch the version choices once, then run the check the URL asks for. */
async function afterInstalledLoad(): Promise<void> {
  if (props.installed?.compat && compat.releases.value.length === 0) await compat.loadVersions();
  await applyRouteCheck();
}

/** A server switch: forget the old server's check. */
function reset(): void {
  compat.reset();
  checkError.value = "";
  compat.selected.value = "";
}

onBeforeUnmount(() => compat.dispose());

defineExpose({ afterInstalledLoad, reset, nameOf });
</script>

<style scoped src="./shared.css"></style>
<style scoped>
.check {
  display: grid;
  gap: var(--space-3);
  margin: 0 calc(-1 * var(--space-4)) var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.check p { margin: 0; }
.check-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3) var(--space-4); }
.check-field { display: grid; gap: var(--space-1); min-width: 180px; }
.check-field label { font-size: var(--text-sm); color: var(--text-dim); }
.check-select, .check-input { min-width: 180px; }
.failure { overflow-wrap: anywhere; }
.nothing-changed { align-self: center; }

.check-results {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4) var(--space-5);
  align-items: start;
}
@container (min-width: 760px) {
  .check-results { grid-template-columns: minmax(0, 420px) minmax(0, 1fr); }
}
.minimeter { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.metric {
  display: grid;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--metric-edge, var(--border));
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.metric-ready { --metric-edge: var(--st-online); }
.metric-missing { --metric-edge: var(--st-offline); }
.metric-unknown { --metric-edge: var(--st-degraded); }
.metric-n { font-size: var(--text-3xl); font-weight: 600; line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.metric-l { font-size: var(--text-sm); color: var(--text-dim); }
.blockers { display: grid; gap: var(--space-2); }
.iconstrip { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.iconstrip .more { font-size: var(--text-sm); color: var(--text-dim); }

.subhead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  margin-bottom: var(--space-3);
}
.subhead h3 { margin: 0; font-size: var(--text-lg); font-weight: 600; }

.detail { overflow-wrap: anywhere; }

@media (max-width: 760px) {
  .check-row > * { flex: 1 1 100%; }
  .check-select, .check-input { width: 100%; }
  .metric { padding: var(--space-3); }
  .metric-n { font-size: var(--text-2xl); }
}
</style>
