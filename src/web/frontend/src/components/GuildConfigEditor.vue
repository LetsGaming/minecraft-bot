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
import { derefNode } from "./schemaField";
import { useGuildConfig } from "../composables/useGuildConfig";
import { useSchemaRefs, SchemaRefsKey } from "../composables/useSchemaRefs";

export default defineComponent({
  name: "GuildConfigEditor",
  components: { Dialog, Button, Message, SchemaField },
  props: {
    visible: { type: Boolean, required: true },
    guildId: { type: String, default: "" },
    guildName: { type: String, default: "" },
  },
  emits: ["update:visible", "saved"],
  setup() {
    // Provide named-entity options (servers + this guild's channels/roles) so
    // SchemaField renders ID fields as name dropdowns instead of text boxes.
    const refsApi = useSchemaRefs();
    provide(SchemaRefsKey, refsApi.refs);
    return {
      ...useGuildConfig(),
      loadServers: refsApi.loadServers,
      loadGuildRefs: refsApi.loadGuild,
    };
  },
  computed: {
    topLevelProps(): Record<string, unknown> {
      // The GuildConfig node's properties (notifications, tpsAlerts, …). The
      // node may be a $ref, so resolve it first (same as ConfigView's root).
      return derefNode(this.schema, this.definitions).properties ?? {};
    },
  },
  watch: {
    visible(open: boolean): void {
      if (open && this.guildId) {
        void this.load(this.guildId);
        void this.loadServers();
        void this.loadGuildRefs(this.guildId);
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
</style>
