<template>
  <div class="gce-page">
    <button type="button" class="gce-back tap" @click="$emit('close')">
      <i class="pi pi-arrow-left" aria-hidden="true" /> {{ t("guildEditor.back") }}
    </button>

    <header class="gce-head">
      <GuildAvatar :guild-id="guildId" :size="44" />
      <div class="gce-title">
        <h1 class="gce-name">{{ guildName || guildId }}</h1>
        <span class="gce-id">
          <span class="gce-id-label">{{ t("guildEditor.idLabel") }}</span>
          <code class="mono">{{ guildId }}</code>
        </span>
      </div>
    </header>
    <p class="gce-hint">{{ t("guildEditor.hint") }}</p>

    <InlineError
      v-if="loadError && !ready"
      :title="t('guildEditor.loadFailed')"
      :detail="loadError"
      :busy="loading"
      @retry="retry"
    />
    <p v-else-if="!ready" class="gce-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("guildEditor.loading") }}
    </p>

    <EditorShell v-else :state="editorState" :nav-label="t('guildEditor.tabs')">
      <template #banners>
        <InlineBanner v-if="stale" tone="warn" :title="t('guildEditor.staleTitle')">
          {{ t("guildEditor.staleText") }}
        </InlineBanner>
        <InlineBanner v-if="bannerErrors.length" tone="danger" :title="t('guildEditor.saveFailedTitle')">
          <ul class="gce-list">
            <li v-for="(line, i) in bannerErrors" :key="i">{{ line }}</li>
          </ul>
        </InlineBanner>
        <InlineBanner v-if="warnings.length" tone="warn" :title="t('config.warningsTitle')">
          <ul class="gce-list">
            <li v-for="(line, i) in warnings" :key="i">{{ line }}</li>
          </ul>
        </InlineBanner>
        <InlineBanner v-if="newFeatureCount > 0" tone="info">
          {{ t("config.newFeatures", { count: newFeatureCount }) }}
        </InlineBanner>
        <InlineError
          v-if="model && !hasFields"
          :title="t('guildEditor.schemaFailed')"
          :detail="schemaError"
          @retry="retry"
        />
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
          :change-count="changes.length"
          :problem-count="problems.length"
          :conflict-count="conflicts.length"
          :can-save="canSave"
          @save="onSave"
          @discard="discard"
          @first-problem="goToFirstProblem"
        >
          <template #status>
            <ConfigStatusChip :refresh-key="savedCount" />
          </template>
        </EditBar>
      </template>

      <template #nav>
        <ul class="gce-tabs">
          <li v-for="group in groups" :key="group.id">
            <button
              type="button"
              :aria-current="currentGroup === group.id ? 'true' : undefined"
              @click="currentGroup = group.id"
            >
              <span class="gt-title">{{ t(group.titleKey) }}</span>
              <span v-if="groupProblems(group)" class="gt-n gt-err">{{ t("config.groupProblems", { count: groupProblems(group) }) }}</span>
            </button>
          </li>
        </ul>
      </template>

      <div v-if="model && hasFields" class="gce-panel">
        <div class="gce-groupselect">
          <label for="gce-groupselect" class="gce-caps">{{ t("config.jumpToGroup") }}</label>
          <select id="gce-groupselect" v-model="currentGroup" class="gce-select">
            <option v-for="group in groups" :key="group.id" :value="group.id">{{ t(group.titleKey) }}</option>
          </select>
        </div>
        <div class="gce-showall">
          <ToggleSwitch v-model="showAll" input-id="gce-showall" />
          <label for="gce-showall">{{ t("config.showAll") }}</label>
        </div>
        <section v-if="activeGroup" :key="activeGroup.id" class="gce-group" :aria-labelledby="`gce-group-${activeGroup.id}-h`">
          <header class="gg-head">
            <h2 :id="`gce-group-${activeGroup.id}-h`">{{ t(activeGroup.titleKey) }}</h2>
          </header>
          <ConfiguredFields
            :keys="activeGroup.keys"
            :schemas="topLevelProps"
            :definitions="definitions"
            :model="model"
            :baseline="baselineDoc"
            :problem-keys="problemKeys"
            :show-all="showAll"
            :filter-active="false"
            :is-visible="formContext.isVisible"
            @update="setField"
          />
        </section>
      </div>
    </EditorShell>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, provide, ref } from "vue";
import Button from "primevue/button";
import ToggleSwitch from "primevue/toggleswitch";
import ConfiguredFields from "./ConfiguredFields.vue";
import ConflictPicker from "./ConflictPicker.vue";
import ConfigStatusChip from "../ui/ConfigStatusChip.vue";
import EditorShell from "../ui/EditorShell.vue";
import EditBar from "../ui/EditBar.vue";
import GuildAvatar from "../ui/GuildAvatar.vue";
import InlineBanner from "../ui/InlineBanner.vue";
import InlineError from "../ui/InlineError.vue";
import type { EditorState } from "../ui/types";
import { derefNode, countNewSections, topLevelSectionKeys } from "./schemaField";
import { guildConfigGroups, type ConfigGroup } from "./configGroups";
import { isFeatureNew, commitSeenFeatures } from "../../composables/useSeenFeatures";
import { useGuildConfig } from "../../composables/useGuildConfig";
import { useSchemaRefs, SchemaRefsKey } from "../../composables/useSchemaRefs";
import { useSchemaForm } from "../../composables/useSchemaForm";
import { t } from "../../i18n";

export default defineComponent({
  name: "GuildConfigEditor",
  components: {
    Button, ToggleSwitch, ConfiguredFields, ConflictPicker, ConfigStatusChip, EditorShell, EditBar,
    GuildAvatar, InlineBanner, InlineError,
  },
  props: {
    guildId: { type: String, required: true },
    guildName: { type: String, default: "" },
  },
  emits: ["close", "saved"],
  setup(props) {
    // Named-entity options (servers plus this guild's channels and roles) so
    // ID fields render as name dropdowns.
    const refsApi = useSchemaRefs();
    provide(SchemaRefsKey, refsApi.dynamicGuildScope(() => props.guildId));

    const guild = useGuildConfig();
    const showAllRef = ref(false);
    const topLevelProps = computed<Record<string, unknown>>(
      () => derefNode(guild.schema.value, guild.definitions.value).properties ?? {},
    );
    const form = useSchemaForm({
      props: () => topLevelProps.value,
      definitions: () => guild.definitions.value,
      draft: () => guild.model.value,
      baseline: () => guild.baseline.value,
      serverErrors: () => guild.fieldErrors.value,
      conflicts: () => guild.conflicts.value,
      query: () => "",
      locked: () => guild.saving.value,
      showAll: () => showAllRef.value,
      stripPath: (path) => (path[0] === "guilds" && path[1] === props.guildId ? path.slice(2) : path),
      isSecret: () => false,
      idPrefix: "gce",
    });

    return {
      ...guild,
      t,
      showAll: showAllRef,
      topLevelProps,
      problems: form.problems,
      issues: form.issues,
      changes: form.changes,
      generalErrors: form.generalErrors,
      reveal: form.reveal,
      formContext: form.context,
      loadServers: refsApi.loadServers,
      loadGuildRefs: refsApi.loadGuildRefs,
    };
  },
  data() {
    return { savedCount: 0, currentGroup: "" };
  },
  computed: {
    hasFields(): boolean {
      return Object.keys(this.topLevelProps).length > 0;
    },
    groups(): ConfigGroup[] {
      return guildConfigGroups(Object.keys(this.topLevelProps));
    },
    activeGroup(): ConfigGroup | undefined {
      return this.groups.find((group) => group.id === this.currentGroup) ?? this.groups[0];
    },
    baselineDoc(): Record<string, unknown> | null {
      return (this.baseline ?? null) as Record<string, unknown> | null;
    },
    problemKeys(): Set<string> {
      return new Set(this.issues.map((issue) => issue.path[0]!));
    },
    newFeatureCount(): number {
      if (!this.model) return 0;
      return countNewSections(this.topLevelProps, this.model, this.definitions, isFeatureNew);
    },
    editorState(): EditorState {
      if (this.saving) return "saving";
      if (this.conflicts.length > 0) return "conflict";
      if (this.problems.length > 0) return "error";
      if (this.dirty) return "dirty";
      return "clean";
    },
    bannerErrors(): string[] {
      // The conflict banner already says why a save stopped on a conflict.
      const saveError = this.conflicts.length > 0 ? "" : this.saveError;
      return [...(saveError ? [saveError] : []), ...this.generalErrors];
    },
  },
  watch: {
    guildId: {
      immediate: true,
      async handler(id: string): Promise<void> {
        if (!id) return;
        this.currentGroup = "";
        this.showAll = false;
        await Promise.all([this.load(id), this.loadServers(), this.loadGuildRefs(id)]);
        commitSeenFeatures(topLevelSectionKeys(this.topLevelProps, this.definitions));
        this.currentGroup = this.groups[0]?.id ?? "";
      },
    },
  },
  methods: {
    groupProblems(group: ConfigGroup): number {
      return this.issues.filter((issue) => group.keys.includes(issue.path[0]!)).length;
    },
    async onSave(): Promise<void> {
      if (await this.save()) {
        this.savedCount += 1;
        this.$emit("saved");
      }
    },
    async goToFirstProblem(): Promise<void> {
      const first = this.issues[0];
      if (!first) return;
      const owner = this.groups.find((group) => group.keys.includes(first.path[0]!));
      if (owner) this.currentGroup = owner.id;
      this.reveal(first.path);
      await nextTick();
      const el = document.getElementById(this.formContext.idFor(first.path));
      el?.scrollIntoView({ block: "center" });
      const target = el?.matches("input, textarea, select, button, [tabindex]")
        ? el
        : el?.querySelector<HTMLElement>("input, textarea, select, button");
      target?.focus({ preventScroll: true });
    },
  },
});
</script>

<style scoped>
.gce-page { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.gce-back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h);
  padding: 0 var(--space-2);
  background: none;
  border: 0;
  border-radius: var(--radius-control);
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.gce-back:hover { color: var(--text); background: var(--surface-raised); }
.gce-head { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.gce-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gce-name { margin: 0; font-size: var(--text-xl); font-weight: 600; overflow-wrap: anywhere; }
.gce-id { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-dim); font-size: var(--text-xs); }
.gce-id code { padding: 1px var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-raised); user-select: all; }
.gce-note { display: flex; align-items: center; gap: var(--space-2); justify-content: center; padding: var(--space-6) 0; margin: 0; color: var(--text-dim); }
.gce-hint { margin: 0; color: var(--text-dim); font-size: var(--text-sm); max-width: 64ch; }
.gce-list { margin: 0; padding-left: 18px; }
.gce-list li { overflow-wrap: anywhere; }

.gce-tabs { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.gce-tabs button {
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
.gce-tabs button:hover { background: var(--surface-raised); }
.gce-tabs button[aria-current="true"] { background: var(--accent-tint); color: var(--accent); font-weight: 600; }
.gt-title { min-width: 0; overflow-wrap: anywhere; }
.gt-n { flex: none; font-size: var(--text-xs); color: var(--text-dim); }
.gt-err { color: var(--text); font-weight: 600; box-shadow: inset 0 -2px 0 var(--danger); }

.gce-panel { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; max-width: 56rem; }
.gce-showall { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.gce-showall label { cursor: pointer; }
.gce-groupselect { display: none; }
.gce-caps { display: block; margin-bottom: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); text-transform: uppercase; letter-spacing: var(--tracking-caps); }
.gce-select {
  width: 100%;
  min-height: var(--control-h);
  padding: 0 var(--space-3);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  font: inherit;
}
@media (max-width: 1099px) {
  .gce-groupselect { display: block; }
  .gce-page :deep(.es-nav) { display: none; }
}
.gce-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  padding-bottom: var(--space-3);
  min-width: 0;
}
.gg-head { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); }
.gg-head h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
@media (pointer: coarse), (max-width: 760px) {
  .gce-tabs button { min-height: var(--touch-min); }
}
</style>
