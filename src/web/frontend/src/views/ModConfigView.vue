<template>
  <div class="view-fill modconfig-view">
    <StaleBanner
      :stale="indexStale ?? fileStale"
      write-note="You can still read and edit here, but saving needs the wrapper — your changes stay in the form until it's back."
    />
    <!-- Queued edits are their own state, not a variant of "saved". Saying
         "3 changes waiting" is the difference between an operator who knows
         their work is safe and one who thinks it has already applied. -->
    <Message
      v-if="pendingCount > 0"
      severity="info"
      :closable="false"
      class="queue-banner"
    >
      <span>
        {{ pendingCount }} {{ pendingCount === 1 ? "change is" : "changes are" }}
        waiting for the wrapper. They apply per field, so anything that didn't
        change on disk meanwhile goes through untouched.
      </span>
      <Button
        label="Apply now"
        icon="pi pi-send"
        size="small"
        :loading="flushing"
        @click="applyQueued"
      />
    </Message>

    <ConflictPicker
      :conflicts="conflicts"
      :busy="resolving"
      @resolve="onResolve"
    />

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
                <span class="mono file-name">{{ shortPath(file.relPath) }}</span>
                <Tag :value="file.format" severity="secondary" class="file-format" />
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
                {{ field.displayLabel ?? field.label }}
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
import type { EditConflict } from "../composables/useModConfigs";
import { useModConfigs, type ConfigField } from "../composables/useModConfigs";
import { useCapabilities } from "../composables/useCapabilities";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StaleBanner from "../components/ui/StaleBanner.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import EmptyState from "../components/ui/EmptyState.vue";

export default defineComponent({
  name: "ModConfigView",
  components: {
    Button, InputText, InputNumber, ToggleSwitch, Select, Chips, Message, Tag,
    ViewHeader,
    StaleBanner, ConflictPicker, EmptyState,
  },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return { ...useModConfigs(), ...useCapabilities(), toast: useToast() };
  },
  data() {
    return {
      currentServer: "",
      showHistory: false,
      flushing: false,
      resolving: "",
      queueTimer: 0 as ReturnType<typeof setInterval> | 0,
    };
  },
  computed: {
    canWrite(): boolean {
      return this.can("config:write", this.currentServer);
    },
  },
  mounted() {
    // Auto-flush can apply queued edits from the status poll while this tab is
    // open; without a poll here the banner would keep showing a count that was
    // already written. Slower cadence than the status view — the queue changes
    // far less often than a live server does.
    this.queueTimer = setInterval(() => {
      if (this.currentServer) void this.refreshPending();
    }, 15_000);
  },
  beforeUnmount() {
    if (this.queueTimer) clearInterval(this.queueTimer);
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
    async onResolve(payload: {
      conflict: EditConflict;
      choice: "queued" | "current";
    }): Promise<void> {
      this.resolving = payload.conflict.keyPath.join(".");
      try {
        await this.resolveConflict(payload.conflict, payload.choice);
        this.toast.add({
          severity: "success",
          summary:
            payload.choice === "queued"
              ? "Your value will be written on the next apply"
              : "Kept what's on disk",
          life: 4000,
        });
      } catch (err) {
        this.toast.add({
          severity: "error",
          summary: "Could not resolve",
          detail: err instanceof Error ? err.message : String(err),
          life: 6000,
        });
      } finally {
        this.resolving = "";
      }
    },
    /** Push everything held for this server, now that the wrapper answers. */
    async applyQueued(): Promise<void> {
      this.flushing = true;
      try {
        const res = await this.flushQueue();
        const conflicts = res.conflicts.length;
        this.toast.add({
          severity: conflicts > 0 ? "warn" : "success",
          summary:
            conflicts > 0
              ? `${res.applied} applied, ${conflicts} need a decision`
              : `${res.applied} queued change(s) applied`,
          detail:
            conflicts > 0
              ? "Those keys changed on disk while the edits waited — reopen the file to see where they landed."
              : "Most mods only read their config at startup — restart to apply.",
          life: 8000,
        });
        if (this.current) await this.openFile(this.current.file.id);
      } catch (err) {
        this.toast.add({
          severity: "error",
          summary: "Could not apply queued changes",
          detail: err instanceof Error ? err.message : String(err),
          life: 8000,
        });
      } finally {
        this.flushing = false;
      }
    },
    async select(id: string): Promise<void> {
      this.currentServer = id;
      this.showHistory = false;
      await Promise.all([this.loadFiles(id), this.refreshPending()]);
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
.queue-banner { margin-bottom: 12px; }
.queue-banner :deep(.p-message-text) {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.search { width: 100%; margin-bottom: 12px; }
.mb { margin-bottom: 10px; }
.pad { padding: 10px 2px; }

/* The view fills the shell's content area and the two panes divide it, so
   the page itself never scrolls behind two panes that are already scrolling. */
.modconfig-view { display: flex; flex-direction: column; }
.layout {
  display: grid; grid-template-columns: 280px 1fr; gap: 14px;
  flex: 1; min-height: 0;
}
@media (max-width: 720px) {
  .layout { grid-template-columns: 1fr; min-height: 0; }
  .files { max-height: 40vh; }
}

.files {
  height: 100%; max-height: calc(100vh - 200px); overflow-y: auto;
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
  background: none; border: none; border-radius: var(--mc-radius-sm); cursor: pointer;
  color: var(--mc-text);
}
/* Without min-width the filename pushed the format badge out of the pane and
   the list grew a horizontal scrollbar instead of eliding. */
.file-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-format { flex: none; }
.file:hover { background: var(--mc-hover); }
.file.active { background: var(--mc-hover); font-weight: 600; }

.fields {
  border: 1px solid var(--mc-border); border-radius: var(--mc-radius);
  background: var(--mc-card); padding: 12px; height: 100%; max-height: calc(100vh - 200px); overflow-y: auto;
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
.field.dirty { border-left: 2px solid var(--mc-accent); padding-left: 8px; }
.label { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 500; }
.path { color: var(--mc-muted); font-weight: 400; }
.desc { margin: 3px 0 6px; }
.control { width: 100%; max-width: 380px; }
.readonly { display: inline-block; padding: 4px 0; }
.hint { display: inline-block; margin-top: 4px; margin-right: 10px; }
</style>
