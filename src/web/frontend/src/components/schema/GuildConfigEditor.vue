<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('guildEditor.title', { name: guildName || guildId })"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    :dismissable-mask="false"
    @update:visible="onVisible"
  >
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

    <EditorShell v-else :state="editorState">
      <template #banners>
        <p class="gce-hint">{{ t("guildEditor.hint") }}</p>
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

      <div v-if="model && hasFields" class="gce-fields">
        <SchemaField
          v-for="(propSchema, key) in topLevelProps"
          :key="key"
          :name="String(key)"
          :schema="propSchema"
          :definitions="definitions"
          :key-path="[String(key)]"
          :model-value="model[key]"
          @update:model-value="setField(String(key), $event)"
        />
      </div>
    </EditorShell>

    <template #footer>
      <EditBar
        class="gce-bar"
        :docked="false"
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
        <template #extra>
          <Button :label="t('guildEditor.close')" severity="secondary" text class="tap" @click="requestClose" />
        </template>
      </EditBar>
    </template>
  </Dialog>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, provide } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import SchemaField from "./SchemaField.vue";
import ConflictPicker from "./ConflictPicker.vue";
import ConfigStatusChip from "../ui/ConfigStatusChip.vue";
import EditorShell from "../ui/EditorShell.vue";
import EditBar from "../ui/EditBar.vue";
import InlineBanner from "../ui/InlineBanner.vue";
import InlineError from "../ui/InlineError.vue";
import type { EditorState } from "../ui/types";
import { useConfirm } from "primevue/useconfirm";
import { derefNode, countNewSections, topLevelSectionKeys } from "./schemaField";
import { isFeatureNew, commitSeenFeatures } from "../../composables/useSeenFeatures";
import { useGuildConfig } from "../../composables/useGuildConfig";
import { useSchemaRefs, SchemaRefsKey } from "../../composables/useSchemaRefs";
import { useSchemaForm } from "../../composables/useSchemaForm";
import { t } from "../../i18n";

export default defineComponent({
  name: "GuildConfigEditor",
  components: {
    Dialog, Button, SchemaField, ConflictPicker, ConfigStatusChip, EditorShell, EditBar,
    InlineBanner, InlineError,
  },
  props: {
    visible: { type: Boolean, required: true },
    guildId: { type: String, default: "" },
    guildName: { type: String, default: "" },
  },
  emits: ["update:visible", "saved"],
  setup(props) {
    // Named-entity options (servers plus this guild's channels and roles) so
    // ID fields render as name dropdowns. The scope follows the prop: this
    // dialog is one instance reused for every guild.
    const refsApi = useSchemaRefs();
    provide(SchemaRefsKey, refsApi.dynamicGuildScope(() => props.guildId));

    const guild = useGuildConfig();
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
      stripPath: (path) => (path[0] === "guilds" && path[1] === props.guildId ? path.slice(2) : path),
      isSecret: () => false,
      idPrefix: "gce",
    });

    return {
      ...guild,
      t,
      topLevelProps,
      problems: form.problems,
      issues: form.issues,
      changes: form.changes,
      generalErrors: form.generalErrors,
      reveal: form.reveal,
      formContext: form.context,
      confirm: useConfirm(),
      loadServers: refsApi.loadServers,
      loadGuildRefs: refsApi.loadGuildRefs,
    };
  },
  data() {
    return { savedCount: 0 };
  },
  computed: {
    hasFields(): boolean {
      return Object.keys(this.topLevelProps).length > 0;
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
    async visible(open: boolean): Promise<void> {
      if (open && this.guildId) {
        await Promise.all([
          this.load(this.guildId),
          this.loadServers(),
          this.loadGuildRefs(this.guildId),
        ]);
        commitSeenFeatures(topLevelSectionKeys(this.topLevelProps, this.definitions));
      }
    },
  },
  methods: {
    async onSave(): Promise<void> {
      const ok = await this.save();
      if (ok) {
        this.savedCount += 1;
        this.$emit("saved");
        this.$emit("update:visible", false);
      }
    },
    async goToFirstProblem(): Promise<void> {
      const first = this.issues[0];
      if (!first) return;
      this.reveal(first.path);
      await nextTick();
      const el = document.getElementById(this.formContext.idFor(first.path));
      el?.scrollIntoView({ block: "center" });
      const target = el?.matches("input, textarea, select, button, [tabindex]")
        ? el
        : el?.querySelector<HTMLElement>("input, textarea, select, button");
      target?.focus({ preventScroll: true });
    },
    onVisible(open: boolean): void {
      if (open) this.$emit("update:visible", true);
      else this.requestClose();
    },
    requestClose(): void {
      const close = (): void => {
        this.discard();
        this.$emit("update:visible", false);
      };
      if (!this.dirty) {
        close();
        return;
      }
      this.confirm.require({
        header: t("leave.header"),
        message: t("guildEditor.discardMessage", { count: this.changes.length || 1 }),
        icon: "pi pi-exclamation-triangle",
        acceptLabel: t("editor.discard"),
        rejectLabel: t("guildEditor.keepEditing"),
        acceptProps: { severity: "danger" },
        rejectProps: { severity: "secondary", outlined: true },
        accept: close,
      });
    },
  },
});
</script>

<style scoped>
.gce-note { display: flex; align-items: center; gap: var(--space-2); justify-content: center; padding: var(--space-6) 0; margin: 0; color: var(--text-dim); }
.gce-hint { margin: 0; color: var(--text-dim); font-size: var(--text-sm); max-width: 64ch; }
.gce-list { margin: 0; padding-left: 18px; }
.gce-list li { overflow-wrap: anywhere; }
.gce-fields { display: flex; flex-direction: column; min-width: 0; }
.gce-bar { width: 100%; }
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
}
</style>
