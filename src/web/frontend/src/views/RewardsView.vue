<template>
  <div class="rewards-view">
    <ViewHeader :title="t('rewards.title')" :subtitle="t('rewards.lede')" />

    <EmptyState v-if="scopes.length === 0" icon="pi pi-gift">
      {{ t("rewards.noScopes") }}
    </EmptyState>

    <template v-else>
      <div class="rw-scope">
        <span id="rw-scope-label" class="rw-scope-label">{{ t("rewards.scopeLabel") }}</span>
        <SelectButton
          v-if="scopes.length <= MAX_SEGMENTED"
          :model-value="scope || SHARED"
          :options="scopes"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          aria-labelledby="rw-scope-label"
          @update:model-value="onScopePick"
        />
        <Select
          v-else
          :model-value="scope || SHARED"
          :options="scopes"
          option-label="label"
          option-value="value"
          aria-labelledby="rw-scope-label"
          class="rw-scope-select"
          @update:model-value="onScopePick"
        />
        <p class="rw-hint">{{ isShared ? t("rewards.scopeSharedHint") : t("rewards.scopeServerHint") }}</p>
      </div>

      <p v-if="loading && !ready" class="rw-hint" role="status">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("rewards.loading") }}
      </p>

      <InlineError
        v-else-if="!ready"
        :title="t('rewards.loadFailed')"
        :detail="loadError"
        :busy="loading"
        :heading-level="2"
        @retry="reload"
      />

      <EditorShell v-else :state="editorState" :readonly-reason="t('rewards.readonlyAccess')">
        <template #banners>
          <InlineBanner v-if="problems.length" tone="warn" :title="t('rewards.problemsTitle', { count: problems.length })">
            <p class="rw-banner-text">{{ t("rewards.problemsText") }}</p>
            <ul class="rw-list">
              <li v-for="(line, i) in problems" :key="i" class="mono">{{ line }}</li>
            </ul>
          </InlineBanner>
          <InlineBanner v-if="saveFailure.length" tone="danger" :title="t('rewards.saveFailedTitle')">
            <ul class="rw-list">
              <li v-for="(line, i) in saveFailure" :key="i">{{ line }}</li>
            </ul>
          </InlineBanner>
          <InlineBanner v-if="dirty && poolProblems.length" tone="warn" :title="t('rewards.invalidTitle')">
            <ul class="rw-list">
              <li v-for="(line, i) in poolProblems" :key="i">{{ line }}</li>
            </ul>
          </InlineBanner>
        </template>

        <template #conflict>
          <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
        </template>
        <template #conflict-actions>
          <Button
            class="tap"
            :label="t('rewards.dropMine')"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            outlined
            @click="reloadDiscardingMine"
          />
        </template>

        <template #bar>
          <EditBar
            :state="editorState"
            :change-count="editCount"
            :conflict-count="conflicts.length"
            :can-save="!stale && poolProblems.length === 0"
            :save-hint="summaryText"
            reviewable
            @save="onSave"
            @discard="discardAll"
            @review="reviewOpen = true"
          >
            <template v-if="isShared && meta?.shipped" #extra>
              <Button
                class="tap"
                :label="t('rewards.useShipped')"
                icon="pi pi-replay"
                size="small"
                severity="secondary"
                outlined
                :disabled="editorState === 'saving'"
                @click="askShipped"
              />
            </template>
          </EditBar>
        </template>

        <template #default>
          <div class="rw-body">
            <OutcomeStrip />

            <TabList
              :tabs="tabs"
              :model-value="tab"
              :label="t('rewards.tabsLabel')"
              id-prefix="rw"
              panel-id="rw-panel"
              @select="tab = $event as RewardsTab"
            />

            <div id="rw-panel" role="tabpanel" :aria-labelledby="`rw-tab-${tab}`" class="rw-panel">
              <section v-if="tab === 'pool'" class="rw-section">
                <header class="rw-head">
                  <p class="rw-hint">{{ t("rewards.pool.lede") }}</p>
                  <Button
                    v-if="editable && !isShared && overrides('default')"
                    class="tap"
                    icon="pi pi-undo"
                    :label="t('rewards.resetPool')"
                    severity="secondary"
                    outlined
                    size="small"
                    @click="rewards.resetField('default')"
                  />
                </header>
                <PoolTable />
              </section>

              <section v-else-if="tab === 'streaks'" class="rw-section">
                <header class="rw-head">
                  <p class="rw-hint">{{ t("rewards.streak.lede", { cycle: trackLength }) }}</p>
                  <Button
                    v-if="editable && !isShared && overrides('streakBonuses')"
                    class="tap"
                    icon="pi pi-undo"
                    :label="t('rewards.resetStreaks')"
                    severity="secondary"
                    outlined
                    size="small"
                    @click="rewards.resetField('streakBonuses')"
                  />
                </header>
                <div class="rw-streaks" :class="{ 'has-day': selectedDay !== null }">
                  <StreakTimeline :selected="selectedDay" @select="selectedDay = $event" />
                  <DayPanel :selected="selectedDay" @close="selectedDay = null" @select="selectedDay = $event" />
                </div>
              </section>

              <section v-else class="rw-section">
                <p class="rw-hint">{{ t("rewards.bonus.lede") }}</p>
                <BonusPanel />
              </section>
            </div>
          </div>
        </template>
      </EditorShell>

      <ReviewChanges v-model:visible="reviewOpen" :changes="reviewItems" :can-save="editorState === 'dirty' && poolProblems.length === 0" @save="onReviewSave" />
      <SharedImpactDialog
        v-model:visible="impactOpen"
        :servers="impact"
        :catalog="catalog"
        :saving="saving"
        @confirm="onImpactConfirm"
      />
      <UndoBar
        :token="undoToken"
        :message="undoMessage"
        :action-label="t('rewards.undo.action')"
        @undo="rewards.undo()"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { useConfirm } from "primevue/useconfirm";
import { useNotify } from "../composables/useNotify";
import type { ServerImpact, ServerSelection, SharedChange } from "@mcbot/schema/dailyRewards.js";
import { useDailyRewards } from "../composables/useDailyRewards";
import { REWARDS_CONTEXT } from "../composables/rewardsContext";
import { useCapabilities } from "../composables/useCapabilities";
import { confirmLeave } from "../composables/useUnsavedGuard";
import { discardPrompt } from "../composables/useDiscardPrompt";
import { loadItemCatalog, type ItemCatalog } from "../utils/minecraftItems";
import { itemName, stackText } from "../utils/rewardDisplay";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import EditorShell from "../components/ui/EditorShell.vue";
import EditBar from "../components/ui/EditBar.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import InlineError from "../components/ui/InlineError.vue";
import ReviewChanges, { type ReviewItem } from "../components/ui/ReviewChanges.vue";
import TabList, { type TabItem } from "../components/ui/TabList.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import OutcomeStrip from "../components/rewards/OutcomeStrip.vue";
import PoolTable from "../components/rewards/PoolTable.vue";
import StreakTimeline from "../components/rewards/StreakTimeline.vue";
import DayPanel from "../components/rewards/DayPanel.vue";
import BonusPanel from "../components/rewards/BonusPanel.vue";
import SharedImpactDialog from "../components/rewards/SharedImpactDialog.vue";
import UndoBar from "../components/rewards/UndoBar.vue";
import type { EditorState } from "../components/ui/types";
import { t, type MessageKey } from "../i18n";

/** The scope picker's value for the shared pool (a Select treats "" as nothing picked). */
const SHARED = "\u0000shared";
/** Up to this many scopes sit side by side; more become a dropdown. */
const MAX_SEGMENTED = 4;
const TAB_KEY = "mcbot.rewards.tab";

type RewardsTab = "pool" | "streaks" | "bonus";
const TABS: readonly RewardsTab[] = ["pool", "streaks", "bonus"];

const props = withDefaults(
  defineProps<{
    serverIds?: string[];
    /** The server the URL names; empty is the shared pool. */
    server?: string;
  }>(),
  { serverIds: () => [], server: "" },
);
const emit = defineEmits<{
  "update-route": [patch: { params?: Record<string, string | undefined> }];
}>();

const rewards = useDailyRewards();
const {
  meta,
  ready,
  loading,
  loadError,
  saving,
  saveError,
  fieldErrors,
  conflicts,
  dirty,
  dirtyKeys,
  stale,
  discard,
  save,
  resolveConflict,
  reloadDiscardingMine,
  scope,
  isShared,
  open,
  overrides,
  poolProblems,
  summary,
  entryChanges,
  trackLength,
  undoToken,
  lastUndo,
} = rewards;
const { can, serversWith } = useCapabilities();
const ask = discardPrompt(useConfirm());
const confirm = useConfirm();
const notify = useNotify();

const catalog = ref<ItemCatalog | null>(null);
const mode = ref<"percent" | "weight">("percent");
const selectedDay = ref<string | null>(null);
const reviewOpen = ref(false);
const impactOpen = ref(false);
const impact = ref<ServerImpact[]>([]);

function storedTab(): RewardsTab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return TABS.includes(value as RewardsTab) ? (value as RewardsTab) : "pool";
  } catch {
    return "pool";
  }
}
const tab = ref<RewardsTab>(storedTab());
watch(tab, (value) => {
  try {
    localStorage.setItem(TAB_KEY, value);
  } catch {
    // A remembered tab is a convenience; the editor works without it.
  }
});

const tabs = computed<TabItem[]>(() => [
  { id: "pool", label: t("rewards.tab.pool") },
  { id: "streaks", label: t("rewards.tab.streaks") },
  { id: "bonus", label: t("rewards.tab.bonus") },
]);

const canReadShared = computed(() => can("config:read"));
const scopes = computed(() => {
  const out: Array<{ label: string; value: string }> = [];
  if (canReadShared.value) out.push({ label: t("rewards.scopeShared"), value: SHARED });
  for (const id of serversWith("config:read", props.serverIds)) {
    out.push({ label: t("rewards.scopeServer", { server: id }), value: id });
  }
  return out;
});
const editable = computed(() => (isShared.value ? can("config:write") : can("config:write", scope.value)));
const editorState = computed<EditorState>(() => {
  if (!editable.value) return "readonly";
  if (saving.value) return "saving";
  if (conflicts.value.length > 0) return "conflict";
  if (dirty.value) return "dirty";
  return "clean";
});
const problems = computed<string[]>(() => [
  ...(meta.value?.problems ?? []),
  ...(isShared.value ? [] : (meta.value?.sharedProblems ?? []).map((p) => t("rewards.sharedProblem", { problem: p }))),
]);
const saveFailure = computed<string[]>(() => {
  if (conflicts.value.length > 0) return [];
  return [...(saveError.value ? [saveError.value] : []), ...fieldErrors.value];
});

/** Edits as the admin counts them (an item, a day), never fewer than the fields touched. */
const editCount = computed(() => {
  const s = summary.value;
  if (!s) return 0;
  const edits =
    s.items.added + s.items.removed + s.items.changed +
    s.dayItems.added + s.dayItems.removed + s.dayItems.changed +
    s.daysAdded + s.daysRemoved + (s.bonusChanged ? 1 : 0);
  return dirty.value ? Math.max(edits, dirtyKeys.value.length) : 0;
});

const summaryText = computed(() => {
  const s = summary.value;
  if (!s || !dirty.value) return t("rewards.saveHint");
  const added = s.items.added + s.dayItems.added;
  const removed = s.items.removed + s.dayItems.removed;
  const changed = s.items.changed + s.dayItems.changed;
  const parts: string[] = [];
  if (added) parts.push(t("rewards.summary.added", { count: added }));
  if (removed) parts.push(t("rewards.summary.removed", { count: removed }));
  if (changed) parts.push(t("rewards.summary.changed", { count: changed }));
  if (s.daysAdded) parts.push(t("rewards.summary.daysAdded", { count: s.daysAdded }));
  if (s.daysRemoved) parts.push(t("rewards.summary.daysRemoved", { count: s.daysRemoved }));
  if (s.bonusChanged) parts.push(t("rewards.summary.bonus"));
  return parts.length > 0 ? parts.join(" · ") : t("rewards.summary.kept");
});

const UNDO_KEYS: Record<string, MessageKey> = {
  remove: "rewards.undo.remove",
  removeDay: "rewards.undo.removeDay",
  keep: "rewards.undo.keep",
  defaults: "rewards.undo.defaults",
  rescale: "rewards.undo.rescale",
  reset: "rewards.undo.reset",
};
const undoMessage = computed(() => t(UNDO_KEYS[lastUndo.value ?? ""] ?? "rewards.undo.remove"));

function whereText(where: SharedChange["where"]): string {
  return where === "default" ? t("rewards.impact.inPool") : t("rewards.impact.inDay", { day: where.slice("streakBonuses.".length) });
}

const reviewItems = computed<ReviewItem[]>(() =>
  entryChanges.value.map((change) => {
    const entry = (change.after ?? change.before)!;
    const text = (e: SharedChange["before"]): string | undefined =>
      e ? `${stackText(catalog.value, e)}${change.where === "default" ? `, ${t("rewards.weightIs", { weight: e.weight ?? 1 })}` : ""}` : undefined;
    return {
      key: `${itemName(catalog.value, entry.item)} (${whereText(change.where)})`,
      before: text(change.before),
      after: text(change.after),
    };
  }),
);

provide(REWARDS_CONTEXT, { rewards, catalog, editable, mode });

watch(
  () => props.server,
  () => void syncScope(),
);
watch(
  () => props.serverIds,
  () => void syncScope(),
);
watch(scopes, () => void syncScope());
watch(scope, () => {
  selectedDay.value = null;
});

onMounted(async () => {
  void syncScope();
  try {
    catalog.value = await loadItemCatalog();
  } catch {
    // The editor works without names; ids are shown instead.
  }
});

/**
 * Open the scope the URL names, or the first one this user may see. An
 * unknown or forbidden server in the URL is replaced, never shown empty.
 */
async function syncScope(): Promise<void> {
  if (scopes.value.length === 0) return;
  const wanted = props.server || SHARED;
  const allowed = scopes.value.some((s) => s.value === wanted);
  const first = scopes.value[0]!.value;
  const target = allowed ? props.server : first === SHARED ? "" : first;
  if (target !== props.server) {
    // Server ids arrive with the status poll; wait for them before
    // calling a server in the URL unknown.
    if (props.server && props.serverIds.length === 0) return;
    emit("update-route", { params: { server: target || undefined } });
    return;
  }
  if (ready.value && scope.value === target) return;
  if (loading.value && scope.value === target) return;
  await open(target);
}

async function onScopePick(picked: string): Promise<void> {
  const value = picked === SHARED ? "" : picked;
  if (value === scope.value) return;
  if (!(await confirmLeave(ask))) return;
  discard();
  emit("update-route", { params: { server: value || undefined } });
}

async function reload(): Promise<void> {
  await open(scope.value);
}

function discardAll(): void {
  discard();
  selectedDay.value = null;
}

function askShipped(): void {
  confirm.require({
    header: t("rewards.defaults.title"),
    message: t("rewards.defaults.message"),
    icon: "pi pi-exclamation-triangle",
    acceptLabel: t("rewards.defaults.accept"),
    rejectLabel: t("rewards.defaults.cancel"),
    accept: () => rewards.applyShippedDefaults(),
  });
}

async function persist(): Promise<void> {
  const ok = await save();
  if (ok) notify.ok(t("rewards.savedToast"), t("rewards.savedToastDetail"));
}

/** Saving the shared pool first asks what it does to the servers that inherit it. */
async function onSave(): Promise<void> {
  if (isShared.value && editable.value) {
    try {
      const affected = await rewards.loadImpact();
      if (affected.length > 0) {
        impact.value = affected;
        impactOpen.value = true;
        return;
      }
    } catch {
      // Without the check the save still works; the servers just are not asked about.
    }
  }
  await persist();
}

async function onImpactConfirm(selections: Record<string, ServerSelection>): Promise<void> {
  rewards.setSelections(selections);
  await persist();
  impactOpen.value = false;
}

async function onReviewSave(): Promise<void> {
  reviewOpen.value = false;
  await onSave();
}
</script>

<style scoped>
.rewards-view { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.rw-hint { color: var(--text-dim); font-size: var(--text-sm); margin: 0; }
.rw-scope { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.rw-scope-label { font-weight: 600; }
.rw-scope-select { min-width: 240px; max-width: 100%; }
.rw-scope .rw-hint { flex-basis: 100%; }
.rw-list { margin: 0; padding-left: var(--space-4); overflow-wrap: anywhere; }
.rw-banner-text { margin: 0 0 var(--space-2); }
.rw-body { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.rw-panel { min-width: 0; }
.rw-section { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.rw-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4); }
.rw-streaks { display: grid; gap: var(--space-4); min-width: 0; }
@media (min-width: 1100px) {
  .rw-streaks.has-day { grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); align-items: start; }
}
</style>
