<template>
  <section class="panel" aria-labelledby="an-players-h" :aria-busy="listLoading ? 'true' : undefined">
    <div class="p-head">
      <h2 id="an-players-h">
        {{ t("analytics.players") }}
        <span v-if="list" class="h-meta">{{ coverage }}</span>
      </h2>
      <div class="controls">
        <SelectButton
          v-model="status"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          size="small"
          :aria-label="t('analytics.playersFilter')"
          @update:modelValue="onStatus"
        />
        <span v-if="status === 'quiet'" class="quiet-pick">
          <label :for="quietId" class="sr-only">{{ t("players.quiet.label") }}</label>
          <Select
            v-model="quietDays"
            :inputId="quietId"
            :options="quietOptions"
            optionLabel="label"
            optionValue="value"
            size="small"
            @change="refilter(serverId)"
          />
        </span>
      </div>
    </div>

    <InlineError
      v-if="listFailure"
      :title="failureText.title"
      :recovery="failureText.recovery"
      :detail="failureText.detail"
      :retryable="failureText.retryable"
      :retry-label="failureText.retryLabel"
      :busy="listLoading"
      :heading-level="3"
      @retry="retry"
    />
    <p v-else-if="!listLoaded" class="note" role="status">{{ t("players.loading") }}</p>
    <template v-else-if="list && list.players.length">
      <ResponsiveTable
        :columns="columns"
        :rows="list.players"
        :caption="t('players.caption', { server: serverId })"
        :row-key="(p: PlayerRow) => p.name"
        :busy="() => listLoading"
      >
        <template #cell-name="{ row }">
          <button type="button" class="link-btn" @click="emit('open-player', row.name)">
            <StatusChip v-if="row.online" state="online" variant="dot" :label="t('players.onlineNow')" />
            {{ row.name }}
          </button>
        </template>
        <template #cell-playtimeMs="{ row }">{{ formatSpan(row.playtimeMs) }}</template>
        <template #cell-lastSeen="{ row }">
          <span v-if="row.online" class="dim">{{ t("players.onlineNow") }}</span>
          <span v-else-if="row.lastSeen" class="dim" :title="timestampTitle(row.lastSeen)">{{ relativeAge(row.lastSeen) }}</span>
          <span v-else class="dim">{{ t("players.notRecorded") }}</span>
        </template>
        <template #cell-firstSeen="{ row }">
          <span v-if="row.firstSeen" class="dim" :title="timestampTitle(row.firstSeen)">{{ relativeAge(row.firstSeen) }}</span>
          <span v-else class="dim">{{ t("players.notRecorded") }}</span>
        </template>
      </ResponsiveTable>
      <div class="more">
        <Button
          class="tap"
          icon="pi pi-users"
          :label="list.total > list.players.length ? t('analytics.playersAll', { count: list.total }) : t('analytics.playersOpen')"
          size="small"
          severity="secondary"
          text
          @click="emit('open-all')"
        />
      </div>
    </template>
    <p v-else class="note">{{ emptyText }}</p>
    <p v-if="list" class="note section-note">{{ t("players.history", { days: list.historyDays }) }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, useId, watch } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import type { PlayerRow, PlayerStatusFilter } from "@mcbot/schema";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import StatusChip from "../ui/StatusChip.vue";
import InlineError from "../ui/InlineError.vue";
import ResponsiveTable from "../ui/ResponsiveTable.vue";
import type { ResponsiveColumn } from "../ui/types";
import { usePlayers, QUIET_DAY_CHOICES } from "../../composables/usePlayers";
import { coverageLabel, formatHours } from "../../composables/useAnalytics";
import { failureCopy, signIn } from "../../utils/loadFailure";
import { relativeAge, timestampTitle } from "../../utils/time";
import { t } from "../../i18n";

/**
 * Who is still around and who stopped coming: the top of the player list for
 * the Analytics range, filtered to active, gone-quiet or new players. The
 * full searchable list lives on the Players page.
 */
const props = defineProps<{ serverId: string; rangeHours: number }>();
const emit = defineEmits<{ "open-player": [name: string]; "open-all": [] }>();

const {
  status, quietDays, hours, sort, order, list, listLoading, listLoaded, listFailure,
  loadList, refilter, reset,
} = usePlayers();

const quietId = useId();
const quietOptions = QUIET_DAY_CHOICES.map((d) => ({ value: d, label: t("players.quiet.days", { count: d }) }));
const statusOptions = computed<Array<{ value: PlayerStatusFilter; label: string }>>(() => [
  { value: "all", label: t("analytics.playersActiveFilter") },
  { value: "quiet", label: t("players.status.quiet") },
  { value: "new", label: t("players.status.new") },
]);

const columns = computed<ResponsiveColumn[]>(() => [
  { key: "name", label: t("players.col.player"), primary: true },
  { key: "playtimeMs", label: t("players.col.playtime"), numeric: true },
  { key: "sessions", label: t("players.col.sessions"), numeric: true },
  { key: "lastSeen", label: t("players.col.lastSeen") },
  { key: "firstSeen", label: t("players.col.firstSeen") },
]);

const coverage = computed(() =>
  status.value === "quiet"
    ? t("analytics.playersQuietCover", { count: quietDays.value })
    : coverageLabel(props.rangeHours, list.value?.rangeHours ?? null),
);

const emptyText = computed(() => {
  if (status.value === "quiet") return t("players.empty.quiet", { days: quietDays.value });
  if (status.value === "new") return t("players.empty.new", { range: formatHours(props.rangeHours) });
  return t("players.empty.all", { range: formatHours(props.rangeHours) });
});

const failureText = computed(() =>
  failureCopy(listFailure.value?.kind ?? "failed", {
    failedTitle: t("analytics.playersFailedTitle"),
    failedText: t("analytics.sectionFailedText"),
    forbiddenTitle: t("players.forbiddenTitle", { server: props.serverId }),
    capability: "server:read",
    request: `GET /api/servers/${props.serverId}/players`,
    error: listFailure.value?.error ?? "",
  }),
);

/** Each filter has the order that answers its question. */
function onStatus(): void {
  if (status.value === "quiet") {
    sort.value = "lastSeen";
    order.value = -1;
  } else if (status.value === "new") {
    sort.value = "firstSeen";
    order.value = -1;
  } else {
    sort.value = "playtimeMs";
    order.value = -1;
  }
  void refilter(props.serverId);
}

function retry(): void {
  if (listFailure.value?.kind === "signedOut") signIn();
  else void loadList(props.serverId);
}

watch(
  () => [props.serverId, props.rangeHours] as const,
  ([server, range], prev) => {
    if (!server) return;
    if (prev && prev[0] !== server) reset();
    hours.value = range;
    void refilter(server);
  },
  { immediate: true },
);
</script>

<style scoped>
.panel {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.panel h2 { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.p-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-3); }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.h-meta { margin-left: var(--space-2); color: var(--text-dim); font-size: var(--text-sm); font-weight: 400; }
.section-note { margin-top: var(--space-3); }
.dim { font-size: var(--text-sm); }
.more { margin-top: var(--space-2); }
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  text-align: start;
}
.link-btn:hover { text-decoration: underline; }
@media (pointer: coarse), (max-width: 760px) {
  .controls :deep(.p-togglebutton) { min-height: var(--touch-min); }
}
</style>
