<template>
  <Dialog
    :visible="visible"
    modal
    :header="`Edit config — ${guildName || guildId}`"
    :style="{ width: '680px' }"
    :dismissable-mask="false"
    @update:visible="onVisible"
  >
    <div v-if="loading && !ready" class="gce-center">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.4rem" />
    </div>

    <Message v-else-if="loadError && !ready" severity="error" :closable="false">
      <div class="gce-retry">
        <span>Could not load this guild's config: {{ loadError }}</span>
        <Button label="Retry" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="retry" />
      </div>
    </Message>

    <template v-else>
      <p class="gce-hint">
        Every feature for this guild. Leave a channel blank to turn a feature
        off. Changes apply to this guild only.
      </p>

      <Message v-if="stale" severity="warn" :closable="false">
        Your last save went through, but it could not be re-read. Close and reopen this editor before changing more.
      </Message>
      <Message
        v-for="(e, i) in errors"
        :key="'e' + i"
        severity="error"
        :closable="false"
        >{{ e }}</Message
      >
      <Message
        v-for="(w, i) in warnings"
        :key="'w' + i"
        severity="warn"
        :closable="false"
        >{{ w }}</Message
      >

      <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
      <div v-if="conflicts.length" class="gce-conflict-actions">
        <Button
          label="Discard my edits and reload"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          @click="reloadDiscardingMine"
        />
      </div>

      <div v-if="newFeatureCount > 0" class="gce-new-banner">
        <i class="pi pi-sparkles" />
        {{ newFeatureCount }} new feature{{ newFeatureCount === 1 ? "" : "s" }} available to enable
      </div>

      <div v-if="model && Object.keys(topLevelProps).length" class="gce-fields">
        <div
          v-for="(propSchema, key) in topLevelProps"
          :key="key"
          :class="['gce-section', { 'is-dirty': isDirty(String(key)) }]"
        >
          <SchemaField
            :name="String(key)"
            :schema="propSchema"
            :definitions="definitions"
            :model-value="model[key]"
            @update:model-value="setField(String(key), $event)"
          />
          <ul v-if="sectionErrors[String(key)]" class="gce-field-errors">
            <li v-for="(msg, i) in sectionErrors[String(key)]" :key="i">{{ msg }}</li>
          </ul>
        </div>
      </div>
      <p v-else-if="model" class="gce-hint">
        {{ schemaError ? `Schema unavailable (${schemaError}).` : "Schema unavailable." }}
        <a href="#" @click.prevent="retry">Retry</a>
      </p>
    </template>

    <template #footer>
      <ConfigStatusChip :refresh-key="savedCount" />
      <Button label="Cancel" text @click="requestClose" />
      <Button
        :label="pendingCount > 0 ? `Save ${pendingCount} change${pendingCount === 1 ? '' : 's'}` : 'Save'"
        icon="pi pi-check"
        :loading="saving"
        :disabled="!canSave"
        @click="onSave"
      />
    </template>
  </Dialog>
</template>

<script lang="ts">
import { defineComponent, provide } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Message from "primevue/message";
import SchemaField from "./SchemaField.vue";
import ConflictPicker from "./ConflictPicker.vue";
import ConfigStatusChip from "../ui/ConfigStatusChip.vue";
import { useConfirm } from "primevue/useconfirm";
import { derefNode, countNewSections, topLevelSectionKeys } from "./schemaField";
import { isFeatureNew, commitSeenFeatures } from "../../composables/useSeenFeatures";
import { useGuildConfig } from "../../composables/useGuildConfig";
import { useSchemaRefs, SchemaRefsKey } from "../../composables/useSchemaRefs";

export default defineComponent({
  name: "GuildConfigEditor",
  components: { Dialog, Button, Message, SchemaField, ConflictPicker, ConfigStatusChip },
  props: {
    visible: { type: Boolean, required: true },
    guildId: { type: String, default: "" },
    guildName: { type: String, default: "" },
  },
  emits: ["update:visible", "saved"],
  setup(props) {
    // Provide named-entity options (servers + this guild's channels/roles) so
    // SchemaField renders ID fields as name dropdowns instead of text boxes.
    // The scope is a live view onto the shared per-guild cache, so it is the
    // same object the config page hands its matching entry: one guild, one
    // channel list, whichever editor you opened.
    const refsApi = useSchemaRefs();
    // Follows the prop: this dialog is one instance reused for every guild,
    // so a scope captured at setup would pin it to whichever opened first.
    provide(SchemaRefsKey, refsApi.dynamicGuildScope(() => props.guildId));
    return {
      ...useGuildConfig(),
      confirm: useConfirm(),
      loadServers: refsApi.loadServers,
      loadGuildRefs: refsApi.loadGuildRefs,
    };
  },
  data() {
    return { savedCount: 0 };
  },
  computed: {
    topLevelProps(): Record<string, unknown> {
      // The GuildConfig node's properties (notifications, tpsAlerts, …). The
      // node may be a $ref, so resolve it first (same as ConfigView's root).
      return derefNode(this.schema, this.definitions).properties ?? {};
    },
    newFeatureCount(): number {
      if (!this.model) return 0;
      return countNewSections(this.topLevelProps, this.model, this.definitions, isFeatureNew);
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
        header: "Discard unsaved changes?",
        message: `You have ${this.pendingCount} unsaved change${this.pendingCount === 1 ? "" : "s"} in this guild's config.`,
        icon: "pi pi-exclamation-triangle",
        acceptLabel: "Discard",
        rejectLabel: "Keep editing",
        acceptProps: { severity: "danger" },
        rejectProps: { severity: "secondary", outlined: true },
        accept: close,
      });
    },
  },
});
</script>

<style scoped>
.gce-center {
  display: flex;
  justify-content: center;
  padding: 2rem;
}
.gce-hint {
  color: var(--muted, #8a929c);
  font-size: 0.9rem;
  margin: 0 0 1rem;
}
.gce-fields {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.gce-retry { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.gce-conflict-actions { margin: -6px 0 12px; }
.gce-section.is-dirty { box-shadow: -3px 0 0 0 var(--mc-accent); padding-left: 10px; margin-left: -13px; }
.gce-field-errors { margin: 2px 0 8px; padding-left: 18px; color: var(--p-red-400, #f87171); font-size: 12.5px; }
.gce-new-banner {
  display: flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--mc-accent) 12%, transparent);
  color: var(--mc-accent);
  border: 1px solid color-mix(in srgb, var(--mc-accent) 28%, transparent);
  border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; margin-bottom: 1rem;
}
</style>
