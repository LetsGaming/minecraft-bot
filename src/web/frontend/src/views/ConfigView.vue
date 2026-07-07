<template>
  <div class="config">
    <ViewHeader title="Config">
      <template #subtitle>
        Full <code class="mono">config.json</code>, schema-driven. Secrets show as
        <code class="mono">{{ placeholder }}</code> — leave them to keep the current
        value. Changes are validated server-side and picked up automatically.
      </template>
      <template #actions>
        <div class="head-actions">
          <div class="raw-toggle">
            <ToggleSwitch v-model="rawMode" inputId="rawmode" />
            <label for="rawmode" class="small">Raw JSON</label>
          </div>
          <Button
            label="Save config"
            icon="pi pi-save"
            :loading="saving"
            :disabled="saving"
            @click="save"
          />
        </div>
      </template>
    </ViewHeader>

    <Message v-if="errors.length" severity="error" :closable="false" class="cfg-msg">
      <p style="margin: 0 0 6px">Validation failed:</p>
      <ul class="msg-list">
        <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
      </ul>
    </Message>
    <Message v-if="warnings.length" severity="warn" :closable="false" class="cfg-msg">
      <ul class="msg-list">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </Message>

    <Textarea
      v-if="rawMode"
      v-model="rawText"
      class="raw"
      spellcheck="false"
      autoResize
    />

    <div v-else-if="schema && model" class="fields">
      <SchemaField
        v-for="(propSchema, key) in topLevelProps"
        :key="key"
        :name="String(key)"
        :schema="propSchema"
        :model-value="model[key]"
        @update:model-value="setTop(String(key), $event)"
      />
    </div>
    <Message v-else severity="secondary" :closable="false">
      Schema unavailable — falling back to raw JSON mode.
    </Message>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import ToggleSwitch from "primevue/toggleswitch";
import Message from "primevue/message";
import SchemaField from "../components/SchemaField.vue";
import ViewHeader from "../components/ViewHeader.vue";
import { useConfig } from "../composables/useConfig";

export default defineComponent({
  name: "ConfigView",
  components: { SchemaField, Button, Textarea, ToggleSwitch, Message, ViewHeader },
  setup() {
    return { ...useConfig() };
  },
  computed: {
    topLevelProps(): Record<string, unknown> {
      return this.schema?.properties ?? {};
    },
  },
  async mounted() {
    await this.load();
  },
});
</script>

<style scoped>
.head-actions { display: flex; align-items: center; gap: 16px; flex: none; }
.raw-toggle { display: flex; align-items: center; gap: 8px; }
.cfg-msg { margin-bottom: 16px; }
.msg-list { margin: 0; padding-left: 18px; }
.raw {
  width: 100%; min-height: 520px;
  background: #0e100e !important; color: var(--mc-text);
  border: 1px solid var(--mc-border); border-radius: 10px; padding: 14px;
  font: 13px/1.55 ui-monospace, monospace;
}
.fields { display: flex; flex-direction: column; }
</style>
