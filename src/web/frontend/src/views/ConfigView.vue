<template>
  <div class="config-view">
    <ViewHeader :title="t('config.title')">
      <template #subtitle>
        {{ t("config.ledeLead") }} <code class="mono">config.json</code>{{ t("config.ledeTail") }}
      </template>
    </ViewHeader>

    <InlineError
      v-if="loadError && !ready"
      :title="t('config.loadFailed')"
      :recovery="t('config.loadFailedRecovery')"
      :detail="loadError"
      :busy="loading"
      :heading-level="2"
      @retry="reload"
    />
    <p v-else-if="!ready" class="cv-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("config.loading") }}
    </p>

    <EditorShell v-else :state="editorState" :nav-label="t('config.groupNav')">
      <template #banners>
        <InlineBanner v-if="stale" tone="warn" :title="t('config.staleTitle')">
          {{ t("config.staleText") }}
          <template #actions>
            <Button :label="t('config.reload')" icon="pi pi-refresh" size="small" severity="secondary" outlined class="tap" @click="reload" />
          </template>
        </InlineBanner>
        <InlineBanner v-if="bannerErrors.length" tone="danger" :title="t('config.saveFailedTitle')">
          <ul class="cv-list">
            <li v-for="(line, i) in bannerErrors" :key="i">{{ line }}</li>
          </ul>
        </InlineBanner>
        <InlineBanner v-if="warnings.length" tone="warn" :title="t('config.warningsTitle')">
          <ul class="cv-list">
            <li v-for="(line, i) in warnings" :key="i">{{ line }}</li>
          </ul>
        </InlineBanner>
        <InlineBanner v-if="applyState === 'pending' && !dirty" tone="info" :title="t('config.pendingTitle')">
          {{ t("config.pendingText") }}
        </InlineBanner>
        <InlineBanner v-if="applyState === 'restart-required'" tone="warn" :title="t('config.restartTitle', { servers: restartServers })">
          {{ t("config.restartText") }}
        </InlineBanner>
        <InlineBanner v-if="schemaFailed" tone="info" :title="t('config.schemaFailedTitle')">
          {{ t("config.schemaFailedText") }}
        </InlineBanner>
      </template>

      <template #conflict>
        <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
      </template>
      <template #conflict-actions>
        <Button
          :label="t('config.dropMine')"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          class="tap"
          @click="reloadDiscardingMine"
        />
      </template>

      <template #bar>
        <EditBar
          :state="editorState"
          :change-count="changeCount"
          :problem-count="problemCount"
          :conflict-count="conflicts.length"
          :can-save="canSave"
          reviewable
          :save-hint="t('config.saveHint')"
          :saving-hint="t('config.savingHint')"
          @save="onSave"
          @discard="discard"
          @review="reviewOpen = true"
          @first-problem="goToFirstProblem"
        >
          <template v-if="!statusForbidden" #status>
            <ConfigStatusChip :status="applyStatus" />
            <span v-if="!botDownBannerShown" class="cv-hint">{{ applyView.hint }}</span>
          </template>
        </EditBar>
      </template>

      <template #toolbar>
        <TabList
          :tabs="viewTabs"
          :model-value="rawMode ? 'raw' : 'form'"
          :label="t('config.viewTabs')"
          id-prefix="cfg"
          panel-id="cfg-panel"
          @select="selectTab($event === 'raw')"
        />
        <p v-if="rawLeaveBlocked" class="cv-blocked" role="alert">{{ t("config.rawLeaveBlocked") }}</p>
      </template>

      <template v-if="!rawMode" #nav>
        <ul class="cv-groupnav">
          <li v-for="group in shownGroups" :key="group.id">
            <button
              type="button"
              :aria-current="currentGroup === group.id ? 'true' : undefined"
              @click="jumpToGroup(group.id)"
            >
              <span class="gn-title">{{ t(group.titleKey) }}</span>
              <span v-if="groupStats[group.id]!.problems" class="gn-n gn-err">
                {{ t("config.groupProblems", { count: groupStats[group.id]!.problems }) }}
              </span>
              <span v-else class="gn-n">{{ groupStats[group.id]!.count }}</span>
            </button>
          </li>
        </ul>
      </template>

      <template #default="{ locked }">
        <div id="cfg-panel" role="tabpanel" :aria-labelledby="rawMode ? 'cfg-tab-raw' : 'cfg-tab-form'" class="cv-panel" :class="{ 'cv-panel-raw': rawMode }">
          <div v-if="rawMode" class="cv-raw">
            <label class="cv-raw-label" for="cfg-raw"><code class="mono">config.json</code></label>
            <p id="cfg-raw-help" class="cv-hint">{{ t("config.rawHelp", { placeholder }) }}</p>
            <Textarea
              id="cfg-raw"
              :model-value="rawText"
              class="cv-raw-text"
              spellcheck="false"
              auto-resize
              :invalid="!!rawError"
              :disabled="locked"
              aria-describedby="cfg-raw-help cfg-raw-status"
              @update:model-value="setRawText"
            />
            <p id="cfg-raw-status" :class="['cv-raw-status', { bad: !!rawError }]" :role="rawError ? 'alert' : undefined">
              {{ rawError ? t("config.rawInvalid", { error: rawError }) : t("config.rawValid") }}
            </p>
          </div>

          <template v-else-if="schema && model">
            <InlineBanner v-if="newFeatureCount > 0" tone="info">
              {{ t("config.newFeatures", { count: newFeatureCount }) }}
            </InlineBanner>

            <div class="cv-groupselect">
              <label for="cfg-groupselect" class="cv-caps">{{ t("config.jumpToGroup") }}</label>
              <select id="cfg-groupselect" class="cv-select" :value="currentGroup" @change="onGroupSelect">
                <option v-for="group in shownGroups" :key="group.id" :value="group.id">{{ t(group.titleKey) }}</option>
              </select>
            </div>

            <div class="cv-tools">
              <div class="cv-filter">
                <i class="pi pi-search" aria-hidden="true" />
                <label class="sr-only" for="cfg-filter">{{ t("config.filterLabel") }}</label>
                <InputText
                  id="cfg-filter"
                  v-model="query"
                  type="search"
                  autocomplete="off"
                  :placeholder="t('config.filterPlaceholder')"
                />
              </div>
              <div class="cv-showall">
                <ToggleSwitch v-model="showAll" input-id="cfg-showall" />
                <label for="cfg-showall">{{ t("config.showAll") }}</label>
              </div>
            </div>
            <p class="cv-count" aria-live="polite">
              {{
                filter.active || showAll
                  ? t("config.shownCount", { count: filter.count })
                  : t("config.configuredSummary", setSummary)
              }}
            </p>

            <EmptyState v-if="filter.active && filter.count === 0" icon="pi pi-search">
              {{ t("config.filterEmpty") }}
              <template #action>
                <span class="cv-hint">{{ t("config.filterEmptyHint") }}</span>
              </template>
            </EmptyState>

            <div class="cv-groups">
              <section
                v-for="group in displayGroups"
                :id="`cfg-group-${group.id}`"
                :key="group.id"
                class="cv-group"
                :aria-labelledby="`cfg-group-${group.id}-h`"
                tabindex="-1"
              >
                <header class="cg-head">
                  <h2 :id="`cfg-group-${group.id}-h`">{{ t(group.titleKey) }}</h2>
                  <span class="cg-meta">{{ t("config.groupCount", { count: groupStats[group.id]!.count }) }}</span>
                </header>
                <div class="cg-fields">
                  <ConfiguredFields
                    :keys="group.keys"
                    :schemas="topLevelProps"
                    :definitions="schema.definitions"
                    :model="model"
                    :baseline="baselineDoc"
                    :problem-keys="problemKeys"
                    :show-all="showAll"
                    :filter-active="filter.active"
                    :is-visible="filter.isVisible"
                    :is-bare="(key) => group.keys.length === 1 && isObjectKey(key)"
                    @update="setTop"
                  />
                </div>
              </section>
            </div>
          </template>
        </div>
      </template>
    </EditorShell>

    <ReviewChanges
      v-model:visible="reviewOpen"
      :changes="reviewItems"
      :can-save="canSave && editorState === 'dirty'"
      @save="onReviewSave"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import ToggleSwitch from "primevue/toggleswitch";
import Textarea from "primevue/textarea";
import { ConfigApplyState, isSecretConfigPath } from "@mcbot/schema";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import { classifyField, derefNode, countNewSections, topLevelSectionKeys } from "../components/schema/schemaField";
import { configGroups, type ConfigGroup } from "../components/schema/configGroups";
import ConfiguredFields from "../components/schema/ConfiguredFields.vue";
import { isKeyActive } from "../components/schema/configuredFirst";
import { isFeatureNew, commitSeenFeatures } from "../composables/useSeenFeatures";
import { useSchemaRefs, SchemaRefsKey, MapKeyLabelKey, SchemaScopeKey } from "../composables/useSchemaRefs";
import { useGuilds } from "../composables/useGuilds";
import { useConfig } from "../composables/useConfig";
import { useConfigStatus } from "../composables/useConfigStatus";
import { useSchemaForm } from "../composables/useSchemaForm";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EditorShell from "../components/ui/EditorShell.vue";
import EditBar from "../components/ui/EditBar.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import TabList from "../components/ui/TabList.vue";
import InlineError from "../components/ui/InlineError.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import ConfigStatusChip from "../components/ui/ConfigStatusChip.vue";
import ReviewChanges, { type ReviewItem } from "../components/ui/ReviewChanges.vue";
import type { EditorState } from "../components/ui/types";
import { t } from "../i18n";

const props = withDefaults(
  defineProps<{
    /** Raw JSON mode, as the URL (`#/config/raw`) asks for it. */
    raw?: boolean;
    /** The filter, as the URL (`#/config?q=apiUrl`) carries it. */
    q?: string;
  }>(),
  { raw: false, q: "" },
);
const emit = defineEmits<{
  "update-route": [patch: { params?: Record<string, string | undefined>; query?: Record<string, string | undefined> }];
}>();

// Server options so ID fields (defaultServer, allowedServers, a feature's
// `server` scope) render as name dropdowns. Channels and roles are guild
// scoped, so the top level has none.
const refsApi = useSchemaRefs();
const { guildName, load: loadGuildNames } = useGuilds();
provide(SchemaRefsKey, refsApi.globalScope);
// The `guilds` map's entries are named from the source the Guilds page uses.
provide(MapKeyLabelKey, (mapName: string, key: string) => (mapName === "guilds" ? guildName(key) : undefined));
// Each guild entry gets its own channels and roles, the same scope the
// single-guild dialog uses, so a picker in one guild only offers its own.
provide(SchemaScopeKey, (mapName: string, key: string) =>
  mapName === "guilds" ? refsApi.scopeForGuild(key) : undefined,
);

const {
  placeholder,
  schema,
  schemaFailed,
  model,
  rawMode,
  rawText,
  rawError,
  canSave,
  loading,
  loadError,
  ready,
  baseline,
  fieldErrors,
  saveError,
  saving,
  warnings,
  stale,
  dirty,
  conflicts,
  resolveConflict,
  load,
  setTop,
  setRawMode,
  setRawText,
  discard,
  save,
  reloadDiscardingMine,
} = useConfig();
const status = useConfigStatus();
const {
  status: applyStatus,
  view: applyView,
  forbidden: statusForbidden,
  start: startStatus,
  refresh: refreshStatus,
} = status;
const query = ref(props.q);

/** Per-guild settings are edited on the Guilds page; Raw JSON still carries them. */
const GUILD_OWNED_KEYS = new Set(["guilds"]);

const topLevelProps = computed<Record<string, unknown>>(() => {
  const all = derefNode(schema.value, schema.value?.definitions).properties ?? {};
  return Object.fromEntries(Object.entries(all).filter(([key]) => !GUILD_OWNED_KEYS.has(key)));
});

const showAll = ref(false);

const form = useSchemaForm({
  props: () => topLevelProps.value,
  definitions: () => schema.value?.definitions,
  draft: () => model.value,
  baseline: () => baseline.value,
  serverErrors: () => fieldErrors.value,
  conflicts: () => conflicts.value,
  query: () => query.value,
  locked: () => saving.value,
  showAll: () => showAll.value,
  entryLabel: (mapName, key) => (mapName === "guilds" ? guildName(key) : undefined),
  idPrefix: "cfg",
});
const { filter, problems, issues, entries, generalErrors, changes, reveal } = form;
const formContext = form.context;

const reviewOpen = ref(false);
const currentGroup = ref("");
const rawLeaveBlocked = ref(false);
const viewTabs = computed(() => [
  { id: "form", label: t("config.tabForm"), disabled: schemaFailed.value },
  { id: "raw", label: t("config.tabRaw") },
]);

const groups = computed<ConfigGroup[]>(() => configGroups(Object.keys(topLevelProps.value)));
const shownGroups = computed<ConfigGroup[]>(() => {
  if (!filter.value.active) return groups.value;
  return groups.value.filter((group) => group.keys.some((key) => filter.value.isVisible([key])));
});
/** One group at a time; a filter lists every group that has a match. */
const displayGroups = computed<ConfigGroup[]>(() => {
  if (filter.value.active) return shownGroups.value;
  const current = groups.value.find((group) => group.id === currentGroup.value) ?? groups.value[0];
  return current ? [current] : [];
});

const baselineDoc = computed(() => (baseline.value ?? null) as Record<string, unknown> | null);
const problemKeys = computed(() => new Set(issues.value.map((issue) => issue.path[0]!)));
const setSummary = computed(() => {
  const keys = groups.value.flatMap((group) => group.keys);
  const set = keys.filter((key) => isKeyActive(key, model.value, baselineDoc.value, problemKeys.value));
  return { set: set.length, total: keys.length };
});
const groupStats = computed<Record<string, { count: number; problems: number }>>(() => {
  const out: Record<string, { count: number; problems: number }> = {};
  for (const group of groups.value) {
    const keys = new Set(group.keys);
    out[group.id] = {
      count: entries.value.filter((e) => e.leaf && keys.has(e.path[0]!) && filter.value.isVisible(e.path)).length,
      problems: issues.value.filter((issue) => keys.has(issue.path[0]!)).length,
    };
  }
  return out;
});
const applyState = computed(() => applyStatus.value?.state);
// The app shell already announces a stopped bot to sysadmins, the only readers of this status.
const botDownBannerShown = computed(() => applyState.value === ConfigApplyState.BotDown);
const restartServers = computed(() => applyStatus.value?.restartRequired.join(", ") ?? "");
const editorState = computed<EditorState>(() => {
  if (saving.value) return "saving";
  if (conflicts.value.length > 0) return "conflict";
  if (problemCount.value > 0) return "error";
  if (dirty.value) return "dirty";
  return "clean";
});
const problemCount = computed(() => {
  if (rawMode.value) return rawError.value ? 1 : 0;
  return problems.value.length;
});
const changeCount = computed(() => changes.value.length || (dirty.value ? 1 : 0));
const bannerErrors = computed(() => {
  // The conflict banner already says why a save stopped on a conflict.
  const message = conflicts.value.length > 0 ? "" : saveError.value;
  return [...(message ? [message] : []), ...generalErrors.value];
});
const reviewItems = computed<ReviewItem[]>(() =>
  changes.value.map((change) => ({
    key: change.path.join("."),
    before: change.before,
    after: change.after,
    secret: isSecretConfigPath(change.path),
  })),
);
// Feature sections the schema defines that this config has never set.
const newFeatureCount = computed(() => {
  if (!schema.value || !model.value) return 0;
  return countNewSections(topLevelProps.value, model.value, schema.value.definitions, isFeatureNew);
});

watch(
  () => props.raw,
  () => applyRouteMode(),
);
watch(rawMode, (on) => {
  if (on !== props.raw) emit("update-route", { params: { mode: on ? "raw" : undefined } });
});
watch(
  () => props.q,
  (value) => {
    if (value !== query.value) query.value = value;
  },
);
watch(query, (value) => {
  if (value !== props.q) emit("update-route", { query: { q: value || undefined } });
});
watch(rawError, (error) => {
  if (!error) rawLeaveBlocked.value = false;
});

function isObjectKey(key: string): boolean {
  const defs = schema.value?.definitions;
  return classifyField(derefNode(topLevelProps.value[key], defs), defs) === "object";
}

/** Follows the URL's mode; leaving raw mode with unparsable text is
 *  refused, and then the URL follows the editor instead. */
function applyRouteMode(): void {
  if (!model.value || schemaFailed.value) return;
  setRawMode(props.raw);
  if (rawMode.value !== props.raw) {
    emit("update-route", { params: { mode: rawMode.value ? "raw" : undefined } });
  }
}

function selectTab(raw: boolean): void {
  setRawMode(raw);
  rawLeaveBlocked.value = !raw && rawMode.value;
}

async function jumpToGroup(id: string): Promise<void> {
  currentGroup.value = id;
  await nextTick();
  const section = document.getElementById(`cfg-group-${id}`);
  section?.scrollIntoView({ block: "start" });
  section?.focus({ preventScroll: true });
}

function onGroupSelect(event: Event): void {
  jumpToGroup((event.target as HTMLSelectElement).value);
}

async function goToFirstProblem(): Promise<void> {
  if (rawMode.value) {
    document.getElementById("cfg-raw")?.focus();
    return;
  }
  const first = issues.value[0];
  if (!first) return;
  if (!filter.value.isVisible(first.path)) query.value = "";
  const owner = groups.value.find((group) => group.keys.includes(first.path[0]!));
  if (owner) currentGroup.value = owner.id;
  reveal(first.path);
  await nextTick();
  const el = document.getElementById(formContext.idFor(first.path));
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  const target = el.matches("input, textarea, select, button, [tabindex]")
    ? el
    : el.querySelector<HTMLElement>("input, textarea, select, button");
  target?.focus({ preventScroll: true });
}

async function onSave(): Promise<void> {
  if (await save()) void refreshStatus();
}

async function onReviewSave(): Promise<void> {
  reviewOpen.value = false;
  await onSave();
}

async function reload(): Promise<void> {
  await load();
}

onMounted(async () => {
  startStatus();
  await Promise.all([load(), refsApi.loadServers(), loadGuildNames()]);
  applyRouteMode();
  currentGroup.value = groups.value[0]?.id ?? "";
  // With the schema loaded, mark its feature keys seen so a later visit only
  // flags genuinely new additions (this session's badges are held by the
  // frozen snapshot in useSeenFeatures).
  if (schema.value) {
    commitSeenFeatures(topLevelSectionKeys(topLevelProps.value, schema.value.definitions));
  }
});
</script>

<style scoped>
.config-view { display: flex; flex-direction: column; min-width: 0; }
.cv-note { display: flex; align-items: center; gap: var(--space-2); color: var(--text-dim); padding: var(--space-5) 0; margin: 0; }
.cv-hint { color: var(--text-dim); font-size: var(--text-sm); }
.cv-list { margin: 0; padding-left: 18px; }
.cv-list li { overflow-wrap: anywhere; }

.cv-blocked { margin: var(--space-2) 0 0; color: var(--danger); font-size: var(--text-sm); }

.cv-groupnav { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.cv-groupnav button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h);
  padding: 0 var(--space-3);
  background: none;
  border: 0;
  border-radius: var(--radius-control);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cv-groupnav button:hover { background: var(--surface-raised); }
.cv-groupnav button[aria-current="true"] { background: var(--accent-tint); color: var(--accent); font-weight: 600; }
.gn-title { min-width: 0; overflow-wrap: anywhere; }
.gn-n { flex: none; font-size: var(--text-xs); color: var(--text-dim); }
.gn-err { color: var(--text); font-weight: 600; box-shadow: inset 0 -2px 0 var(--danger); }

.cv-panel { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; max-width: 56rem; }
.cv-panel-raw { max-width: none; }
.cv-groupselect { display: none; }
.cv-caps { display: block; margin-bottom: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); text-transform: uppercase; letter-spacing: var(--tracking-caps); }
.cv-select {
  width: 100%;
  min-height: var(--control-h);
  padding: 0 var(--space-3);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  font: inherit;
}
/* Under 1100px the Jump to group select stands in for the group list. */
@media (max-width: 1099px) {
  .cv-groupselect { display: block; }
  .config-view :deep(.es-nav) { display: none; }
}
.cv-tools { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.cv-showall { display: flex; align-items: center; gap: var(--space-2); color: var(--text); font-size: var(--text-sm); }
.cv-showall label { cursor: pointer; }
.cv-filter { position: relative; flex: 1 1 16rem; }
.cv-filter .pi { position: absolute; left: var(--space-3); top: 50%; transform: translateY(-50%); color: var(--text-dim); pointer-events: none; }
.cv-filter :deep(.p-inputtext) { width: 100%; padding-left: 36px; }
.cv-count { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }

.cv-groups { display: block; }
.cv-group {
  margin-bottom: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  scroll-margin-top: 96px;
  min-width: 0;
  padding-bottom: var(--space-3);
}
.cv-group:focus { outline: none; }
.cv-group:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.cg-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.cg-head h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.cg-meta { color: var(--text-dim); font-size: var(--text-sm); }
.cg-fields { padding: var(--space-2) 0 var(--space-1); min-width: 0; }

.cv-raw { display: flex; flex-direction: column; gap: var(--space-2); }
.cv-raw-label { font-weight: 500; }
.cv-raw-text {
  width: 100%;
  min-height: 420px;
  background: var(--bg-code);
  font: var(--text-sm) / 1.55 var(--font-mono);
}
.cv-raw-status { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
.cv-raw-status.bad { color: var(--danger); }
@media (pointer: coarse), (max-width: 760px) {
  .cv-tab, .cv-groupnav button { min-height: var(--touch-min); }
}
</style>
