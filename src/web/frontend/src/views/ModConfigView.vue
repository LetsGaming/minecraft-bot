<template>
  <div class="modconfig-view">
    <ViewHeader :title="t('modconfig.title')" :subtitle="t('modconfig.lede')" />

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server">
      {{ t("modconfig.noServers") }}
    </EmptyState>

    <EditorShell
      v-else
      :state="editorState"
      :readonly-reason="readonlyReason"
      :nav-label="t('modconfig.files')"
      nav-width="300px"
    >
      <template #banners>
        <StaleBanner :stale="indexStale ?? fileStale" :write-note="t('modconfig.staleWrite')" />
        <!-- Queued edits are their own state, not a variant of "saved": they
             are safe but nothing has been written yet. -->
        <InlineBanner v-if="pendingCount > 0" tone="info" :title="t('modconfig.queuedTitle', { count: pendingCount })">
          {{ t("modconfig.queuedText") }}
          <template #actions>
            <Button
              :label="t('modconfig.applyNow')"
              icon="pi pi-send"
              size="small"
              class="tap"
              :loading="flushing"
              @click="applyQueued"
            />
          </template>
        </InlineBanner>
        <ConflictPicker mode="queued" :conflicts="conflicts" :busy="resolving" @resolve="onResolve" />
        <InlineBanner v-if="truncated" tone="warn" :title="t('modconfig.truncatedTitle')">
          {{ t("modconfig.truncatedText") }}
        </InlineBanner>
        <InlineError
          v-if="error && !saving"
          :title="current ? t('modconfig.actionFailed') : t('modconfig.loadFailed')"
          :detail="error"
          :busy="loading"
          :retry-label="current ? t('modconfig.reloadFile') : ''"
          :heading-level="2"
          @retry="retry"
        />
      </template>

      <template #bar>
        <EditBar
          :state="editorState"
          :change-count="changeCount"
          reviewable
          :save-hint="t('modconfig.saveHint')"
          :saving-hint="t('modconfig.savingHint')"
          @save="onSave"
          @discard="discard"
          @review="reviewOpen = true"
        >
          <template #status>
            <template v-if="!current">
              <StatusChip state="unknown" :label="t('modconfig.noFile')" />
            </template>
            <template v-else>
              <StatusChip state="applied" :label="t('modconfig.savedChip')" />
              <span class="mc-hint">{{ t("modconfig.savedHint") }}</span>
            </template>
          </template>
        </EditBar>
      </template>

      <template #nav>
        <div class="mc-files">
          <p v-if="loading && files.length === 0" class="mc-hint mc-pad" role="status">{{ t("modconfig.loading") }}</p>
          <EmptyState v-else-if="byMod.length === 0 && filtering" icon="pi pi-search">
            {{ t("modconfig.noFileMatch", { query: search }) }}
          </EmptyState>
          <EmptyState v-else-if="byMod.length === 0" icon="pi pi-file">
            {{ t("modconfig.noFiles") }}
          </EmptyState>
          <ul v-else class="mc-tree">
            <li v-for="group in byMod" :key="group.modId" class="mc-group">
              <button
                type="button"
                class="mc-mod"
                :aria-expanded="isOpen(`mod:${group.modId}`, !collapseGroups) ? 'true' : 'false'"
                @click="toggleOpen(`mod:${group.modId}`, !collapseGroups)"
              >
                <i :class="['pi', isOpen(`mod:${group.modId}`, !collapseGroups) ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" />
                <span class="mc-mod-name">{{ group.modId }}</span>
                <span class="mc-count">{{ group.count }}</span>
              </button>
              <template v-if="isOpen(`mod:${group.modId}`, !collapseGroups)">
                <div v-for="folder in group.folders" :key="folder.folder" class="mc-folder">
                  <div v-if="folder.folder" class="mc-folder-name mono" :title="folder.folder">
                    <bdi>{{ folder.folder }}</bdi>
                  </div>
                  <button
                    v-for="file in folder.entries"
                    :key="file.id"
                    type="button"
                    :class="['mc-file', { nested: folder.folder !== '' }]"
                    :aria-current="current?.file.id === file.id ? 'true' : undefined"
                    :title="file.relPath"
                    @click="openFile(file.id)"
                  >
                    <span class="mono mc-file-name"><bdi>{{ fileName(file.relPath, group.modId) }}</bdi></span>
                    <span :class="['mc-format', { warn: file.tooLarge }]">
                      {{ file.tooLarge ? t("modconfig.tooLarge") : file.format }}
                    </span>
                  </button>
                </div>
              </template>
            </li>
          </ul>
        </div>
      </template>

      <template #default="{ locked }">
        <div class="mc-filter">
          <i class="pi pi-search" aria-hidden="true" />
          <label class="sr-only" for="mc-filter">{{ t("modconfig.filterLabel") }}</label>
          <InputText
            id="mc-filter"
            v-model="search"
            type="search"
            autocomplete="off"
            :placeholder="t('modconfig.filterPlaceholder')"
          />
        </div>
        <p v-if="filtering" class="mc-hint">{{ t("modconfig.filterNote") }}</p>

        <EmptyState v-if="!current && !(loading && files.length > 0)" icon="pi pi-sliders-h">
          {{ t("modconfig.pickFile") }}
        </EmptyState>
        <p v-else-if="!current" class="mc-hint" role="status">{{ t("modconfig.loadingFile") }}</p>

        <section v-else class="mc-file-card" :aria-labelledby="'mc-file-title'">
          <header class="mc-filehead">
            <h2 id="mc-file-title" class="mono mc-path">{{ current.file.relPath }}</h2>
            <div class="mc-file-actions">
              <Button
                v-if="canWrite && current.snapshots.length > 0"
                :label="t('modconfig.history', { count: current.snapshots.length })"
                icon="pi pi-history"
                size="small"
                severity="secondary"
                text
                class="tap"
                :aria-expanded="showHistory ? 'true' : 'false'"
                @click="showHistory = !showHistory"
              />
              <Button
                v-if="current.supported && visibleFields.length > 0 && !showSource"
                :label="t('modconfig.viewSource')"
                icon="pi pi-code"
                size="small"
                severity="secondary"
                text
                class="tap"
                @click="onViewSource"
              />
            </div>
          </header>

          <InlineBanner v-if="current.warning" tone="warn">
            {{ t("modconfig.fileWarning", { warning: current.warning }) }}
          </InlineBanner>
          <InlineBanner v-else-if="!current.supported" tone="info">
            {{ t("modconfig.unsupported") }}
          </InlineBanner>

          <ul v-if="showHistory" class="mc-history" :aria-label="t('modconfig.historyLabel')">
            <li v-for="snap in current.snapshots" :key="snap" class="mc-snap">
              <span class="mono">{{ formatStamp(snap) }}</span>
              <Button
                :label="t('modconfig.revert')"
                :aria-label="t('modconfig.revertTo', { stamp: formatStamp(snap) })"
                size="small"
                severity="danger"
                text
                class="tap"
                :loading="saving"
                :disabled="locked"
                @click="onRevert(snap)"
              />
            </li>
          </ul>

          <pre
            v-if="current.text !== undefined && (!current.supported || visibleFields.length === 0 || showSource)"
            class="mc-source mono"
            tabindex="0"
            :aria-label="t('modconfig.sourceLabel')"
          >{{ current.text }}</pre>

          <EmptyState v-if="visibleFields.length === 0 && current.supported && filtering" icon="pi pi-search">
            {{ t("modconfig.noFieldMatch", { query: search }) }}
          </EmptyState>
          <EmptyState v-else-if="visibleFields.length === 0 && current.supported" icon="pi pi-sliders-h">
            {{ t("modconfig.noFields") }}
          </EmptyState>

          <div v-for="(section, index) in shownSections" :key="section.id" class="mc-section">
            <button
              type="button"
              class="mc-section-head"
              :aria-expanded="isOpen(`section:${section.id}`, !collapseSections || index === 0) ? 'true' : 'false'"
              @click="toggleOpen(`section:${section.id}`, !collapseSections || index === 0)"
            >
              <i :class="['pi', isOpen(`section:${section.id}`, !collapseSections || index === 0) ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" />
              <span class="mc-section-title">{{ section.title }}</span>
              <span class="mc-count">{{ section.fields.length }}</span>
            </button>
            <template v-if="isOpen(`section:${section.id}`, !collapseSections || index === 0)">
              <FieldRow
                v-for="field in section.fields"
                :id="fieldDomId('mc', field.path)"
                :key="pathKey(field.path)"
                :label="field.displayLabel ?? field.label"
                :key-path="pathLabel(field.path)"
                :help="field.description"
                :dirty="isDirty(field)"
              >
                <template #default="{ id, labelId, describedBy }">
                  <!-- Allowed values from the mod's own comments become a real select. -->
                  <Select
                    v-if="field.options"
                    :model-value="stringValue(field)"
                    :options="field.options"
                    :label-id="id"
                    :aria-labelledby="labelId"
                    :disabled="locked || isLocked(field)"
                    :pt="{ label: { 'aria-describedby': describedBy } }"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <ToggleSwitch
                    v-else-if="field.kind === 'boolean'"
                    :model-value="boolValue(field)"
                    :input-id="id"
                    :disabled="locked || isLocked(field)"
                    :pt="{ input: { 'aria-describedby': describedBy } }"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <InputNumber
                    v-else-if="field.kind === 'number'"
                    :model-value="numberValue(field)"
                    :min="field.min"
                    :max="field.max"
                    :max-fraction-digits="4"
                    :input-id="id"
                    :disabled="locked || isLocked(field)"
                    :pt="{ pcInputText: { root: { 'aria-describedby': describedBy } } }"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <InputChips
                    v-else-if="field.kind === 'stringList' || field.kind === 'numberList'"
                    :model-value="listValue(field)"
                    :input-id="id"
                    :input-props="{ 'aria-describedby': describedBy }"
                    :aria-labelledby="labelId"
                    :pt="CHIPS_PT"
                    :disabled="locked || isLocked(field)"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <InputText
                    v-else-if="field.kind === 'string'"
                    :id="id"
                    :model-value="stringValue(field)"
                    :aria-describedby="describedBy"
                    :disabled="locked || isLocked(field)"
                    @update:model-value="setFromInput(field, $event)"
                  />
                  <!-- Anything the adapter could not type stays read-only rather
                       than becoming a text box that can corrupt the file. -->
                  <output v-else :id="id" class="mono mc-readonly" :aria-describedby="describedBy">
                    {{ stringValue(field) }} <em class="mc-hint">{{ t("modconfig.notEditable") }}</em>
                  </output>
                </template>
                <template #meta>
                  <span v-if="isDirty(field)" class="mc-was">
                    {{ t("field.was") }} <s class="mono">{{ shown(field.value) }}</s>
                    <button type="button" class="mc-reset" :disabled="locked" @click="setValue(field, field.value)">
                      {{ t("field.reset") }}
                    </button>
                  </span>
                  <span v-if="field.min !== undefined" class="mc-hint">
                    {{ t("modconfig.range", { min: field.min, max: field.max ?? "" }) }}
                  </span>
                  <span v-if="field.default" class="mc-hint">{{ t("field.default", { value: field.default }) }}</span>
                </template>
              </FieldRow>
            </template>
          </div>

          <div v-if="hiddenFieldCount > 0" class="mc-more">
            <span class="mc-hint">{{ t("modconfig.moreHidden", { count: hiddenFieldCount }) }}</span>
            <Button :label="t('modconfig.showMore')" size="small" severity="secondary" text class="tap" @click="showMoreFields" />
          </div>
        </section>
      </template>
    </EditorShell>

    <ReviewChanges v-model:visible="reviewOpen" :changes="reviewItems" :can-save="editorState === 'dirty'" @save="onReviewSave" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import ToggleSwitch from "primevue/toggleswitch";
import Select from "primevue/select";
import InputChips from "primevue/inputchips";
import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";
import type { EditConflict } from "../composables/useModConfigs";
import { useModConfigs, type ConfigField } from "../composables/useModConfigs";
import { discardPrompt } from "../composables/useDiscardPrompt";
import { useCapabilities } from "../composables/useCapabilities";
import { displayPath, pathKey } from "../utils/configTree";
import { fieldDomId } from "../components/schema/formIndex";
import { CHIPS_PT } from "../components/ui/chipsA11y";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StaleBanner from "../components/ui/StaleBanner.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import EditorShell from "../components/ui/EditorShell.vue";
import EditBar from "../components/ui/EditBar.vue";
import FieldRow from "../components/ui/FieldRow.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import InlineError from "../components/ui/InlineError.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import ReviewChanges, { type ReviewItem } from "../components/ui/ReviewChanges.vue";
import type { EditorState } from "../components/ui/types";
import { t } from "../i18n";

const SHOWN_MAX = 80;

export default defineComponent({
  name: "ModConfigView",
  components: {
    Button, InputText, InputNumber, ToggleSwitch, Select, InputChips,
    ViewHeader, StaleBanner, ConflictPicker, EmptyState, EditorShell, EditBar, FieldRow,
    InlineBanner, InlineError, StatusChip, ReviewChanges,
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
      ...useModConfigs(discardPrompt(confirm, t("modconfig.leaveFile"))),
      ...useCapabilities(),
      toast: useToast(),
      t,
      fieldDomId,
      CHIPS_PT,
    };
  },
  data() {
    return {
      currentServer: "",
      showHistory: false,
      showSource: false,
      flushing: false,
      resolving: "",
      reviewOpen: false,
      queueTimer: 0 as ReturnType<typeof setInterval> | 0,
    };
  },
  computed: {
    canWrite(): boolean {
      return this.can("config:write", this.currentServer);
    },
    readonlyReason(): string {
      if (!this.canWrite) return t("modconfig.readonlyAccess");
      if (this.current?.warning) return t("modconfig.readonlyWarning");
      return t("modconfig.readonlyFile");
    },
    editorState(): EditorState {
      if (!this.canWrite || (this.current && this.fileReadOnly)) return "readonly";
      if (this.saving) return "saving";
      if (this.dirty) return "dirty";
      return "clean";
    },
    changeCount(): number {
      return Object.keys(this.pending).length;
    },
    fieldsByKey(): Map<string, ConfigField> {
      return new Map((this.current?.fields ?? []).map((field) => [pathKey(field.path), field]));
    },
    reviewItems(): ReviewItem[] {
      return Object.entries(this.pending).map(([key, after]) => {
        const field = this.fieldsByKey.get(key);
        const path = JSON.parse(key) as string[];
        return { key: this.pathLabel(path), before: field?.value, after };
      });
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
            this.activeServer && ids.includes(this.activeServer) ? this.activeServer : ids[0]!,
            false,
          );
        }
      },
    },
  },
  methods: {
    pathKey,
    shown(value: unknown): string {
      if (value === undefined || value === null) return t("field.unsetValue");
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text;
    },
    async onResolve(payload: { conflict: EditConflict; choice: "queued" | "current" }): Promise<void> {
      this.resolving = payload.conflict.keyPath.join(".");
      try {
        await this.resolveConflict(payload.conflict, payload.choice);
        this.toast.add({
          severity: "success",
          summary: payload.choice === "queued" ? t("modconfig.resolvedMine") : t("modconfig.resolvedDisk"),
          life: 4000,
        });
      } catch (err) {
        this.toast.add({
          severity: "error",
          summary: t("modconfig.resolveFailed"),
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
              ? t("modconfig.flushPartial", { applied: res.applied, count: conflicts })
              : t("modconfig.flushDone", { count: res.applied }),
          detail: conflicts > 0 ? t("modconfig.flushPartialDetail") : t("modconfig.restartToApply"),
          life: 8000,
        });
        if (this.current) await this.openFile(this.current.file.id);
      } catch (err) {
        this.toast.add({
          severity: "error",
          summary: t("modconfig.flushFailed"),
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
    async retry(): Promise<void> {
      if (this.current) await this.openFile(this.current.file.id);
      else if (this.currentServer) await this.select(this.currentServer, false);
    },
    /** The file name, with its folder shown by the group above it. */
    fileName(relPath: string, modId: string): string {
      return displayPath(relPath, modId).split("/").pop() ?? relPath;
    },
    pathLabel(path: string[]): string {
      return path.length === 0 ? t("modconfig.wholeFile") : path.join(".");
    },
    /** A field the adapter marks read-only stays locked whatever the user may do. */
    isLocked(field: ConfigField): boolean {
      return Boolean(field.readOnly);
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
      const changes = this.changeCount;
      const ok = await this.save();
      if (ok && this.queued) {
        this.toast.add({ severity: "info", summary: t("modconfig.queuedToast"), detail: t("modconfig.queuedToastDetail"), life: 8000 });
        return;
      }
      this.toast.add({
        severity: ok ? "success" : "error",
        summary: ok ? t("modconfig.savedToast", { count: changes }) : t("modconfig.saveFailed"),
        detail: ok ? t("modconfig.restartToApply") : this.error,
        life: ok ? 6000 : 8000,
      });
    },
    async onReviewSave(): Promise<void> {
      this.reviewOpen = false;
      await this.onSave();
    },
    async onRevert(snapshot: string): Promise<void> {
      if (!(await this.confirmDiscard())) return;
      const ok = await this.revert(snapshot);
      this.showHistory = false;
      this.toast.add({
        severity: ok ? "success" : "error",
        summary: ok ? t("modconfig.reverted") : t("modconfig.revertFailed"),
        detail: ok ? this.formatStamp(snapshot) : this.error,
        life: 5000,
      });
    },
  },
});
</script>

<style scoped>
.modconfig-view { display: flex; flex-direction: column; min-width: 0; }
.mc-hint { color: var(--text-dim); font-size: var(--text-sm); margin: 0; }
.mc-pad { padding: var(--space-3); }
.mc-filter { position: relative; }
.mc-filter .pi { position: absolute; left: var(--space-3); top: 50%; transform: translateY(-50%); color: var(--text-dim); pointer-events: none; }
.mc-filter :deep(.p-inputtext) { width: 100%; padding-left: 36px; }

.mc-files {
  min-width: 0;
  max-height: 40vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  padding: var(--space-1);
}
@media (min-width: 1100px) {
  .mc-files { max-height: calc(100vh - 140px); }
}
.mc-tree { list-style: none; margin: 0; padding: 0; }
.mc-group { margin-bottom: var(--space-2); }
.mc-mod {
  display: flex; align-items: center; gap: var(--space-2); width: 100%; min-width: 0;
  min-height: var(--control-h);
  background: none; border: none; cursor: pointer; text-align: left;
  font: inherit; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-caps);
  color: var(--text-dim); padding: var(--space-1) var(--space-2);
}
.mc-mod-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-count { flex: none; font-size: var(--text-xs); color: var(--text-dim); }
.mc-folder-name {
  font-size: var(--text-xs); color: var(--text-dim); padding: 3px var(--space-2) 1px var(--space-4);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
}
.mc-file {
  display: flex; justify-content: space-between; align-items: center; gap: var(--space-2);
  width: 100%; min-width: 0; min-height: var(--control-h); text-align: left;
  padding: var(--space-1) var(--space-2); font: inherit; font-size: var(--text-sm);
  background: none; border: none; border-left: 3px solid transparent; border-radius: var(--radius-control); cursor: pointer;
  color: var(--text);
}
.mc-file.nested { padding-left: var(--space-4); }
/* The rtl direction moves the ellipsis to the left so the end of a long name stays visible. */
.mc-file-name {
  min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  direction: rtl; text-align: left;
}
.mc-format {
  flex: none; font-size: var(--text-xs); padding: 0 6px; border-radius: 4px;
  background: var(--surface-raised); color: var(--text-dim);
}
.mc-format.warn { background: var(--st-degraded-bg); color: var(--st-degraded); }
.mc-file:hover { background: var(--surface-raised); }
.mc-file[aria-current="true"] { background: var(--accent-tint); border-left-color: var(--accent); font-weight: 600; }

.mc-file-card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  padding-bottom: var(--space-2);
}
.mc-filehead {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2);
  padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); min-width: 0;
}
.mc-path { margin: 0; font-size: var(--text-md); font-weight: 600; min-width: 0; flex: 1 1 200px; overflow-wrap: anywhere; }
.mc-file-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.mc-file-card > .inline-banner { margin: var(--space-3) var(--space-4) 0; }
.mc-history { list-style: none; margin: 0; padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); }
.mc-snap { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2); padding: 3px 0; }
.mc-source {
  margin: var(--space-3) var(--space-4); padding: var(--space-3); max-height: 50vh; overflow: auto;
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-sm);
  background: var(--bg-code); border: 1px solid var(--border); border-radius: var(--radius-control);
}
.mc-section { margin-top: var(--space-1); }
.mc-section-head {
  display: flex; align-items: center; gap: var(--space-2); width: 100%; min-width: 0;
  min-height: var(--control-h);
  background: none; border: none; border-bottom: 1px solid var(--border);
  cursor: pointer; text-align: left; padding: var(--space-2) var(--space-4); font: inherit; font-weight: 600;
  color: var(--text);
}
.mc-section-head:hover { background: var(--surface-raised); }
.mc-section-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.mc-more { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); flex-wrap: wrap; }
.mc-readonly { display: inline-block; padding: var(--space-1) 0; overflow-wrap: anywhere; }
.mc-was {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2);
  font-size: var(--text-xs); color: var(--text-dim); overflow-wrap: anywhere;
}
.mc-reset {
  padding: 0; background: none; border: 0; color: var(--link); font: inherit;
  text-decoration: underline; cursor: pointer;
}
.mc-reset:disabled { color: var(--text-dim); cursor: default; }
@media (pointer: coarse), (max-width: 760px) {
  .tap, .mc-file, .mc-mod, .mc-section-head, .mc-reset { min-height: var(--touch-min); }
}
</style>
