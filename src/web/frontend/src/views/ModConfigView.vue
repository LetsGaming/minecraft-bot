<template>
  <div class="view-fill modconfig-view">
    <StaleBanner
      :stale="indexStale ?? fileStale"
      write-note="You can still read and edit here, but saving needs the wrapper. Your changes stay in the form until it's back."
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
          v-if="canWrite && !fileReadOnly"
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
      <InputText
        v-model="search"
        placeholder="Filter files and fields…"
        class="search"
        aria-label="Filter files and fields"
      />
      <p v-if="search" class="muted small filter-note">
        Matches file names and mods in the list, and settings in the open file.
      </p>

      <Message v-if="truncated" severity="warn" :closable="false" class="mb">
        This server has more config files than can be listed, so some are
        missing. Use the filter, or open them directly on the server.
      </Message>

      <Message v-if="error" severity="error" :closable="false" class="mb">{{ error }}</Message>

      <div class="layout">
        <!-- Files, grouped by mod and folder. -->
        <aside class="files">
          <div v-if="loading && !current" class="muted small pad">Loading…</div>
          <EmptyState v-else-if="byMod.length === 0 && filtering" icon="pi pi-search">
            No files match "{{ search }}".
          </EmptyState>
          <EmptyState v-else-if="byMod.length === 0" icon="pi pi-file">
            No config files found.
          </EmptyState>
          <template v-else>
            <div v-for="group in byMod" :key="group.modId" class="group">
              <button
                type="button"
                class="mod"
                :aria-expanded="isOpen(`mod:${group.modId}`, !collapseGroups)"
                @click="toggleOpen(`mod:${group.modId}`, !collapseGroups)"
              >
                <i :class="['pi', isOpen(`mod:${group.modId}`, !collapseGroups) ? 'pi-chevron-down' : 'pi-chevron-right']" />
                <span class="mod-name">{{ group.modId }}</span>
                <span class="mod-count">{{ group.count }}</span>
              </button>
              <template v-if="isOpen(`mod:${group.modId}`, !collapseGroups)">
                <div v-for="folder in group.folders" :key="folder.folder" class="folder">
                  <div v-if="folder.folder" class="folder-name mono" :title="folder.folder">
                    <bdi>{{ folder.folder }}</bdi>
                  </div>
                  <button
                    v-for="file in folder.entries"
                    :key="file.id"
                    :class="['file', { active: current?.file.id === file.id, nested: folder.folder !== '' }]"
                    :title="file.relPath"
                    @click="openFile(file.id)"
                  >
                    <span class="mono file-name"><bdi>{{ fileName(file.relPath, group.modId) }}</bdi></span>
                    <Tag
                      v-if="file.tooLarge"
                      value="too large"
                      severity="warn"
                      class="file-format"
                    />
                    <Tag v-else :value="file.format" severity="secondary" class="file-format" />
                  </button>
                </div>
              </template>
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
              <span class="mono path-full" :title="current.file.relPath">{{ current.file.relPath }}</span>
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
            >{{ current.warning }} The file is shown read-only.</Message>
            <Message
              v-else-if="!current.supported"
              severity="info"
              :closable="false"
              class="mb"
            >No editor exists for this file type, so its text is shown read-only.</Message>

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

            <pre
              v-if="current.text !== undefined && (!current.supported || visibleFields.length === 0 || showSource)"
              class="source mono small"
            >{{ current.text }}</pre>
            <Button
              v-else-if="visibleFields.length > 0"
              label="View source"
              icon="pi pi-code"
              size="small"
              severity="secondary"
              text
              @click="onViewSource"
            />

            <EmptyState
              v-if="visibleFields.length === 0 && current.supported && filtering"
              icon="pi pi-search"
            >
              Nothing in this file matches "{{ search }}".
            </EmptyState>
            <EmptyState
              v-else-if="visibleFields.length === 0 && current.supported"
              icon="pi pi-sliders-h"
            >
              This file has no settings the editor can show.
            </EmptyState>

            <div v-for="(section, index) in shownSections" :key="section.id" class="section">
              <button
                type="button"
                class="section-head"
                :aria-expanded="isOpen(`section:${section.id}`, !collapseSections || index === 0)"
                @click="toggleOpen(`section:${section.id}`, !collapseSections || index === 0)"
              >
                <i :class="['pi', isOpen(`section:${section.id}`, !collapseSections || index === 0) ? 'pi-chevron-down' : 'pi-chevron-right']" />
                <span class="section-title">{{ section.title }}</span>
                <span class="mod-count">{{ section.fields.length }}</span>
              </button>
              <template v-if="isOpen(`section:${section.id}`, !collapseSections || index === 0)">
                <div
                  v-for="field in section.fields"
                  :key="pathKey(field.path)"
                  :class="['field', { dirty: isDirty(field) }]"
                >
                  <label class="label">
                    <span class="label-text">{{ field.displayLabel ?? field.label }}</span>
                    <span class="path mono small">{{ pathLabel(field.path) }}</span>
                  </label>
                  <p v-if="field.description" class="muted small desc">{{ field.description }}</p>

                  <!-- Allowed Values from the mod's own comments become a real select. -->
                  <Select
                    v-if="field.options"
                    :model-value="stringValue(field)"
                    :options="field.options"
                    :disabled="locked(field)"
                    class="control"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <ToggleSwitch
                    v-else-if="field.kind === 'boolean'"
                    :model-value="boolValue(field)"
                    :disabled="locked(field)"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <InputNumber
                    v-else-if="field.kind === 'number'"
                    :model-value="numberValue(field)"
                    :min="field.min"
                    :max="field.max"
                    :max-fraction-digits="4"
                    :disabled="locked(field)"
                    class="control"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <Chips
                    v-else-if="field.kind === 'stringList' || field.kind === 'numberList'"
                    :model-value="listValue(field)"
                    :disabled="locked(field)"
                    class="control"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <InputText
                    v-else-if="field.kind === 'string'"
                    :model-value="stringValue(field)"
                    :disabled="locked(field)"
                    class="control"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <!-- Anything the adapter could not type stays read-only rather
                       than becoming a text box that can corrupt the file. -->
                  <span v-else class="mono small readonly">
                    {{ stringValue(field) }} <em class="muted">(not editable here)</em>
                  </span>

                  <span v-if="field.min !== undefined" class="muted small hint">
                    Range {{ field.min }} to {{ field.max }}
                  </span>
                  <span v-if="field.default" class="muted small hint">
                    Default {{ field.default }}
                  </span>
                </div>
              </template>
            </div>

            <div v-if="hiddenFieldCount > 0" class="more">
              <span class="muted small">{{ hiddenFieldCount }} more settings are not shown yet.</span>
              <Button label="Show more" size="small" severity="secondary" text @click="showMoreFields" />
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
import { discardPrompt } from "../composables/useDiscardPrompt";
import { useConfirm } from "primevue/useconfirm";
import { useCapabilities } from "../composables/useCapabilities";
import { displayPath, pathKey } from "../utils/configTree";
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
    /** The file the URL names; opened once the server's index is loaded. */
    fileId: { type: String, default: "" },
  },
  emits: ["update-route"],
  setup() {
    const confirm = useConfirm();
    return {
      ...useModConfigs(
        discardPrompt(confirm, "This file has edits that are not saved. Leaving it discards them."),
      ),
      ...useCapabilities(),
      toast: useToast(),
    };
  },
  data() {
    return {
      currentServer: "",
      showHistory: false,
      showSource: false,
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
    // already written. Slower cadence than the status view, since the queue
    // changes far less often than a live server does.
    this.queueTimer = setInterval(() => {
      if (this.currentServer) void this.refreshPending();
    }, 15_000);
  },
  beforeUnmount() {
    if (this.queueTimer) clearInterval(this.queueTimer);
  },
  watch: {
    activeServer(id: string) {
      if (id && id !== this.currentServer) void this.select(id, false);
    },
    fileId(id: string) {
      if (id && this.currentServer && id !== this.current?.file.id) void this.openFromRoute(id);
    },
    "current.file.id"(id: string | undefined) {
      if (id && id !== this.fileId) this.$emit("update-route", { params: { fileId: id } });
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (!this.currentServer && ids.length > 0) {
          void this.select(
            this.activeServer && ids.includes(this.activeServer)
              ? this.activeServer
              : ids[0]!,
            false,
          );
        }
      },
    },
  },
  methods: {
    pathKey,
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
              ? "Those keys changed on disk while the edits waited. Reopen the file to see where they landed."
              : "Most mods only read their config at startup, so restart to apply.",
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
    /**
     * `guarded` is false when the switch already passed the app-level guard
     * (the router leave guard), so the same edits are not asked about twice.
     */
    async select(id: string, guarded = true): Promise<void> {
      if (guarded && !(await this.confirmDiscard())) return;
      this.currentServer = id;
      this.showHistory = false;
      this.showSource = false;
      await Promise.all([this.loadFiles(id), this.refreshPending()]);
      if (this.fileId) await this.openFile(this.fileId);
    },
    /** A file named by the URL; when the switch is refused the URL follows
     *  the file that stays open. */
    async openFromRoute(id: string): Promise<void> {
      await this.openFile(id);
      const open = this.current?.file.id;
      if (open && open !== id) this.$emit("update-route", { params: { fileId: open } });
    },
    /** The file name, with its folder shown by the group above it. */
    fileName(relPath: string, modId: string): string {
      return displayPath(relPath, modId).split("/").pop() ?? relPath;
    },
    pathLabel(path: string[]): string {
      return path.length === 0 ? "(whole file)" : path.join(".");
    },
    /** A field is read-only for viewers, for view-only files, and when the adapter says so. */
    locked(field: ConfigField): boolean {
      return !this.canWrite || this.fileReadOnly || Boolean(field.readOnly);
    },
    async onViewSource(): Promise<void> {
      await this.loadSource();
      this.showSource = true;
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
          ? "Most mods only read their config at startup, so restart to apply."
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
.search { width: 100%; margin-bottom: 12px; }
.filter-note { margin: -6px 0 10px; }
.mb { margin-bottom: 10px; }
.pad { padding: 10px 2px; }

/* The view fills the shell's content area and the two panes divide it, so
   the page itself never scrolls behind two panes that are already scrolling. */
.modconfig-view { display: flex; flex-direction: column; }
.layout {
  display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 14px;
  flex: 1; min-height: 0;
}
@media (max-width: 720px) {
  .layout { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .files { max-height: 40vh; }
}

.files {
  height: 100%; max-height: calc(100vh - 200px); overflow-y: auto; min-width: 0;
  border: 1px solid var(--mc-border); border-radius: var(--mc-radius);
  background: var(--mc-card); padding: 6px;
}
.group { margin-bottom: 8px; }
.mod {
  display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0;
  background: none; border: none; cursor: pointer; text-align: left;
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--mc-muted); padding: 4px 6px;
}
.mod-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mod-count { flex: none; font-size: 11px; color: var(--mc-muted); }
.folder-name {
  font-size: 11px; color: var(--mc-muted); padding: 3px 6px 1px 14px;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
}
.file {
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
  width: 100%; min-width: 0; text-align: left; padding: 5px 6px; font-size: 12px;
  background: none; border: none; border-radius: var(--mc-radius-sm); cursor: pointer;
  color: var(--mc-text);
}
.file.nested { padding-left: 14px; }
/* Without min-width the filename pushed the format badge out of the pane and
   the list grew a horizontal scrollbar instead of eliding. The rtl direction
   moves the ellipsis to the left so the end of a long name stays visible. */
.file-name {
  min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
}
.file-format { flex: none; }
.file:hover { background: var(--mc-hover); }
.file.active { background: var(--mc-hover); font-weight: 600; }

.fields {
  min-width: 0;
  border: 1px solid var(--mc-border); border-radius: var(--mc-radius);
  background: var(--mc-card); padding: 12px; height: 100%; max-height: calc(100vh - 200px); overflow-y: auto;
}
.filehead {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px;
  padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--mc-border);
  min-width: 0;
}
.path-full { min-width: 0; flex: 1 1 200px; overflow-wrap: anywhere; }
.history { padding: 6px 0 10px; }
.snap {
  display: flex; justify-content: space-between; align-items: center;
  padding: 3px 0;
}
.source {
  margin: 0 0 8px; padding: 10px; max-height: 50vh; overflow: auto;
  white-space: pre-wrap; overflow-wrap: anywhere;
  border: 1px solid var(--mc-border); border-radius: var(--mc-radius-sm);
}

.section { margin-bottom: 6px; }
.section-head {
  display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0;
  background: none; border: none; border-bottom: 1px solid var(--mc-border);
  cursor: pointer; text-align: left; padding: 6px 2px; font-size: 13px; font-weight: 600;
  color: var(--mc-text);
}
.section-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.more { display: flex; align-items: center; gap: 10px; padding: 10px 0; flex-wrap: wrap; }

.field { padding: 10px 0; border-bottom: 1px solid var(--mc-border); }
.field:last-child { border-bottom: none; }
.field.dirty { border-left: 2px solid var(--mc-accent); padding-left: 8px; }
.label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-size: 13px; font-weight: 500; min-width: 0; }
.label-text { overflow-wrap: anywhere; }
.path { color: var(--mc-muted); font-weight: 400; overflow-wrap: anywhere; min-width: 0; }
.desc { margin: 3px 0 6px; }
.control { width: 100%; max-width: 380px; }
.readonly { display: inline-block; padding: 4px 0; overflow-wrap: anywhere; }
.hint { display: inline-block; margin-top: 4px; margin-right: 10px; }
</style>
