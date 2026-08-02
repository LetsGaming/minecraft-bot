<template>
  <div>
    <ViewHeader title="Mod Config" subtitle="Edit mod settings without touching the files.">
      <template #actions>
        <Button
          v-if="canWrite && dirty"
          label="Discard"
          size="small"
          severity="secondary"
          text
          @click="discard"
        />
        <Button
          v-if="canWrite"
          :label="dirty ? `Save ${Object.keys(pending).length} change(s)` : 'Saved'"
          icon="pi pi-check"
          size="small"
          :loading="saving"
          :disabled="!dirty"
          @click="onSave"
        />
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server">
      No servers you can view.
    </EmptyState>

    <template v-else>
      <div v-if="serverIds.length > 1" class="picker">
        <Button
          v-for="id in serverIds"
          :key="id"
          :label="id"
          size="small"
          :severity="id === currentServer ? 'primary' : 'secondary'"
          :outlined="id !== currentServer"
          @click="select(id)"
        />
      </div>

      <InputText
        v-model="search"
        placeholder="Search settings across every mod…"
        class="search"
      />

      <Message v-if="error" severity="error" :closable="false" class="mb">{{ error }}</Message>

      <div class="layout">
        <!-- Files, grouped by mod. -->
        <aside class="files">
          <div v-if="loading && !current" class="muted small pad">Loading…</div>
          <EmptyState v-else-if="byMod.length === 0" icon="pi pi-file">
            No editable config files.
          </EmptyState>
          <template v-else>
            <div v-for="group in byMod" :key="group.modId" class="group">
              <div class="mod">{{ group.modId }}</div>
              <button
                v-for="file in group.entries"
                :key="file.id"
                :class="['file', { active: current?.file.id === file.id }]"
                @click="openFile(file.id)"
              >
                <span class="mono">{{ shortPath(file.relPath) }}</span>
                <Tag :value="file.format" severity="secondary" />
              </button>
            </div>
          </template>
        </aside>

        <!-- The selected file, as a form. -->
        <section class="fields">
          <EmptyState v-if="!current" icon="pi pi-sliders-h">
            Pick a file to edit.
          </EmptyState>
          <template v-else>
            <div class="filehead">
              <span class="mono">{{ current.file.relPath }}</span>
              <Button
                v-if="canWrite && current.snapshots.length > 0"
                :label="`History (${current.snapshots.length})`"
                icon="pi pi-history"
                size="small"
                severity="secondary"
                text
                @click="showHistory = !showHistory"
              />
            </div>

            <Message
              v-if="current.warning"
              severity="warn"
              :closable="false"
              class="mb"
            >{{ current.warning }}</Message>

            <div v-if="showHistory" class="history">
              <div v-for="snap in current.snapshots" :key="snap" class="snap">
                <span class="mono small">{{ formatStamp(snap) }}</span>
                <Button
                  label="Revert to this"
                  size="small"
                  severity="danger"
                  text
                  :loading="saving"
                  @click="onRevert(snap)"
                />
              </div>
            </div>

            <p v-if="!canWrite" class="muted small pad">
              You have read-only access to this server's configs.
            </p>

            <EmptyState v-if="visibleFields.length === 0" icon="pi pi-search">
              Nothing matches that search.
            </EmptyState>

            <div
              v-for="field in visibleFields"
              :key="field.path.join('.')"
              :class="['field', { dirty: isDirty(field) }]"
            >
              <label class="label">
                {{ field.label }}
                <span class="path mono small">{{ field.path.join(".") }}</span>
              </label>
              <p v-if="field.description" class="muted small desc">{{ field.description }}</p>

              <!-- Allowed Values from the mod's own comments → a real select. -->
              <Select
                v-if="field.options"
                :model-value="stringValue(field)"
                :options="field.options"
                :disabled="!canWrite || field.readOnly"
                class="control"
                @update:model-value="setFromInput(field, $event)"
              />
              <ToggleSwitch
                v-else-if="field.kind === 'boolean'"
                :model-value="boolValue(field)"
                :disabled="!canWrite || field.readOnly"
                @update:model-value="setFromInput(field, $event)"
              />
              <InputNumber
                v-else-if="field.kind === 'number'"
                :model-value="numberValue(field)"
                :min="field.min"
                :max="field.max"
                :max-fraction-digits="4"
                :disabled="!canWrite || field.readOnly"
                class="control"
                @update:model-value="setFromInput(field, $event)"
              />
              <Chips
                v-else-if="field.kind === 'stringList' || field.kind === 'numberList'"
                :model-value="listValue(field)"
                :disabled="!canWrite || field.readOnly"
                class="control"
                @update:model-value="setFromInput(field, $event)"
              />
              <InputText
                v-else-if="field.kind === 'string'"
                :model-value="stringValue(field)"
                :disabled="!canWrite || field.readOnly"
                class="control"
                @update:model-value="setFromInput(field, $event)"
              />
              <!-- Anything the adapter could not type stays read-only rather
                   than becoming a text box that can corrupt the file. -->
              <span v-else class="mono small readonly">
                {{ stringValue(field) }} <em class="muted">(not editable here)</em>
              </span>

              <span v-if="field.min !== undefined" class="muted small hint">
                Range {{ field.min }} – {{ field.max }}
              </span>
              <span v-if="field.default" class="muted small hint">
                Default {{ field.default }}
              </span>
            </div>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import ToggleSwitch from "primevue/toggleswitch";
import Select from "primevue/select";
import Chips from "primevue/chips";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";
import { useModConfigs, type ConfigField } from "../composables/useModConfigs";
import { useCapabilities } from "../composables/useCapabilities";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";

export default defineComponent({
  name: "ModConfigView",
  components: {
    Button, InputText, InputNumber, ToggleSwitch, Select, Chips, Message, Tag,
    ViewHeader, EmptyState,
  },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return { ...useModConfigs(), ...useCapabilities(), toast: useToast() };
  },
  data() {
    return { currentServer: "", showHistory: false };
  },
  computed: {
    canWrite(): boolean {
      return this.can("config:write", this.currentServer);
    },
  },
  watch: {
    activeServer(id: string) {
      if (id && id !== this.currentServer) void this.select(id);
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (!this.currentServer && ids.length > 0) {
          void this.select(
            this.activeServer && ids.includes(this.activeServer)
              ? this.activeServer
              : ids[0]!,
          );
        }
      },
    },
  },
  methods: {
    async select(id: string): Promise<void> {
      this.currentServer = id;
      this.showHistory = false;
      await this.loadFiles(id);
    },
    /** `config/jei-client.toml` → `jei-client.toml`, mod shown by the group. */
    shortPath(relPath: string): string {
      return relPath.split("/").pop() ?? relPath;
    },
    formatStamp(stamp: string): string {
      const iso = stamp.replace(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/,
        "$1-$2-$3 $4:$5:$6",
      );
      return iso === stamp ? stamp : iso;
    },
    async onSave(): Promise<void> {
      const changes = Object.keys(this.pending).length;
      const ok = await this.save();
      this.toast.add({
        severity: ok ? "success" : "error",
        summary: ok ? `Saved ${changes} change(s)` : "Save failed",
        detail: ok
          ? "Most mods only read their config at startup — restart to apply."
          : this.error,
        life: ok ? 6000 : 8000,
      });
    },
    async onRevert(snapshot: string): Promise<void> {
      const ok = await this.revert(snapshot);
      this.showHistory = false;
      this.toast.add({
        severity: ok ? "success" : "error",
        summary: ok ? "Reverted" : "Revert failed",
        detail: ok ? this.formatStamp(snapshot) : this.error,
        life: 5000,
      });
    },
    setValueTyped(field: ConfigField, value: unknown): void {
      this.setValue(field, value);
    },
  },
});
</script>

<style scoped>
.picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.search { width: 100%; margin-bottom: 12px; }
.mb { margin-bottom: 10px; }
.pad { padding: 10px 2px; }

.layout { display: grid; grid-template-columns: 260px 1fr; gap: 14px; align-items: start; }
@media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }

.files {
  max-height: 70vh; overflow-y: auto;
  border: 1px solid var(--mc-border); border-radius: var(--mc-radius);
  background: var(--mc-card); padding: 6px;
}
.group { margin-bottom: 8px; }
.mod {
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--mc-muted); padding: 4px 6px;
}
.file {
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
  width: 100%; text-align: left; padding: 5px 6px; font-size: 12px;
  background: none; border: none; border-radius: 5px; cursor: pointer;
  color: var(--mc-text);
}
.file:hover { background: var(--mc-hover, rgba(127,127,127,.12)); }
.file.active { background: var(--mc-hover, rgba(127,127,127,.18)); font-weight: 600; }

.fields {
  border: 1px solid var(--mc-border); border-radius: var(--mc-radius);
  background: var(--mc-card); padding: 12px; max-height: 70vh; overflow-y: auto;
}
.filehead {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--mc-border);
}
.history { padding: 6px 0 10px; }
.snap {
  display: flex; justify-content: space-between; align-items: center;
  padding: 3px 0;
}

.field { padding: 10px 0; border-bottom: 1px solid var(--mc-border); }
.field:last-child { border-bottom: none; }
.field.dirty { border-left: 2px solid var(--mc-accent, #3b82f6); padding-left: 8px; }
.label { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 500; }
.path { color: var(--mc-muted); font-weight: 400; }
.desc { margin: 3px 0 6px; }
.control { width: 100%; max-width: 380px; }
.readonly { display: inline-block; padding: 4px 0; }
.hint { display: inline-block; margin-top: 4px; margin-right: 10px; }
</style>
