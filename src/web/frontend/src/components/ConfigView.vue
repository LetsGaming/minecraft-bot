<template>
  <div class="config">
    <div class="toolbar">
      <label>
        <input type="checkbox" v-model="rawMode" />
        raw JSON mode
      </label>
      <button class="primary" :disabled="saving" @click="save">
        {{ saving ? "Saving…" : "Save config" }}
      </button>
    </div>

    <p class="muted small">
      Secrets show as <code>{{ placeholder }}</code> — leave them untouched to
      keep the current value, type over them to change it. Changes are
      validated server-side and picked up by the running bot automatically.
    </p>

    <div v-if="errors.length" class="errors">
      <p>Validation failed:</p>
      <ul>
        <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
      </ul>
    </div>
    <div v-if="warnings.length" class="warnings">
      <ul>
        <li v-for="(warn, i) in warnings" :key="i">⚠ {{ warn }}</li>
      </ul>
    </div>
    <p v-if="saved" class="message">✓ Saved.</p>

    <textarea
      v-if="rawMode"
      v-model="rawText"
      class="raw"
      spellcheck="false"
    ></textarea>

    <div v-else-if="schema && model">
      <SchemaField
        v-for="(propSchema, key) in topLevelProps"
        :key="key"
        :name="String(key)"
        :schema="propSchema"
        :model-value="model[key]"
        @update:model-value="setTop(String(key), $event)"
      />
    </div>
    <p v-else class="muted">
      Schema unavailable — falling back to raw JSON mode.
    </p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";
import SchemaField from "./SchemaField.vue";

interface JsonSchema {
  properties?: Record<string, unknown>;
}

export default defineComponent({
  name: "ConfigView",
  components: { SchemaField },
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
      saved: false,
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
      this.saved = false;

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
        this.saved = true;
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
