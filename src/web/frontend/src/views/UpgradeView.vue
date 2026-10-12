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
      <!-- A job is running, or the last one just ended. -->
      <section v-if="upgrade.job.value" class="up-card" :aria-labelledby="'up-run'">
        <div class="up-head">
          <h2 id="up-run">
            {{ t(runTitleKey, { server: activeServer, version: upgrade.job.value.mcVersion || resultTarget }) }}
          </h2>
          <StatusChip :state="runRole" :label="t(runChipKey)" :busy="upgrade.running.value" live />
        </div>

        <div
          v-if="upgrade.running.value"
          class="up-bar"
          role="progressbar"
          aria-valuemin="0"
          :aria-valuemax="UPGRADE_STEPS.length"
          :aria-valuenow="upgrade.stepsDone.value"
          :aria-label="t('upgrade.progressLabel')"
        >
          <span class="up-bar-fill" :style="{ width: `${(upgrade.stepsDone.value / UPGRADE_STEPS.length) * 100}%` }" />
        </div>

        <ol class="up-phases">
          <li v-for="row in upgrade.phases.value" :key="row.phase" :class="`is-${row.status}`">
            <i :class="phaseIcon(row.status)" aria-hidden="true" />
            <span class="up-phase-name">{{ phaseName(row.phase) }}</span>
            <span v-if="row.status === 'running' && row.msg" class="up-phase-msg">{{ row.msg }}</span>
          </li>
        </ol>

        <p v-if="upgrade.running.value" class="up-note">{{ t("upgrade.runningNote") }}</p>

        <template v-if="upgrade.finished.value">
          <ul class="up-result">
            <li v-for="(line, i) in resultLines" :key="i">{{ line }}</li>
          </ul>
          <Button
            class="tap"
            :label="t('upgrade.again')"
            icon="pi pi-refresh"
            severity="secondary"
            outlined
            @click="clearFinished"
          />
        </template>
      </section>

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
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { StatusRole } from "@mcbot/schema";
import { apiGet, apiSend } from "../api";
import type { ModCompatJob, ModCompatMod } from "../api";
import { useModCompat } from "../composables/useModCompat";
import { UPGRADE_STEPS, useServerUpgrade } from "../composables/useServerUpgrade";
import { useCapabilities } from "../composables/useCapabilities";
import { useConfirmAction } from "../composables/useConfirmAction";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import { t, type MessageKey } from "../i18n";
import type { UpgradeJob, UpgradeRequest, UpgradeStarted } from "@mcbot/schema/wire/index.js";

const props = defineProps<{ activeServer: string }>();

const KNOWN_PHASES = new Set(["plan", "countdown", "stop", "backup", "apply", "prune", "start", "mods", "rollback", "abort"]);
const KNOWN_REASONS = new Set([
  "plan_failed", "mods_changed", "stop_failed", "backup_failed", "apply_failed",
  "prune_failed", "crash_loop", "timeout", "start_failed", "rollback_failed",
]);

const { can } = useCapabilities();
const confirmAction = useConfirmAction();

const error = ref("");
const countdown = ref(30);

const server = computed(() => props.activeServer);
const base = (): string => `/api/servers/${encodeURIComponent(server.value)}`;

/** The compatibility check needs the mods:read the Mods page uses; without it the check is skipped. */
const canCheck = computed(() => can("mods:read", server.value));

const upgrade = useServerUpgrade({
  api: {
    support: () => apiGet<{ supported: boolean }>(`${base()}/upgrade/support`),
    start: (body: UpgradeRequest) => apiSend<UpgradeStarted>("POST", `${base()}/upgrade`, body),
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

const canStart = computed(
  () =>
    compat.targetValid.value &&
    !upgrade.running.value &&
    !upgrade.starting.value &&
    !compat.checkingCompat.value &&
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

function phaseName(phase: string): string {
  return KNOWN_PHASES.has(phase) ? t(`upgrade.phase.${phase}` as MessageKey) : phase;
}

function phaseIcon(statusName: string): string {
  if (statusName === "done") return "pi pi-check-circle";
  if (statusName === "error") return "pi pi-times-circle";
  return "pi pi-spin pi-spinner";
}

const resultTarget = computed(() => upgrade.result.value?.target ?? "");

const runTitleKey = computed<MessageKey>(() => {
  if (upgrade.running.value) return "upgrade.run.title";
  const r = upgrade.result.value;
  if (r?.ok) return "upgrade.run.titleDone";
  return r?.rolledBack ? "upgrade.run.titleRolledBack" : "upgrade.run.titleFailed";
});

const runRole = computed(() => {
  if (upgrade.running.value) return StatusRole.Info;
  const r = upgrade.result.value;
  if (r?.ok) return (r.disabled ?? []).length > 0 ? StatusRole.Degraded : StatusRole.Applied;
  return StatusRole.Offline;
});

const runChipKey = computed<MessageKey>(() => {
  if (upgrade.running.value) return "upgrade.chip.running";
  return upgrade.result.value?.ok ? "upgrade.chip.done" : "upgrade.chip.failed";
});

const resultLines = computed<string[]>(() => {
  const j = upgrade.job.value;
  const r = upgrade.result.value;
  if (!j || j.state === "running") return [];
  if (!r) return [t("upgrade.result.interrupted")];
  const lines: string[] = [];
  if (r.ok) {
    const disabled = r.disabled ?? [];
    lines.push(
      disabled.length > 0
        ? t("upgrade.result.disabled", { mods: disabled.join(", ") })
        : t("upgrade.result.clean"),
    );
    const kept = r.keptOnOldBuild ?? [];
    if (kept.length > 0) lines.push(t("upgrade.result.keptOld", { mods: kept.join(", ") }));
  } else if (r.rolledBack) {
    lines.push(r.previousVersionRunning === false ? t("upgrade.result.rolledBackDown") : t("upgrade.result.rolledBack"));
  } else if (r.reason === "rollback_failed") {
    lines.push(t("upgrade.result.rollbackFailed"));
  } else {
    const reason = r.reason && KNOWN_REASONS.has(r.reason)
      ? t(`upgrade.reason.${r.reason}` as MessageKey)
      : t("upgrade.reason.other");
    lines.push(t("upgrade.result.failedBefore", { reason }));
  }
  if (typeof r.archive === "string") lines.push(t("upgrade.result.archive", { file: r.archive }));
  return lines;
});

async function runCheck(): Promise<void> {
  error.value = "";
  await compat.check(false);
}

async function confirmStart(): Promise<void> {
  error.value = "";
  const name = server.value;
  const version = targetVersion.value;
  const answer = await confirmAction({
    level: "irreversible",
    tone: "danger",
    header: t("upgrade.confirm.header", { server: name, version }),
    message: t("upgrade.confirm.message", { server: name, version }),
    acceptLabel: t("upgrade.confirm.accept", { server: name }),
    expected: name,
    facts: [
      { term: t("upgrade.fact.steps"), detail: t("upgrade.fact.stepsDetail") },
      { term: t("upgrade.fact.fallback"), detail: t("upgrade.fact.fallbackDetail") },
      { term: t("upgrade.fact.downtime"), detail: t("upgrade.fact.downtimeDetail") },
      { term: t("upgrade.fact.recover"), detail: t("upgrade.fact.recoverDetail") },
    ],
  });
  if (answer !== "confirm") return;
  await upgrade.start({
    mcVersion: version,
    ...(canCheck.value ? { expectUnavailable: attention.value.map((m) => m.slug) } : {}),
    countdownSeconds: countdown.value,
  });
}

function clearFinished(): void {
  upgrade.reset();
  void load();
}

async function load(): Promise<void> {
  await upgrade.loadSupport();
  if (upgrade.supported.value) {
    await upgrade.attach();
    await loadInstalledVersion();
    if (canCheck.value) await compat.loadVersions();
  }
}

watch(server, () => {
  compat.reset();
  upgrade.reset();
  error.value = "";
  void load();
}, { immediate: true });

onBeforeUnmount(() => {
  compat.dispose();
  upgrade.dispose();
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
  background: var(--surface-1, transparent);
}
.up-card h2 {
  margin: 0;
  font-size: var(--text-xl);
}
.up-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
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
.up-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}
.up-bar-fill {
  display: block;
  height: 100%;
  background: var(--st-info, currentColor);
  transition: width 0.4s ease;
}
.up-phases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.up-phases li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}
.up-phases .is-done i {
  color: var(--st-applied, inherit);
}
.up-phases .is-error i {
  color: var(--st-offline, inherit);
}
.up-phase-msg {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.up-result {
  margin: 0;
  padding-left: var(--space-4);
  display: grid;
  gap: var(--space-2);
}
@media (prefers-reduced-motion: reduce) {
  .up-bar-fill {
    transition: none;
  }
}
</style>
