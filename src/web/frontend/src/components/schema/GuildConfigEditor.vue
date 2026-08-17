<template>
  <Dialog
    :visible="visible"
    modal
    :header="`Edit config — ${guildName || guildId}`"
    :style="{ width: '680px' }"
    :dismissable-mask="false"
    @update:visible="$emit('update:visible', $event)"
  >
    <div v-if="loading" class="gce-center">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.4rem" />
    </div>

    <template v-else>
      <p class="gce-hint">
        Every feature for this guild. Leave a channel blank to turn a feature
        off. Changes apply to this guild only.
      </p>

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

      <div v-if="!loading && newFeatureCount > 0" class="gce-new-banner">
        <i class="pi pi-sparkles" />
        {{ newFeatureCount }} new feature{{ newFeatureCount === 1 ? "" : "s" }} available to enable
      </div>

      <div v-if="model && Object.keys(topLevelProps).length" class="gce-fields">
        <SchemaField
          v-for="(propSchema, key) in topLevelProps"
          :key="key"
          :name="String(key)"
          :schema="propSchema"
          :definitions="definitions"
          :model-value="model[key]"
          @update:model-value="setField(String(key), $event)"
        />
      </div>
      <p v-else-if="model" class="gce-hint">
        Schema unavailable — regenerate it to edit this guild here.
      </p>
    </template>

    <template #footer>
      <Button label="Cancel" text @click="$emit('update:visible', false)" />
      <Button
        label="Save"
        icon="pi pi-check"
        :loading="saving"
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
import { derefNode, countNewSections, topLevelSectionKeys } from "./schemaField";
import { isFeatureNew, commitSeenFeatures } from "../../composables/useSeenFeatures";
import { useGuildConfig } from "../../composables/useGuildConfig";
import { useSchemaRefs, SchemaRefsKey } from "../../composables/useSchemaRefs";

export default defineComponent({
  name: "GuildConfigEditor",
  components: { Dialog, Button, Message, SchemaField },
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
      loadServers: refsApi.loadServers,
      loadGuildRefs: refsApi.loadGuildRefs,
    };
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
        this.$emit("saved");
        this.$emit("update:visible", false);
      }
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
.gce-new-banner {
  display: flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--mc-accent) 12%, transparent);
  color: var(--mc-accent);
  border: 1px solid color-mix(in srgb, var(--mc-accent) 28%, transparent);
  border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; margin-bottom: 1rem;
}
</style>
