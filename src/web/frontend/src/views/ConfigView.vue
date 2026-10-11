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
            <StatusChip :state="applyState ?? 'unknown'" :label="applyView.label" />
            <span class="cv-hint">{{ applyView.hint }}</span>
          </template>
        </EditBar>
      </template>

      <template #toolbar>
        <div class="cv-tabs" role="tablist" :aria-label="t('config.viewTabs')" @keydown="onTabKey">
          <button
            id="cfg-tab-form"
            ref="tabForm"
            type="button"
            role="tab"
            class="cv-tab"
            :aria-selected="rawMode ? 'false' : 'true'"
            :tabindex="rawMode ? -1 : 0"
            aria-controls="cfg-panel"
            :disabled="schemaFailed"
            @click="selectTab(false)"
          >
            {{ t("config.tabForm") }}
          </button>
          <button
            id="cfg-tab-raw"
            ref="tabRaw"
            type="button"
            role="tab"
            class="cv-tab"
            :aria-selected="rawMode ? 'true' : 'false'"
            :tabindex="rawMode ? 0 : -1"
            aria-controls="cfg-panel"
            @click="selectTab(true)"
          >
            {{ t("config.tabRaw") }}
          </button>
        </div>
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
        <div id="cfg-panel" role="tabpanel" :aria-labelledby="rawMode ? 'cfg-tab-raw' : 'cfg-tab-form'" class="cv-panel">
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
            <p class="cv-count" aria-live="polite">{{ t("config.shownCount", { count: filter.count }) }}</p>

            <EmptyState v-if="filter.active && filter.count === 0" icon="pi pi-search">
              {{ t("config.filterEmpty") }}
              <template #action>
                <span class="cv-hint">{{ t("config.filterEmptyHint") }}</span>
              </template>
            </EmptyState>

            <div class="cv-groups">
              <section
                v-for="group in shownGroups"
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
                  <SchemaField
                    v-for="key in group.keys"
                    :key="key"
                    :name="key"
                    :schema="topLevelProps[key]"
                    :definitions="schema.definitions"
                    :key-path="[key]"
                    :bare="group.keys.length === 1 && isObjectKey(key)"
                    :model-value="model[key]"
                    @update:model-value="setTop(key, $event)"
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

<script lang="ts">
import { computed, defineComponent, nextTick, provide, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { isSecretConfigPath, type ConfigApplyState } from "@mcbot/schema";
import SchemaField from "../components/schema/SchemaField.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import { classifyField, derefNode, countNewSections, topLevelSectionKeys } from "../components/schema/schemaField";
import { configGroups, type ConfigGroup } from "../components/schema/configGroups";
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
import InlineError from "../components/ui/InlineError.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import ReviewChanges, { type ReviewItem } from "../components/ui/ReviewChanges.vue";
import type { EditorState } from "../components/ui/types";
import { t } from "../i18n";

export default defineComponent({
  name: "ConfigView",
  components: {
    SchemaField, ConflictPicker, Button, InputText, Textarea, ViewHeader, EditorShell, EditBar,
    InlineBanner, InlineError, EmptyState, StatusChip, ReviewChanges,
  },
  props: {
    /** Raw JSON mode, as the URL (`#/config/raw`) asks for it. */
    raw: { type: Boolean, default: false },
    /** The filter, as the URL (`#/config?q=apiUrl`) carries it. */
    q: { type: String, default: "" },
  },
  emits: ["update-route"],
  setup(props) {
    // Server options so ID fields (defaultServer, allowedServers, a feature's
    // `server` scope) render as name dropdowns. Channels and roles are guild
    // scoped, so the top level has none.
    const refsApi = useSchemaRefs();
    const { guildName, load: loadGuildNames } = useGuilds();
    provide(SchemaRefsKey, refsApi.globalScope);
    // The `guilds` map's entries are named from the source the Guilds page uses.
    provide(MapKeyLabelKey, (mapName: string, key: string) =>
      mapName === "guilds" ? guildName(key) : undefined,
    );
    // Each guild entry gets its own channels and roles, the same scope the
    // single-guild dialog uses, so a picker in one guild only offers its own.
    provide(SchemaScopeKey, (mapName: string, key: string) =>
      mapName === "guilds" ? refsApi.scopeForGuild(key) : undefined,
    );

    const config = useConfig();
    const status = useConfigStatus();
    const query = ref(props.q);

    const topLevelProps = computed<Record<string, unknown>>(
      () => derefNode(config.schema.value, config.schema.value?.definitions).properties ?? {},
    );

    const form = useSchemaForm({
      props: () => topLevelProps.value,
      definitions: () => config.schema.value?.definitions,
      draft: () => config.model.value,
      baseline: () => config.baseline.value,
      serverErrors: () => config.fieldErrors.value,
      conflicts: () => config.conflicts.value,
      query: () => query.value,
      locked: () => config.saving.value,
      entryLabel: (mapName, key) => (mapName === "guilds" ? guildName(key) : undefined),
      idPrefix: "cfg",
    });

    return {
      ...config,
      t,
      query,
      topLevelProps,
      filter: form.filter,
      problems: form.problems,
      issues: form.issues,
      entries: form.entries,
      generalErrors: form.generalErrors,
      changes: form.changes,
      reveal: form.reveal,
      formContext: form.context,
      applyStatus: status.status,
      applyView: status.view,
      statusForbidden: status.forbidden,
      startStatus: status.start,
      refreshStatus: status.refresh,
      loadServerRefs: refsApi.loadServers,
      loadGuildNames,
    };
  },
  data() {
    return {
      reviewOpen: false,
      currentGroup: "",
      rawLeaveBlocked: false,
    };
  },
  computed: {
    groups(): ConfigGroup[] {
      return configGroups(Object.keys(this.topLevelProps));
    },
    shownGroups(): ConfigGroup[] {
      if (!this.filter.active) return this.groups;
      return this.groups.filter((group) => group.keys.some((key) => this.filter.isVisible([key])));
    },
    groupStats(): Record<string, { count: number; problems: number }> {
      const out: Record<string, { count: number; problems: number }> = {};
      for (const group of this.groups) {
        const keys = new Set(group.keys);
        out[group.id] = {
          count: this.entries.filter((e) => e.leaf && keys.has(e.path[0]!) && this.filter.isVisible(e.path)).length,
          problems: this.issues.filter((issue) => keys.has(issue.path[0]!)).length,
        };
      }
      return out;
    },
    applyState(): ConfigApplyState | undefined {
      return this.applyStatus?.state;
    },
    restartServers(): string {
      return this.applyStatus?.restartRequired.join(", ") ?? "";
    },
    editorState(): EditorState {
      if (this.saving) return "saving";
      if (this.conflicts.length > 0) return "conflict";
      if (this.problemCount > 0) return "error";
      if (this.dirty) return "dirty";
      return "clean";
    },
    problemCount(): number {
      if (this.rawMode) return this.rawError ? 1 : 0;
      return this.problems.length;
    },
    changeCount(): number {
      return this.changes.length || (this.dirty ? 1 : 0);
    },
    bannerErrors(): string[] {
      // The conflict banner already says why a save stopped on a conflict.
      const saveError = this.conflicts.length > 0 ? "" : this.saveError;
      return [...(saveError ? [saveError] : []), ...this.generalErrors];
    },
    reviewItems(): ReviewItem[] {
      return this.changes.map((change) => ({
        key: change.path.join("."),
        before: change.before,
        after: change.after,
        secret: isSecretConfigPath(change.path),
      }));
    },
    // Feature sections the schema defines that this config has never set.
    newFeatureCount(): number {
      if (!this.schema || !this.model) return 0;
      return countNewSections(this.topLevelProps, this.model, this.schema.definitions, isFeatureNew);
    },
  },
  watch: {
    raw() {
      this.applyRouteMode();
    },
    rawMode(on: boolean) {
      if (on !== this.raw) this.$emit("update-route", { params: { mode: on ? "raw" : undefined } });
    },
    q(value: string) {
      if (value !== this.query) this.query = value;
    },
    query(value: string) {
      if (value !== this.q) this.$emit("update-route", { query: { q: value || undefined } });
    },
    rawError(error: string) {
      if (!error) this.rawLeaveBlocked = false;
    },
  },
  methods: {
    isObjectKey(key: string): boolean {
      const defs = this.schema?.definitions;
      return classifyField(derefNode(this.topLevelProps[key], defs), defs) === "object";
    },
    /** Follows the URL's mode; leaving raw mode with unparsable text is
     *  refused, and then the URL follows the editor instead. */
    applyRouteMode(): void {
      if (!this.model || this.schemaFailed) return;
      this.setRawMode(this.raw);
      if (this.rawMode !== this.raw) {
        this.$emit("update-route", { params: { mode: this.rawMode ? "raw" : undefined } });
      }
    },
    selectTab(raw: boolean): void {
      this.setRawMode(raw);
      this.rawLeaveBlocked = !raw && this.rawMode;
    },
    onTabKey(event: KeyboardEvent): void {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const toRaw = !this.rawMode;
      if (!toRaw && this.schemaFailed) return;
      this.selectTab(toRaw);
      void nextTick(() => {
        const tab = (this.rawMode ? this.$refs.tabRaw : this.$refs.tabForm) as HTMLElement | undefined;
        tab?.focus();
      });
    },
    jumpToGroup(id: string): void {
      this.currentGroup = id;
      const section = document.getElementById(`cfg-group-${id}`);
      section?.scrollIntoView({ block: "start" });
      section?.focus({ preventScroll: true });
    },
    onGroupSelect(event: Event): void {
      this.jumpToGroup((event.target as HTMLSelectElement).value);
    },
    async goToFirstProblem(): Promise<void> {
      if (this.rawMode) {
        document.getElementById("cfg-raw")?.focus();
        return;
      }
      const first = this.issues[0];
      if (!first) return;
      if (!this.filter.isVisible(first.path)) this.query = "";
      this.reveal(first.path);
      await nextTick();
      const el = document.getElementById(this.formContext.idFor(first.path));
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      const target = el.matches("input, textarea, select, button, [tabindex]")
        ? el
        : el.querySelector<HTMLElement>("input, textarea, select, button");
      target?.focus({ preventScroll: true });
    },
    async onSave(): Promise<void> {
      if (await this.save()) void this.refreshStatus();
    },
    async onReviewSave(): Promise<void> {
      this.reviewOpen = false;
      await this.onSave();
    },
    async reload(): Promise<void> {
      await this.load();
    },
  },
  async mounted() {
    this.startStatus();
    await Promise.all([this.load(), this.loadServerRefs(), this.loadGuildNames()]);
    this.applyRouteMode();
    this.currentGroup = this.groups[0]?.id ?? "";
    // With the schema loaded, mark its feature keys seen so a later visit only
    // flags genuinely new additions (this session's badges are held by the
    // frozen snapshot in useSeenFeatures).
    if (this.schema) {
      commitSeenFeatures(topLevelSectionKeys(this.topLevelProps, this.schema.definitions));
    }
  },
});
</script>

<style scoped>
.config-view { display: flex; flex-direction: column; min-width: 0; }
.cv-note { display: flex; align-items: center; gap: var(--space-2); color: var(--text-dim); padding: var(--space-5) 0; margin: 0; }
.cv-hint { color: var(--text-dim); font-size: var(--text-sm); }
.cv-list { margin: 0; padding-left: 18px; }
.cv-list li { overflow-wrap: anywhere; }

.cv-tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border); overflow-x: auto; }
.cv-tab {
  min-height: var(--control-h);
  padding: 0 var(--space-4);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.cv-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.cv-tab:disabled { cursor: default; opacity: 0.6; }
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
  border-left: 3px solid transparent;
  border-radius: var(--radius-control);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cv-groupnav button:hover { background: var(--surface-raised); }
.cv-groupnav button[aria-current="true"] { border-left-color: var(--accent); background: var(--accent-tint); font-weight: 500; }
.gn-title { min-width: 0; overflow-wrap: anywhere; }
.gn-n { flex: none; font-size: var(--text-xs); color: var(--text-dim); }
.gn-err { color: var(--text); font-weight: 600; box-shadow: inset 0 -2px 0 var(--danger); }

.cv-panel { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
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
.cv-filter { position: relative; }
.cv-filter .pi { position: absolute; left: var(--space-3); top: 50%; transform: translateY(-50%); color: var(--text-dim); pointer-events: none; }
.cv-filter :deep(.p-inputtext) { width: 100%; padding-left: 36px; }
.cv-count { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }

.cv-groups { display: block; }
.cv-group {
  margin-bottom: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  break-inside: avoid;
  scroll-margin-top: 96px;
  min-width: 0;
}
.cv-group:focus { outline: none; }
.cv-group:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (min-width: 1800px) {
  .cv-groups { columns: 2; column-gap: var(--space-5); }
  .cv-group { margin-bottom: var(--space-5); }
}
@media (min-width: 2400px) {
  .cv-groups { columns: 3; }
}
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
.cg-fields { padding: var(--space-1) 0 var(--space-2); min-width: 0; }

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
  .tap, .cv-tab, .cv-groupnav button { min-height: var(--touch-min); }
}
</style>
