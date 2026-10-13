<template>
  <section class="up-run" aria-labelledby="up-run-title">
    <div class="ur-head">
      <h2 id="up-run-title">{{ title }}</h2>
      <StatusChip :state="role" :label="t(chipKey)" :busy="upgrade.running.value" live />
    </div>

    <div
      v-if="upgrade.running.value"
      class="ur-bar"
      role="progressbar"
      aria-valuemin="0"
      :aria-valuemax="steps"
      :aria-valuenow="upgrade.stepsDone.value"
      :aria-label="t('upgrade.progressLabel')"
    >
      <span class="ur-bar-fill" :style="{ width: `${(upgrade.stepsDone.value / steps) * 100}%` }" />
    </div>

    <ol class="ur-phases">
      <li v-for="row in upgrade.phases.value" :key="row.phase" :class="`is-${row.status}`">
        <i :class="phaseIcon(row.status)" aria-hidden="true" />
        <span>{{ phaseName(row.phase) }}</span>
        <span v-if="row.status === 'running' && row.msg" class="ur-msg">{{ row.msg }}</span>
      </li>
    </ol>

    <p v-if="upgrade.running.value" class="ur-note">{{ t("upgrade.runningNote") }}</p>

    <template v-if="upgrade.finished.value">
      <ul class="ur-result">
        <li v-for="(line, i) in resultLines" :key="i">{{ line }}</li>
      </ul>
      <Button class="tap" :label="t('upgrade.again')" icon="pi pi-refresh" severity="secondary" outlined @click="$emit('again')" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import { StatusRole, formatBytes } from "@mcbot/schema";
import { UPGRADE_STEPS, type useServerUpgrade } from "../composables/useServerUpgrade";
import StatusChip from "./ui/StatusChip.vue";
import { t, type MessageKey } from "../i18n";

const props = defineProps<{
  upgrade: ReturnType<typeof useServerUpgrade>;
  server: string;
}>();
defineEmits<{ again: [] }>();

const KNOWN_PHASES = new Set(["plan", "countdown", "stop", "backup", "apply", "prune", "start", "mods", "rollback", "abort"]);
const KNOWN_REASONS = new Set([
  "plan_failed", "mods_changed", "stop_failed", "backup_failed", "apply_failed",
  "prune_failed", "prune_stale", "crash_loop", "timeout", "start_failed", "rollback_failed",
]);

const prune = computed(() => props.upgrade.job.value?.kind === "prune");
/** A prune-only job has no install; its sixth step is the prune. */
const steps = computed(() => UPGRADE_STEPS.length);
const result = computed(() => props.upgrade.result.value);

const title = computed(() => {
  const j = props.upgrade.job.value;
  const version = j?.mcVersion || result.value?.target || "";
  const base = prune.value ? "prune.run" : "upgrade.run";
  if (props.upgrade.running.value) return t(`${base}.title` as MessageKey, { server: props.server, version });
  if (result.value?.ok) return t(`${base}.titleDone` as MessageKey, { server: props.server, version });
  return t(
    (result.value?.rolledBack ? `${base}.titleRolledBack` : `${base}.titleFailed`) as MessageKey,
    { server: props.server, version },
  );
});

const role = computed(() => {
  if (props.upgrade.running.value) return StatusRole.Info;
  const r = result.value;
  if (r?.ok) return (r.disabled ?? []).length > 0 ? StatusRole.Degraded : StatusRole.Applied;
  return StatusRole.Offline;
});

const chipKey = computed<MessageKey>(() => {
  if (props.upgrade.running.value) return "upgrade.chip.running";
  return result.value?.ok ? "upgrade.chip.done" : "upgrade.chip.failed";
});

function phaseName(phase: string): string {
  return KNOWN_PHASES.has(phase) ? t(`upgrade.phase.${phase}` as MessageKey) : phase;
}

function phaseIcon(status: string): string {
  if (status === "done") return "pi pi-check-circle";
  if (status === "error") return "pi pi-times-circle";
  return "pi pi-spin pi-spinner";
}

const resultLines = computed<string[]>(() => {
  const job = props.upgrade.job.value;
  const r = result.value;
  if (!job || job.state === "running") return [];
  if (!r) return [t("upgrade.result.interrupted")];
  const lines: string[] = [];
  if (r.ok) {
    const disabled = r.disabled ?? [];
    lines.push(
      disabled.length > 0
        ? t("upgrade.result.disabled", { mods: disabled.join(", ") })
        : t(prune.value ? "upgrade.result.prunedClean" : "upgrade.result.clean"),
    );
    const kept = r.keptOnOldBuild ?? [];
    if (kept.length > 0) lines.push(t("upgrade.result.keptOld", { mods: kept.join(", ") }));
  } else if (r.rolledBack) {
    lines.push(
      r.previousVersionRunning === false ? t("upgrade.result.rolledBackDown") : t("upgrade.result.rolledBack"),
    );
  } else if (r.reason === "rollback_failed") {
    lines.push(t("upgrade.result.rollbackFailed"));
  } else {
    const reason =
      r.reason && KNOWN_REASONS.has(r.reason)
        ? t(`upgrade.reason.${r.reason}` as MessageKey)
        : t("upgrade.reason.other");
    lines.push(t("upgrade.result.failedBefore", { reason }));
  }
  if (typeof r.prunedChunks === "number") {
    lines.push(t("upgrade.result.pruned", { chunks: r.prunedChunks, size: formatBytes(r.bytesFreed ?? 0) }));
  }
  if (typeof r.archive === "string") lines.push(t("upgrade.result.archive", { file: r.archive }));
  return lines;
});
</script>

<style scoped>
.up-run {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-3, 8px);
}
.ur-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.ur-head h2 {
  margin: 0;
  font-size: var(--text-xl);
}
.ur-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}
.ur-bar-fill {
  display: block;
  height: 100%;
  background: var(--st-info, currentColor);
  transition: width 0.4s ease;
}
.ur-phases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.ur-phases li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}
.ur-phases .is-done i {
  color: var(--st-applied, inherit);
}
.ur-phases .is-error i {
  color: var(--st-offline, inherit);
}
.ur-msg,
.ur-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.ur-result {
  margin: 0;
  padding-left: var(--space-4);
  display: grid;
  gap: var(--space-2);
}
@media (prefers-reduced-motion: reduce) {
  .ur-bar-fill {
    transition: none;
  }
}
</style>
