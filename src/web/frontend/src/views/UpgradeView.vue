<template>
  <div class="upgrade-view">
    <ViewHeader :title="t('upgrade.title')" :server="activeServer" :subtitle="t('upgrade.lede', { server: activeServer })" />

    <InlineBanner v-if="error" tone="danger" :title="t('upgrade.errorTitle')">{{ error }}</InlineBanner>

    <p v-if="upgrade.supported.value === null" class="up-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("upgrade.loading") }}
    </p>

    <EmptyState
      v-else-if="upgrade.supported.value === false"
      icon="pi pi-arrow-circle-up"
      :title="t('upgrade.unsupportedTitle')"
      :heading-level="2"
    >
      {{ t("upgrade.unsupportedText") }}
    </EmptyState>

    <template v-else>
      <UpgradeRun v-if="upgrade.job.value" :upgrade="upgrade" :server="activeServer" @again="clearFinished" />

      <template v-else>
        <section class="up-card" aria-labelledby="up-target">
          <h2 id="up-target">{{ t("upgrade.target.heading") }}</h2>
          <p v-if="installedVersion" class="up-note">{{ t("upgrade.target.current", { version: installedVersion }) }}</p>

          <div class="up-row">
            <div v-if="canCheck && !compat.useCustom.value" class="up-field">
              <label class="up-label" for="up-version">{{ t("upgrade.target.label") }}</label>
              <Select
                v-model="compat.selected.value"
                input-id="up-version"
                :options="compat.versionChoices.value"
                :loading="compat.loadingVersions.value"
                class="up-input"
              />
            </div>
            <div v-else class="up-field">
              <label class="up-label" for="up-custom">{{ t("upgrade.target.label") }}</label>
              <InputText
                id="up-custom"
                v-model="compat.customVersion.value"
                class="up-input"
                autocomplete="off"
                spellcheck="false"
                :invalid="compat.customVersion.value !== '' && !compat.targetValid.value"
              />
            </div>
            <Button
              v-if="canCheck && compat.releases.value.length > 0"
              class="tap"
              :label="compat.useCustom.value ? t('upgrade.target.pick') : t('upgrade.target.custom')"
              severity="secondary"
              text
              @click="compat.useCustom.value = !compat.useCustom.value"
            />
          </div>

          <p v-if="!canCheck" class="up-note">{{ t("upgrade.check.skipNote") }}</p>
          <Button
            v-else
            class="tap"
            :label="compat.hasResult.value ? t('upgrade.check.again') : t('upgrade.check.button')"
            icon="pi pi-search"
            :disabled="!compat.targetValid.value"
            :loading="compat.checkingCompat.value"
            @click="runCheck"
          />
          <p v-if="compat.checkingCompat.value" class="up-note" role="status">{{ checkProgress }}</p>
        </section>

        <section v-if="compat.hasResult.value" class="up-card" aria-labelledby="up-mods">
          <h2 id="up-mods">{{ t("upgrade.mods.heading") }}</h2>
          <p class="up-note">{{ compat.summaryText.value }}</p>
          <p v-if="attention.length === 0" class="up-ok">
            {{ t("upgrade.mods.none", { version: compat.checkedVersion.value ?? "" }) }}
          </p>
          <template v-else>
            <ul class="up-mods">
              <li v-for="mod in attention" :key="mod.slug">
                <span class="up-mod-name">{{ mod.slug }}</span>
                <StatusChip
                  :state="mod.availability === 'unknown' ? StatusRole.Degraded : StatusRole.Offline"
                  :label="t(mod.availability === 'unknown' ? 'mods.check.unknown' : 'mods.check.noBuild')"
                />
              </li>
            </ul>
            <p class="up-note">{{ t("upgrade.mods.policy") }}</p>
          </template>
        </section>

        <section v-if="prune.supported.value" class="up-card" aria-labelledby="up-prune">
          <h2 id="up-prune">{{ t("upgrade.prune.heading") }}</h2>
          <p class="up-note">{{ t("upgrade.prune.help") }}</p>
          <label class="up-check">
            <Checkbox v-model="includePrune" binary input-id="up-prune-on" />
            {{ t("upgrade.prune.include") }}
          </label>
          <template v-if="includePrune">
            <p class="up-note">{{ t("upgrade.prune.settings", { minutes: prune.params.value.thresholdMinutes, buffer: prune.params.value.bufferChunks }) }}</p>
            <div class="up-row">
              <Button
                class="tap"
                icon="pi pi-search"
                :label="prune.summary.value ? t('prune.scan.again') : t('prune.scan.button')"
                severity="secondary"
                outlined
                :loading="prune.scanning.value"
                @click="prune.scan"
              />
              <Button class="tap" :label="t('upgrade.prune.tune')" icon="pi pi-sliders-h" severity="secondary" text @click="$emit('navigate', 'prune')" />
            </div>
            <p v-if="prune.summary.value && prune.summaryCurrent.value" class="up-ok">
              {{ t("upgrade.prune.preview", {
                delete: prune.summary.value.totals.delete.toLocaleString(),
                chunks: prune.summary.value.totals.chunks.toLocaleString(),
                size: formatBytes(prune.summary.value.totals.bytes),
              }) }}
            </p>
            <p v-else class="up-warn">{{ t("upgrade.prune.needsScan") }}</p>
            <p class="up-note">{{ t("prune.scan.approximate") }}</p>
          </template>
        </section>

        <section class="up-card" aria-labelledby="up-options">
          <h2 id="up-options">{{ t("upgrade.options.heading") }}</h2>
          <div class="up-field">
            <label class="up-label" for="up-countdown">{{ t("upgrade.options.countdown") }}</label>
            <Select
              v-model="countdown"
              input-id="up-countdown"
              :options="countdownOptions"
              option-label="label"
              option-value="value"
              class="up-input"
            />
          </div>
          <p v-if="stale" class="up-warn">{{ t("upgrade.check.stale") }}</p>
          <Button
            class="tap"
            :label="t('upgrade.start', { server: activeServer, version: targetVersion || '?' })"
            icon="pi pi-arrow-circle-up"
            severity="danger"
            :disabled="!canStart"
            :loading="upgrade.starting.value"
            @click="confirmStart"
          />
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { StatusRole, formatBytes } from "@mcbot/schema";
import { apiGet, apiSend } from "../api";
import type { ModCompatJob, ModCompatMod } from "../api";
import { useModCompat } from "../composables/useModCompat";
import { useServerUpgrade } from "../composables/useServerUpgrade";
import { usePrune } from "../composables/usePrune";
import { useCapabilities } from "../composables/useCapabilities";
import { useConfirmAction } from "../composables/useConfirmAction";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import UpgradeRun from "../components/UpgradeRun.vue";
import { t } from "../i18n";
import type {
  PruneMap,
  PruneParams,
  PruneParamsRequest,
  PruneScanJob,
  UpgradeJob,
  UpgradeRequest,
  UpgradeStarted,
} from "@mcbot/schema/wire/index.js";

const props = defineProps<{ activeServer: string }>();
defineEmits<{ navigate: [id: string] }>();

const { can } = useCapabilities();
const confirmAction = useConfirmAction();

const error = ref("");
const countdown = ref(30);
const includePrune = ref(false);

const server = computed(() => props.activeServer);
const base = (): string => `/api/servers/${encodeURIComponent(server.value)}`;

/** The compatibility check needs the mods:read the Mods page uses; without it the check is skipped. */
const canCheck = computed(() => can("mods:read", server.value));

const upgrade = useServerUpgrade({
  api: {
    support: () => apiGet<{ supported: boolean }>(`${base()}/upgrade/support`),
    start: (body: UpgradeRequest) => apiSend<UpgradeStarted>("POST", `${base()}/upgrade`, body),
    poll: (jobId, since) => apiGet<UpgradeJob>(`${base()}/upgrade/${jobId}?since=${since}`),
    current: async (since) => (await apiGet<{ job: UpgradeJob | null }>(`${base()}/upgrade/current?since=${since}`)).job,
  },
  onError: (message) => (error.value = message),  kind: "upgrade",
});

/** Chunk pruning inside the upgrade: the same scan and saved settings as the Prune page. */
const prune = usePrune({
  api: {
    support: () => apiGet<{ supported: boolean }>(`${base()}/prune/support`),
    settings: () => apiGet<PruneParams>(`${base()}/prune/settings`),
    save: (p: PruneParamsRequest) => apiSend<PruneParams>("PUT", `${base()}/prune/settings`, p),
    scan: (p: PruneParamsRequest) => apiSend<{ jobId: string }>("POST", `${base()}/prune/scans`, p),
    poll: (jobId) => apiGet<PruneScanJob>(`${base()}/prune/scans/${jobId}`),
    map: (planId, index) => apiGet<PruneMap>(`${base()}/prune/plans/${planId}/map/${index}`),
    apply: () => Promise.reject(new Error("The prune runs as part of the upgrade.")),
  },
  onError: (message) => (error.value = message),
});

const installedVersion = ref<string | null>(null);

/** The version the server runs now, from the mod manifest; only readable with mods:read. */
async function loadInstalledVersion(): Promise<void> {
  installedVersion.value = null;
  if (!canCheck.value) return;
  try {
    const installed = await apiGet<{ gameVersion?: string | null }>(`${base()}/mods/installed`);
    installedVersion.value = installed.gameVersion ?? null;
  } catch {
    /* the picker still works without it */
  }
}

const compat = useModCompat({
  api: {
    start: (mcVersion, refresh) =>
      apiSend<{ jobId: string }>("POST", `${base()}/mods/compat`, { mcVersion, ...(refresh ? { refresh: true } : {}) }),
    poll: (jobId) => apiGet<ModCompatJob>(`${base()}/mods/compat/${jobId}`),
    versions: () => apiGet<{ versions: string[] }>(`${base()}/mods/compat/versions`),
  },
  installedVersion: () => installedVersion.value,
  onError: (message) => (error.value = message),
});

const targetVersion = computed(() => compat.targetVersion.value);
const stale = computed(() => compat.hasResult.value && compat.checkedVersion.value !== targetVersion.value);

/** Mods that will not have a clean build on the target: no build, or not known. */
const attention = computed<ModCompatMod[]>(() =>
  (compat.job.value?.mods ?? []).filter((m) => m.availability !== "available"),
);

const pruneReady = computed(
  () => !includePrune.value || (prune.summaryCurrent.value && prune.hasDeletions.value),
);

const canStart = computed(
  () =>
    compat.targetValid.value &&
    !upgrade.running.value &&
    !upgrade.starting.value &&
    !compat.checkingCompat.value &&
    !prune.scanning.value &&
    pruneReady.value &&
    (!canCheck.value || (compat.hasResult.value && !stale.value)),
);

const countdownOptions = computed(() => [
  { label: t("upgrade.options.noWarning"), value: 0 },
  { label: t("upgrade.options.seconds", { count: 30 }), value: 30 },
  { label: t("upgrade.options.minute"), value: 60 },
  { label: t("upgrade.options.minutes", { count: 2 }), value: 120 },
]);

const checkProgress = computed(() => {
  const p = compat.job.value?.progress;
  if (!p || p.total === 0) return t("upgrade.check.starting");
  return t("upgrade.check.progress", { done: Math.min(p.done + 1, p.total), total: p.total });
});

async function runCheck(): Promise<void> {
  error.value = "";
  await compat.check(false);
}

async function confirmStart(): Promise<void> {
  error.value = "";
  const name = server.value;
  const version = targetVersion.value;
  const withPrune = includePrune.value && prune.summary.value !== null;
  const facts = [
    { term: t("upgrade.fact.steps"), detail: t("upgrade.fact.stepsDetail") },
    { term: t("upgrade.fact.fallback"), detail: t("upgrade.fact.fallbackDetail") },
    { term: t("upgrade.fact.downtime"), detail: t("upgrade.fact.downtimeDetail") },
    { term: t("upgrade.fact.recover"), detail: t("upgrade.fact.recoverDetail") },
  ];
  if (withPrune && prune.summary.value) {
    facts.splice(1, 0, {
      term: t("upgrade.fact.prune"),
      detail: t("upgrade.fact.pruneDetail", {
        count: prune.summary.value.totals.delete.toLocaleString(),
        size: formatBytes(prune.summary.value.totals.bytes),
      }),
    });
  }
  const answer = await confirmAction({
    level: "irreversible",
    tone: "danger",
    header: t("upgrade.confirm.header", { server: name, version }),
    message: t("upgrade.confirm.message", { server: name, version }),
    acceptLabel: t("upgrade.confirm.accept", { server: name }),
    expected: name,
    facts,
  });
  if (answer !== "confirm") return;
  await upgrade.start({
    mcVersion: version,
    ...(canCheck.value ? { expectUnavailable: attention.value.map((m) => m.slug) } : {}),
    countdownSeconds: countdown.value,
    ...(withPrune && prune.summary.value ? { prunePlan: prune.summary.value.id } : {}),
  });
}

function clearFinished(): void {
  upgrade.dismiss();
  void load();
}

async function load(): Promise<void> {
  await Promise.all([upgrade.loadSupport(), prune.loadSupport()]);
  if (!upgrade.supported.value) return;
  await upgrade.attach();
  if (prune.supported.value) await prune.loadSettings();
  await loadInstalledVersion();
  if (canCheck.value) await compat.loadVersions();
}

watch(server, () => {
  compat.reset();
  upgrade.reset();
  prune.reset();
  includePrune.value = false;
  error.value = "";
  // The shell fills the server in after the first render; never call with none.
  if (server.value) void load();
}, { immediate: true });

onBeforeUnmount(() => {
  compat.dispose();
  upgrade.dispose();
  prune.dispose();
});
</script>

<style scoped>
.upgrade-view {
  display: grid;
  gap: var(--space-4);
}
.up-card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-3, 8px);
}
.up-card h2 {
  margin: 0;
  font-size: var(--text-xl);
}
.up-note {
  margin: 0;
  color: var(--text-muted);
}
.up-ok {
  margin: 0;
}
.up-warn {
  margin: 0;
  color: var(--st-degraded, inherit);
}
.up-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--space-3);
}
.up-field {
  display: grid;
  gap: var(--space-2);
}
.up-label {
  font-weight: 600;
}
.up-input {
  min-width: 14rem;
}
.up-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.up-mods {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.up-mods li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.up-mod-name {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
</style>
