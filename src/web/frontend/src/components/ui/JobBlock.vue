<template>
  <section :class="['job-block', `job-${state}`]" :aria-labelledby="titleId" tabindex="-1">
    <div class="jb-head">
      <component :is="`h${headingLevel}`" :id="titleId" class="jb-title">{{ title }}</component>
      <StatusChip :state="ROLE[state]" :label="statusText" :busy="state === 'running'" live />
    </div>
    <div
      v-if="state === 'running' && progress && progress.total > 0"
      class="jb-bar"
      role="progressbar"
      :aria-labelledby="titleId"
      aria-valuemin="0"
      :aria-valuemax="progress.total"
      :aria-valuenow="Math.min(progress.done, progress.total)"
    >
      <span class="jb-bar-fill is-determinate" :style="{ width: `${percent}%` }" />
    </div>
    <div
      v-else-if="state === 'running'"
      class="jb-bar"
      role="progressbar"
      :aria-labelledby="titleId"
      :aria-valuetext="statusText"
    >
      <span class="jb-bar-fill" />
    </div>
    <pre
      v-if="output"
      class="jb-output"
      tabindex="0"
      :aria-label="outputLabel || COPY.output"
    >{{ output }}</pre>
    <div v-if="$slots.default" class="jb-note"><slot /></div>
    <div v-if="$slots.actions" class="jb-actions"><slot name="actions" /></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { StatusRole } from "@mcbot/schema";
import { formatDuration } from "@mcbot/core/utils/duration.js";
import StatusChip from "./StatusChip.vue";

type JobState = "running" | "done" | "failed";

const COPY = {
  running: "Running",
  done: "Finished",
  failed: "Failed",
  exitCode: "Exit code",
  output: "Script output",
} as const;

const ROLE: Record<JobState, StatusRole> = {
  running: StatusRole.Info,
  done: StatusRole.Applied,
  failed: StatusRole.Offline,
};

/**
 * One long operation: title, status, a bar while it runs and the output once
 * it ends. The bar is indeterminate unless the job reports `progress`, which
 * only jobs that count their work (the mod compatibility check) do; scripts
 * report neither steps nor a percentage.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    state: JobState;
    /** Epoch ms; shows the elapsed time while running. */
    startedAt?: number;
    exitCode?: number | null;
    output?: string;
    outputLabel?: string;
    /** Work done of total, for a job that counts it. */
    progress?: { done: number; total: number } | null;
    headingLevel?: 2 | 3 | 4;
  }>(),
  { startedAt: 0, exitCode: undefined, output: "", outputLabel: "", progress: null, headingLevel: 2 },
);

const percent = computed(() => {
  const p = props.progress;
  if (!p || p.total <= 0) return 0;
  return Math.round((Math.min(p.done, p.total) / p.total) * 100);
});

const titleId = `job-${useId()}`;
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

watch(
  () => props.state,
  (state) => {
    stopTimer();
    if (state === "running") {
      now.value = Date.now();
      timer = setInterval(() => (now.value = Date.now()), 1000);
    }
  },
  { immediate: true },
);
onBeforeUnmount(stopTimer);

const statusText = computed(() => {
  if (props.state === "running") {
    if (!props.startedAt) return COPY.running;
    const seconds = Math.max(0, Math.floor((now.value - props.startedAt) / 1000));
    return `${COPY.running}, ${formatDuration(seconds * 1000)}`;
  }
  if (props.exitCode !== undefined && props.exitCode !== null) {
    return `${COPY.exitCode} ${props.exitCode}`;
  }
  return props.state === "done" ? COPY.done : COPY.failed;
});
</script>

<style scoped>
.job-block {
  --job-edge: var(--st-info);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--job-edge);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.job-block:focus { outline: none; }
.job-block:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.job-done { --job-edge: var(--st-applied); }
.job-failed { --job-edge: var(--st-offline); }
.jb-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); }
.jb-title { margin: 0; font-size: var(--text-lg); font-weight: 600; overflow-wrap: anywhere; }
.jb-bar {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--surface-raised);
}
.jb-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 35%;
  border-radius: inherit;
  background: var(--st-info);
  animation: jb-slide 1.4s var(--ease-settle) infinite;
}
.jb-bar-fill.is-determinate {
  width: 0;
  animation: none;
  transition: width var(--dur-state) var(--ease-settle);
}
@keyframes jb-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(290%); }
}
@media (prefers-reduced-motion: reduce) {
  .jb-bar-fill:not(.is-determinate) { animation: none; width: 100%; opacity: 0.6; }
  .jb-bar-fill.is-determinate { transition: none; }
}
.jb-output {
  margin: 0;
  max-height: 18rem;
  overflow: auto;
  padding: var(--space-3);
  border-radius: var(--radius-control);
  background: var(--bg-code);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.jb-note { color: var(--text-dim); max-width: 64ch; }
.jb-note :deep(p) { margin: 0; }
.jb-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
