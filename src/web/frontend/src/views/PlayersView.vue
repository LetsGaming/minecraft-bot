<template>
  <div class="players-view">
    <ViewHeader
      :title="t('players.title')"
      :subtitle="activeServer ? t('players.lede', { server: activeServer }) : ''"
    />

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server" :title="t('players.noServersTitle')">
      {{ t("players.noServers") }}
    </EmptyState>

    <!-- One player -->
    <div v-else-if="player" class="stack-gap">
      <div>
        <Button
          class="tap"
          icon="pi pi-arrow-left"
          :label="t('players.back')"
          size="small"
          severity="secondary"
          text
          @click="closePlayer"
        />
      </div>

      <p v-if="detailLoading && !detail" class="note" role="status">{{ t("players.detail.loading", { name: player }) }}</p>

      <InlineError
        v-else-if="detailFailure && detailFailure.notFound"
        :title="t('players.detail.notFoundTitle', { name: player })"
        :recovery="t('players.detail.notFoundText', { server: activeServer })"
        detail=""
        :retryable="false"
        retry-label=""
      />
      <InlineError
        v-else-if="detailFailure"
        :title="detailCopy.title"
        :recovery="detailCopy.recovery"
        :detail="detailCopy.detail"
        :retryable="detailCopy.retryable"
        :retry-label="detailCopy.retryLabel"
        @retry="retry(detailFailure.kind, reloadDetail)"
      />

      <template v-else-if="detail">
        <section class="panel identity" aria-labelledby="pl-name-h">
          <img
            class="head"
            :src="headUrl"
            alt=""
            width="64"
            height="64"
            @error="headFailed = true"
            v-show="!headFailed"
          />
          <div class="id-text">
            <h2 id="pl-name-h">
              {{ detail.name }}
              <StatusChip v-if="detail.activity.online" state="online" variant="dot" :label="t('players.onlineNow')" />
            </h2>
            <p class="note mono" v-if="detail.uuid">{{ detail.uuid }}</p>
          </div>
        </section>

        <section class="panel" aria-labelledby="pl-activity-h">
          <h2 id="pl-activity-h">{{ t("players.activity") }}</h2>
          <dl class="tiles">
            <div class="tile">
              <dt>{{ t("players.tile.playtime") }}</dt>
              <dd>{{ formatSpan(detail.activity.playtimeMs) }}</dd>
            </div>
            <div class="tile">
              <dt>{{ t("players.tile.sessions") }}</dt>
              <dd>{{ detail.activity.sessions }}</dd>
            </div>
            <div class="tile">
              <dt>{{ t("players.tile.longest") }}</dt>
              <dd>{{ formatSpan(detail.activity.longestSessionMs) }}</dd>
            </div>
            <div class="tile">
              <dt>{{ t("players.tile.firstSeen") }}</dt>
              <dd :title="detail.activity.firstSeen ? timestampTitle(detail.activity.firstSeen) : undefined">
                {{ detail.activity.firstSeen ? relativeAge(detail.activity.firstSeen) : t("players.notRecorded") }}
              </dd>
            </div>
            <div class="tile">
              <dt>{{ t("players.tile.lastSeen") }}</dt>
              <dd :title="detail.activity.lastSeen ? timestampTitle(detail.activity.lastSeen) : undefined">
                <template v-if="detail.activity.online">{{ t("players.onlineNow") }}</template>
                <template v-else>{{ detail.activity.lastSeen ? relativeAge(detail.activity.lastSeen) : t("players.notRecorded") }}</template>
              </dd>
            </div>
          </dl>
          <p class="note">{{ t("players.history", { days: detail.activity.historyDays }) }}</p>
        </section>

        <section class="panel" aria-labelledby="pl-daily-h">
          <h2 id="pl-daily-h">{{ t("players.daily") }}</h2>
          <div v-if="dailyBars.length" class="days" role="img" :aria-label="t('players.dailyLabel', { count: dailyBars.filter((b) => b.playtimeMs > 0).length })">
            <div
              v-for="bar in dailyBars"
              :key="bar.day"
              class="day"
              :data-played="bar.playtimeMs > 0 ? '' : undefined"
              :style="{ height: `${bar.height}%` }"
              :title="t('players.dayTitle', { day: bar.label, time: formatSpan(bar.playtimeMs) })"
            />
          </div>
          <p v-else class="note">{{ t("players.dailyEmpty") }}</p>
        </section>

        <section class="panel" aria-labelledby="pl-recent-h">
          <h2 id="pl-recent-h">{{ t("players.recent") }}</h2>
          <ResponsiveTable
            v-if="detail.activity.recentSessions.length"
            :columns="sessionColumns"
            :rows="detail.activity.recentSessions"
            :caption="t('players.recentCaption', { name: detail.name })"
            :row-key="(s: PlayerSessionDto) => s.joinedAt"
          >
            <template #cell-joinedAt="{ row }">
              <span :title="timestampTitle(row.joinedAt)">{{ absoluteStamp(row.joinedAt) }}</span>
            </template>
            <template #cell-duration="{ row }">
              <span v-if="row.leftAt === null" class="dim">{{ t("players.stillOnline") }}</span>
              <template v-else>{{ formatSpan(row.leftAt - row.joinedAt) }}</template>
            </template>
          </ResponsiveTable>
          <p v-else class="note">{{ t("players.recentEmpty") }}</p>
        </section>

        <section class="panel" aria-labelledby="pl-stats-h">
          <h2 id="pl-stats-h">{{ t("players.stats") }}</h2>
          <dl v-if="detail.stats" class="tiles">
            <div v-for="stat in detail.stats" :key="stat.key" class="tile">
              <dt>{{ stat.label }}</dt>
              <dd>{{ stat.formatted }}</dd>
            </div>
          </dl>
          <p v-else class="note">{{ t("players.statsUnavailable") }}</p>
        </section>

        <InlineBanner v-if="!detail.sensitiveAccess" tone="info" :title="t('players.locked.title')">
          {{ t("players.locked.text") }}
        </InlineBanner>

        <template v-else-if="detail.sensitive">
          <section class="panel" aria-labelledby="pl-link-h">
            <h2 id="pl-link-h">{{ t("players.link") }}</h2>
            <p v-if="detail.sensitive.link" class="line">
              <strong>{{ detail.sensitive.link.displayName ?? t("players.link.unknown") }}</strong>
              <span class="mono dim">{{ detail.sensitive.link.discordId }}</span>
            </p>
            <p v-else class="note">{{ t("players.link.none") }}</p>
            <p v-if="detail.sensitive.streak" class="line">
              {{ t("players.streak", { current: detail.sensitive.streak.current, longest: detail.sensitive.streak.longest }) }}
            </p>
          </section>

          <section class="panel" aria-labelledby="pl-wl-h">
            <h2 id="pl-wl-h">{{ t("players.whitelist") }}</h2>
            <template v-if="detail.sensitive.whitelist">
              <p v-if="detail.sensitive.whitelist.addedBy" class="line">
                {{ t("players.whitelist.added", { by: detail.sensitive.whitelist.addedBy, at: detail.sensitive.whitelist.addedAt ?? t("players.notRecorded") }) }}
              </p>
              <p v-if="detail.sensitive.whitelist.removedBy" class="line">
                {{ t("players.whitelist.removed", { by: detail.sensitive.whitelist.removedBy, at: detail.sensitive.whitelist.removedAt ?? t("players.notRecorded") }) }}
              </p>
            </template>
            <p v-else class="note">{{ t("players.whitelist.none") }}</p>

            <h3 class="sub">{{ t("players.applications") }}</h3>
            <ul v-if="detail.sensitive.applications.length" class="plain">
              <li v-for="app in detail.sensitive.applications" :key="app.id">
                <strong>{{ t(app.status === "approved" ? "players.application.approved" : "players.application.denied") }}</strong>
                <span class="dim">
                  {{ t("players.application.by", { applicant: app.userTag, by: app.decidedBy ?? t("players.notRecorded") }) }}
                  <template v-if="app.decidedAt"> · {{ absoluteStamp(app.decidedAt) }}</template>
                </span>
                <span v-if="app.note" class="quote">{{ app.note }}</span>
              </li>
            </ul>
            <p v-else class="note">{{ t("players.applications.none") }}</p>
          </section>

          <section class="panel" aria-labelledby="pl-mod-h">
            <h2 id="pl-mod-h">{{ t("players.moderation") }}</h2>
            <p v-if="detail.sensitive.tempBan" class="line warn">
              {{ t("players.tempBan", { until: absoluteStamp(detail.sensitive.tempBan.expiresAt), by: detail.sensitive.tempBan.by, reason: detail.sensitive.tempBan.reason }) }}
            </p>
            <ul v-if="detail.sensitive.notes.length" class="plain">
              <li v-for="(note, i) in detail.sensitive.notes" :key="i">
                <span class="dim">{{ note.createdAt }} · {{ note.author }}</span>
                <span class="quote">{{ note.text }}</span>
              </li>
            </ul>
            <p v-else class="note">{{ t("players.notes.none") }}</p>
          </section>
        </template>
      </template>
    </div>

    <!-- The list -->
    <div v-else class="stack-gap">
      <div class="toolbar">
        <span class="field grow">
          <label :for="searchId" class="ctl-label">{{ t("players.search.label") }}</label>
          <InputText
            :id="searchId"
            v-model="q"
            type="search"
            class="search"
            :placeholder="t('players.search.placeholder')"
            autocomplete="off"
            @input="onQueryInput(activeServer)"
          />
        </span>
        <span class="field">
          <span :id="statusLabelId" class="ctl-label">{{ t("players.status.label") }}</span>
          <SelectButton
            v-model="status"
            :options="statusOptions"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
            size="small"
            :aria-labelledby="statusLabelId"
            @update:modelValue="onStatus"
          />
        </span>
      </div>

      <div class="toolbar">
        <span v-if="status === 'quiet'" class="field">
          <label :for="quietId" class="ctl-label">{{ t("players.quiet.label") }}</label>
          <Select
            v-model="quietDays"
            :inputId="quietId"
            :options="quietOptions"
            optionLabel="label"
            optionValue="value"
            size="small"
            @change="refilter(activeServer)"
          />
        </span>
        <span v-else class="field">
          <label :for="rangeId" class="ctl-label">{{ t("players.range.label") }}</label>
          <Select
            v-model="hours"
            :inputId="rangeId"
            :options="rangeOptions"
            optionLabel="label"
            optionValue="value"
            size="small"
            @change="refilter(activeServer)"
          />
        </span>
        <span class="field">
          <label :for="sortId" class="ctl-label">{{ t("ui.sort.label") }}</label>
          <Select
            v-model="sort"
            :inputId="sortId"
            :options="sortOptions"
            optionLabel="label"
            optionValue="value"
            size="small"
            @change="refilter(activeServer)"
          />
          <Button
            class="tap"
            :icon="order === 1 ? 'pi pi-sort-amount-up-alt' : 'pi pi-sort-amount-down'"
            :label="order === 1 ? t('ui.sort.ascending') : t('ui.sort.descending')"
            :aria-label="t('ui.sort.orderLabel', { order: order === 1 ? t('ui.sort.ascending') : t('ui.sort.descending') })"
            severity="secondary"
            outlined
            size="small"
            @click="toggleOrder"
          />
        </span>
      </div>

      <InlineError
        v-if="listFailure"
        :title="listCopy.title"
        :recovery="listCopy.recovery"
        :detail="listCopy.detail"
        :retryable="listCopy.retryable"
        :retry-label="listCopy.retryLabel"
        :busy="listLoading"
        @retry="retry(listFailure.kind, reloadList)"
      />

      <section v-else class="panel" aria-labelledby="pl-list-h" :aria-busy="listLoading ? 'true' : undefined">
        <h2 id="pl-list-h">
          {{ t("players.list") }}
          <span v-if="list" class="h-meta">{{ t("players.matching", { count: list.total }) }}</span>
        </h2>
        <p v-if="!listLoaded" class="note" role="status">{{ t("players.loading") }}</p>
        <template v-else-if="list && list.players.length">
          <ResponsiveTable
            :columns="columns"
            :rows="list.players"
            :caption="t('players.caption', { server: activeServer })"
            :row-key="(p: PlayerRow) => p.name"
            :busy="() => listLoading"
          >
            <template #cell-name="{ row }">
              <button type="button" class="link-btn" @click="openPlayer(row.name)">
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
          <div v-if="totalPages > 1" class="pager-row">
            <PagerNav
              :page="page"
              :pages="totalPages"
              :label="t('players.pages')"
              windowed
              numbered-labels
              :disabled="listLoading"
              @update:page="goToPage(activeServer, $event)"
            />
          </div>
        </template>
        <p v-else class="note">{{ emptyText }}</p>
        <p v-if="list" class="note section-note">{{ t("players.history", { days: list.historyDays }) }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import type { PlayerRow, PlayerSessionDto, PlayerSortField } from "@mcbot/schema";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineError from "../components/ui/InlineError.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import ResponsiveTable from "../components/ui/ResponsiveTable.vue";
import PagerNav from "../components/mods/PagerNav.vue";
import type { ResponsiveColumn } from "../components/ui/types";
import {
  playerHeadUrl,
  usePlayers,
  PLAYER_RANGE_HOURS,
  QUIET_DAY_CHOICES,
} from "../composables/usePlayers";
import { failureCopy, signIn, type LoadFailure } from "../utils/loadFailure";
import { relativeAge, timestampTitle, absoluteStamp } from "../utils/time";
import { formatHours } from "../composables/useAnalytics";
import { t } from "../i18n";

const props = defineProps<{
  serverIds: string[];
  activeServer: string;
  /** The open player, from the route. */
  player: string;
}>();
const emit = defineEmits<{
  "update-route": [patch: { params?: Record<string, string | undefined> }];
}>();

const {
  q, status, quietDays, hours, sort, order, page, totalPages,
  list, listLoading, listLoaded, listFailure,
  detail, detailLoading, detailFailure,
  loadList, refilter, applyStatusSort, onQueryInput, goToPage, loadDetail, closeDetail, reset,
} = usePlayers();

const searchId = useId();
const statusLabelId = useId();
const quietId = useId();
const rangeId = useId();
const sortId = useId();
const headFailed = ref(false);
const DAY_MS = 86_400_000;
const DAILY_DAYS = 90;

const statusOptions = computed(() => [
  { value: "all", label: t("players.status.all") },
  { value: "online", label: t("players.status.online") },
  { value: "quiet", label: t("players.status.quiet") },
  { value: "new", label: t("players.status.new") },
]);
const rangeOptions = PLAYER_RANGE_HOURS.map((h) => ({ value: h, label: formatHours(h) }));
const quietOptions = QUIET_DAY_CHOICES.map((d) => ({ value: d, label: t("players.quiet.days", { count: d }) }));
const sortOptions = computed<Array<{ value: PlayerSortField; label: string }>>(() => [
  { value: "playtimeMs", label: t("players.col.playtime") },
  { value: "lastSeen", label: t("players.col.lastSeen") },
  { value: "firstSeen", label: t("players.col.firstSeen") },
  { value: "sessions", label: t("players.col.sessions") },
  { value: "name", label: t("players.col.player") },
]);

const columns = computed<ResponsiveColumn[]>(() => [
  { key: "name", label: t("players.col.player"), primary: true },
  { key: "playtimeMs", label: t("players.col.playtime"), numeric: true },
  { key: "sessions", label: t("players.col.sessions"), numeric: true },
  { key: "lastSeen", label: t("players.col.lastSeen") },
  { key: "firstSeen", label: t("players.col.firstSeen") },
]);
const sessionColumns = computed<ResponsiveColumn[]>(() => [
  { key: "joinedAt", label: t("players.col.joined"), primary: true },
  { key: "duration", label: t("players.col.duration") },
]);

const headUrl = computed(() => (props.player ? playerHeadUrl(props.activeServer, props.player) : ""));

const emptyText = computed(() => {
  if (status.value === "quiet") return t("players.empty.quiet", { days: quietDays.value });
  if (status.value === "new") return t("players.empty.new", { range: formatHours(hours.value) });
  if (status.value === "online") return t("players.empty.online");
  if (q.value.trim()) return t("players.empty.search");
  return t("players.empty.all", { range: formatHours(hours.value) });
});

/** The last 90 UTC days, play or not, so a player with two days of play shows two bars in a long quiet row instead of two wide blocks. */
const dailyBars = computed(() => {
  const played = new Map((detail.value?.activity.daily ?? []).map((d) => [d.day, d.playtimeMs]));
  if (played.size === 0) return [];
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const days = Array.from({ length: DAILY_DAYS }, (_, i) => today - (DAILY_DAYS - 1 - i) * DAY_MS);
  const peak = Math.max(...days.map((d) => played.get(d) ?? 0));
  return days.map((day) => {
    const playtimeMs = played.get(day) ?? 0;
    return {
      day,
      playtimeMs,
      height: playtimeMs > 0 && peak > 0 ? Math.max(4, (playtimeMs / peak) * 100) : 1,
      label: new Date(day).toISOString().slice(0, 10),
    };
  });
});

const listCopy = computed(() =>
  failureCopy(listFailure.value?.kind ?? "failed", {
    failedTitle: t("players.failedTitle"),
    failedText: t("players.failedText"),
    forbiddenTitle: t("players.forbiddenTitle", { server: props.activeServer }),
    capability: "server:read",
    request: `GET /api/servers/${props.activeServer}/players`,
    error: listFailure.value?.error ?? "",
  }),
);
const detailCopy = computed(() =>
  failureCopy(detailFailure.value?.kind ?? "failed", {
    failedTitle: t("players.detail.failedTitle", { name: props.player }),
    failedText: t("players.failedText"),
    forbiddenTitle: t("players.forbiddenTitle", { server: props.activeServer }),
    capability: "server:read",
    request: `GET /api/servers/${props.activeServer}/players/${props.player}`,
    error: detailFailure.value?.error ?? "",
  }),
);

function onStatus(): void {
  applyStatusSort();
  void refilter(props.activeServer);
}

function toggleOrder(): void {
  order.value = order.value === 1 ? -1 : 1;
  void refilter(props.activeServer);
}

function openPlayer(name: string): void {
  emit("update-route", { params: { player: name } });
}

function closePlayer(): void {
  emit("update-route", { params: { player: undefined } });
}

function reloadList(): Promise<void> {
  return loadList(props.activeServer);
}

function reloadDetail(): Promise<void> {
  return loadDetail(props.activeServer, props.player);
}

function retry(kind: LoadFailure, again: () => Promise<void>): void {
  if (kind === "signedOut") signIn();
  else void again();
}

let shownServer = "";
watch(
  () => [props.activeServer, props.player] as const,
  ([server, name]) => {
    headFailed.value = false;
    if (server !== shownServer) {
      shownServer = server;
      reset();
    }
    if (!server) return;
    if (name) {
      void loadDetail(server, name);
    } else {
      closeDetail();
      if (!list.value && !listLoading.value) void loadList(server);
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.players-view { min-width: 0; }
.panel {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.panel h2 { margin: 0 0 var(--space-3); font-size: var(--text-lg); font-weight: 600; }
.sub { margin: var(--space-4) 0 var(--space-2); font-size: var(--text-base); font-weight: 600; }
.h-meta { margin-left: var(--space-2); color: var(--text-dim); font-size: var(--text-sm); font-weight: 400; }
.section-note { margin-top: var(--space-3); }
.dim { font-size: var(--text-sm); }

.toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3) var(--space-4); }
.field { display: inline-flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); }
.field.grow { flex: 1 1 240px; }
.field :deep(.p-button) { margin-top: var(--space-1); }
.ctl-label { color: var(--text-dim); font-size: var(--text-sm); }
.search { width: 100%; }

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
.pager-row { margin-top: var(--space-3); }

.identity { display: flex; align-items: center; gap: var(--space-4); }
.identity h2 { display: flex; align-items: center; gap: var(--space-3); margin: 0; }
.head { border-radius: var(--radius-control); image-rendering: pixelated; background: var(--surface-raised); }
.id-text { min-width: 0; }
.id-text .note { margin-top: var(--space-1); overflow-wrap: anywhere; }

.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-3); margin: 0; }
.tile { margin: 0; padding: var(--space-3); border-radius: var(--radius-control); background: var(--surface-raised); }
.tile dt { color: var(--text-dim); font-size: var(--text-xs); }
.tile dd { margin: var(--space-1) 0 0; font-size: var(--text-lg); font-weight: 600; font-variant-numeric: tabular-nums; }

.days { display: flex; align-items: flex-end; gap: 1px; height: 90px; padding: var(--space-1) 0; }
.day { flex: 1; min-width: 2px; border-radius: 1px 1px 0 0; background: var(--accent); opacity: 0.85; }
.day:not([data-played]) { background: var(--border-strong); opacity: 0.5; }
.day:hover { opacity: 1; }

.line { margin: 0 0 var(--space-2); display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); }
.line.warn { color: var(--warn, var(--text)); }
.plain { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.plain li { display: flex; flex-direction: column; gap: 2px; }
.quote { overflow-wrap: anywhere; }

@media (pointer: coarse), (max-width: 760px) {
  .field :deep(.p-togglebutton) { min-height: var(--touch-min); }
}
</style>
