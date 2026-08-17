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

    <div v-if="!rawMode && newFeatureCount > 0" class="new-banner">
      <i class="pi pi-sparkles" />
      {{ newFeatureCount }} new feature{{ newFeatureCount === 1 ? "" : "s" }} available to enable
    </div>

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
        :definitions="schema?.definitions"
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
import { useConfig } from "../composables/useConfig";

export default defineComponent({
  name: "ConfigView",
  components: { SchemaField, Button, Textarea, ToggleSwitch, Message, ViewHeader },
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
  async mounted() {
    await Promise.all([this.load(), this.loadServerRefs(), this.loadGuildNames()]);
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
.msg-list { margin: 0; padding-left: 18px; }
.raw {
  width: 100%; min-height: 520px;
  background: #0e100e !important; color: var(--mc-text);
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
