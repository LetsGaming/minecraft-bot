<template>
  <div class="config">
    <ViewHeader title="Config">
      <template #subtitle>
        Full <code class="mono">config.json</code>, schema-driven. Secrets show as
        <code class="mono">{{ placeholder }}</code> — leave them to keep the current
        value. Changes are validated server-side before they are written.
      </template>
      <template #actions>
        <div class="head-actions">
          <ConfigStatusChip :refresh-key="refreshKey" />
          <div class="raw-toggle">
            <ToggleSwitch
              :model-value="rawMode"
              :disabled="schemaFailed || !ready"
              inputId="rawmode"
              @update:model-value="setRawMode"
            />
            <label for="rawmode" class="small">Raw JSON</label>
          </div>
          <Button
            label="Discard"
            icon="pi pi-undo"
            severity="secondary"
            outlined
            :disabled="!dirty || saving"
            @click="discard"
          />
          <Button
            :label="pendingCount > 0 ? `Save ${pendingCount} change${pendingCount === 1 ? '' : 's'}` : 'Save config'"
            icon="pi pi-save"
            :loading="saving"
            :disabled="!canSave"
            @click="onSave"
          />
        </div>
      </template>
    </ViewHeader>

    <div v-if="loading && !ready" class="center-note muted">
      <i class="pi pi-spin pi-spinner" /> Loading config…
    </div>

    <Message v-else-if="loadError && !ready" severity="error" :closable="false" class="cfg-msg">
      <div class="retry-row">
        <span>Could not load the config: {{ loadError }}</span>
        <Button label="Retry" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="reload" />
      </div>
    </Message>

    <template v-else-if="ready">
      <Message v-if="stale" severity="warn" :closable="false" class="cfg-msg">
        <div class="retry-row">
          <span>Your last save went through, but the page could not re-read it. Reload before editing further.</span>
          <Button label="Reload" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="reload" />
        </div>
      </Message>

      <Message v-if="errors.length" severity="error" :closable="false" class="cfg-msg">
        <ul class="msg-list">
          <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
        </ul>
      </Message>
      <Message v-if="warnings.length" severity="warn" :closable="false" class="cfg-msg">
        <ul class="msg-list">
          <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
        </ul>
      </Message>

      <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
      <div v-if="conflicts.length" class="conflict-actions">
        <Button
          label="Discard my edits and reload"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          @click="reloadDiscardingMine"
        />
      </div>

      <div v-if="!rawMode && newFeatureCount > 0" class="new-banner">
        <i class="pi pi-sparkles" />
        {{ newFeatureCount }} new feature{{ newFeatureCount === 1 ? "" : "s" }} available to enable
      </div>

      <Message v-if="schemaFailed" severity="secondary" :closable="false" class="cfg-msg">
        The schema could not be loaded, so the config is shown as raw JSON.
      </Message>

      <Textarea
        v-if="rawMode"
        :model-value="rawText"
        class="raw"
        spellcheck="false"
        autoResize
        @update:model-value="setRawText"
      />

      <div v-else-if="schema && model" class="fields">
        <div
          v-for="(propSchema, key) in topLevelProps"
          :key="key"
          :class="['section', { 'is-dirty': isDirty(String(key)), 'is-invalid': sectionErrors[String(key)] }]"
        >
          <span v-if="isDirty(String(key))" class="dirty-mark" title="Changed, not saved yet">
            <i class="pi pi-circle-fill" /> modified
          </span>
          <SchemaField
            :name="String(key)"
            :schema="propSchema"
            :definitions="schema?.definitions"
            :model-value="model[key]"
            @update:model-value="setTop(String(key), $event)"
          />
          <ul v-if="sectionErrors[String(key)]" class="field-errors">
            <li v-for="(msg, i) in sectionErrors[String(key)]" :key="i">{{ msg }}</li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, provide } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import ToggleSwitch from "primevue/toggleswitch";
import Message from "primevue/message";
import SchemaField from "../components/schema/SchemaField.vue";
import { derefNode, countNewSections, topLevelSectionKeys } from "../components/schema/schemaField";
import { isFeatureNew, commitSeenFeatures } from "../composables/useSeenFeatures";
import {
  useSchemaRefs,
  SchemaRefsKey,
  MapKeyLabelKey,
  SchemaScopeKey,
} from "../composables/useSchemaRefs";
import { useGuilds } from "../composables/useGuilds";
import ViewHeader from "../components/ui/ViewHeader.vue";
import ConfigStatusChip from "../components/ui/ConfigStatusChip.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import { useConfig } from "../composables/useConfig";

export default defineComponent({
  name: "ConfigView",
  components: {
    SchemaField, Button, Textarea, ToggleSwitch, Message, ViewHeader, ConfigStatusChip, ConflictPicker,
  },
  props: {
    /** Raw JSON mode, as the URL (`#/config/raw`) asks for it. */
    raw: { type: Boolean, default: false },
  },
  emits: ["update-route"],
  setup() {
    // Provide server options so ID fields (defaultServer, allowedServers, the
    // per-feature `server` scope) render as name dropdowns. Channels/roles are
    // guild-scoped and have no single-guild context here, so those stay text.
    const refsApi = useSchemaRefs();
    const { guildName, load: loadGuildNames } = useGuilds();

    // Global scope for the top-level fields (servers, language, timezone…),
    // which have no guild and should say so rather than look unloaded.
    provide(SchemaRefsKey, refsApi.globalScope);

    // Name the `guilds` map's entries from the same source the Guilds page
    // uses, so the two surfaces cannot disagree about what a guild is called.
    provide(MapKeyLabelKey, (mapName: string, key: string) =>
      mapName === "guilds" ? guildName(key) : undefined,
    );

    // Give each guild entry its own channels and roles. This is what closes
    // the gap between this page and the single-guild modal: the same
    // `channelId` field now renders as a #channel picker in both, and a
    // picker inside one guild can only ever offer that guild's channels.
    provide(SchemaScopeKey, (mapName: string, key: string) =>
      mapName === "guilds" ? refsApi.scopeForGuild(key) : undefined,
    );

    return {
      ...useConfig(),
      loadServerRefs: refsApi.loadServers,
      loadGuildNames,
    };
  },
  data() {
    return { refreshKey: 0 };
  },
  computed: {
    topLevelProps(): Record<string, unknown> {
      // The generated schema is a root `$ref` (topRef) to RawBotConfig, so
      // resolve it before reading properties — otherwise the form is empty.
      return derefNode(this.schema, this.schema?.definitions).properties ?? {};
    },
    // Feature sections the schema defines that this config has never set —
    // the count behind the "new features available" banner.
    newFeatureCount(): number {
      if (!this.schema || !this.model) return 0;
      return countNewSections(
        this.topLevelProps,
        this.model,
        this.schema.definitions,
        isFeatureNew,
      );
    },
  },
  watch: {
    raw() {
      this.applyRouteMode();
    },
    rawMode(on: boolean) {
      if (on !== this.raw) this.$emit("update-route", { params: { mode: on ? "raw" : undefined } });
    },
  },
  methods: {
    /** Follows the URL's mode; leaving raw mode with unparsable text is
     *  refused, and then the URL follows the editor instead. */
    applyRouteMode(): void {
      if (!this.model || this.schemaFailed) return;
      this.setRawMode(this.raw);
      if (this.rawMode !== this.raw) {
        this.$emit("update-route", { params: { mode: this.rawMode ? "raw" : undefined } });
      }
    },
    async onSave(): Promise<void> {
      if (await this.save()) this.refreshKey += 1;
    },
    async reload(): Promise<void> {
      await this.load();
    },
  },
  async mounted() {
    await Promise.all([this.load(), this.loadServerRefs(), this.loadGuildNames()]);
    this.applyRouteMode();
    // Now that the schema is loaded, mark its feature keys seen so a later
    // visit only flags genuinely new additions (this session's badges are held
    // by the frozen snapshot in useSeenFeatures).
    if (this.schema) {
      commitSeenFeatures(topLevelSectionKeys(this.topLevelProps, this.schema.definitions));
    }
  },
});
</script>

<style scoped>
.head-actions { display: flex; align-items: center; gap: 16px; flex: none; }
.raw-toggle { display: flex; align-items: center; gap: 8px; }
.cfg-msg { margin-bottom: 16px; }
.center-note { display: flex; align-items: center; gap: 8px; padding: 24px 0; }
.retry-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.conflict-actions { margin: -6px 0 14px; }
.section { position: relative; }
.section.is-dirty { box-shadow: -3px 0 0 0 var(--mc-accent); padding-left: 10px; margin-left: -13px; }
.dirty-mark { position: absolute; right: 0; top: 0; font-size: 11px; color: var(--mc-accent); }
.dirty-mark .pi { font-size: 6px; vertical-align: middle; }
.field-errors { margin: 4px 0 10px; padding-left: 18px; color: var(--danger); font-size: 12.5px; }
.msg-list { margin: 0; padding-left: 18px; }
.raw {
  width: 100%; min-height: 520px;
  background: var(--bg-code) !important; color: var(--mc-text);
  border: 1px solid var(--mc-border); border-radius: 10px; padding: 14px;
  font: 13px/1.55 ui-monospace, monospace;
}
.fields { display: flex; flex-direction: column; }
.new-banner {
  display: flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--mc-accent) 12%, transparent);
  color: var(--mc-accent);
  border: 1px solid color-mix(in srgb, var(--mc-accent) 28%, transparent);
  border-radius: 8px; padding: 8px 12px; font-size: 13px; margin-bottom: 14px;
}
</style>
