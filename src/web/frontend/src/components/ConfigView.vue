<template>
  <div class="config">
    <div class="view-head">
      <div>
        <h2>Config</h2>
        <p class="muted small">
          Full <code class="mono">config.json</code>, schema-driven. Secrets show as
          <code class="mono">{{ placeholder }}</code> — leave them to keep the current
          value. Changes are validated server-side and picked up automatically.
        </p>
      </div>
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
    </div>

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
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";
import SchemaField from "./SchemaField.vue";

interface JsonSchema {
  properties?: Record<string, unknown>;
}

export default defineComponent({
  name: "ConfigView",
  components: { SchemaField, Button, Textarea, ToggleSwitch, Message },
  data() {
    return {
      placeholder: "•••••",
      schema: null as JsonSchema | null,
      model: null as Record<string, unknown> | null,
      rawMode: false,
      rawText: "",
      baseHash: "",
      errors: [] as string[],
      warnings: [] as string[],
      saving: false,
    };
  },
  computed: {
    topLevelProps(): Record<string, unknown> {
      return this.schema?.properties ?? {};
    },
  },
  watch: {
    rawMode(on: boolean) {
      if (on && this.model) {
        this.rawText = JSON.stringify(this.model, null, 2);
      } else if (!on) {
        try {
          this.model = JSON.parse(this.rawText);
        } catch {
          this.errors = ["Raw JSON does not parse — staying in raw mode."];
          this.rawMode = true;
        }
      }
    },
  },
  async mounted() {
    try {
      const res = await apiGet<ConfigResponse>("/api/config");
      this.model = res.config as Record<string, unknown>;
      this.baseHash = res.hash;
      this.rawText = JSON.stringify(this.model, null, 2);
    } catch (err) {
      this.errors = [`Could not load config: ${(err as Error).message}`];
      return;
    }
    try {
      this.schema = await apiGet<JsonSchema>("/api/config/schema");
    } catch {
      this.schema = null;
      this.rawMode = true;
    }
  },
  methods: {
    async reloadConfig() {
      const res = await apiGet<ConfigResponse>("/api/config");
      this.model = res.config as Record<string, unknown>;
      this.baseHash = res.hash;
      if (this.rawMode) this.rawText = JSON.stringify(this.model, null, 2);
    },
    setTop(key: string, value: unknown) {
      if (!this.model) return;
      if (value === undefined) delete this.model[key];
      else this.model[key] = value;
    },
    async save() {
      this.errors = [];
      this.warnings = [];

      let body: unknown = this.model;
      if (this.rawMode) {
        try {
          body = JSON.parse(this.rawText);
        } catch (err) {
          this.errors = [`Raw JSON does not parse: ${(err as Error).message}`];
          return;
        }
      }

      this.saving = true;
      try {
        const res = await apiSend<{ ok: boolean; warnings: string[] }>(
          "PUT",
          "/api/config",
          { baseHash: this.baseHash, config: body },
        );
        this.warnings = res.warnings;
        this.$toast.add({
          severity: "success",
          summary: "Config saved",
          detail: "The running bot will reload it automatically.",
          life: 3000,
        });
        await this.reloadConfig();
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes("changed since you loaded it")) {
          // 409: someone else wrote config.json underneath this editor.
          // Surface it and refresh the baseline so the next save can work
          // once the admin has re-applied their changes.
          this.errors = [message];
          await this.reloadConfig().catch(() => {});
        } else {
          this.errors = message.startsWith("[")
            ? (JSON.parse(message) as string[])
            : [message];
        }
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.view-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 24px; }
.view-head h2 { margin: 0 0 3px; font-size: 18px; font-weight: 500; }
.view-head p { margin: 0; max-width: 70ch; }
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
