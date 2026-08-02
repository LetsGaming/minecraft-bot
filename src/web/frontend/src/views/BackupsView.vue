<template>
  <div>
    <ViewHeader title="Backups" subtitle="Archives on the server, newest first.">
      <template #actions>
        <Button
          icon="pi pi-refresh"
          label="Refresh"
          severity="secondary"
          outlined
          size="small"
          :loading="loading"
          @click="reload"
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
          :severity="id === current ? 'primary' : 'secondary'"
          :outlined="id !== current"
          @click="select(id)"
        />
      </div>

      <Message v-if="error" severity="error" :closable="false" class="mb">
        {{ error }}
      </Message>

      <EmptyState v-if="!loading && files.length === 0" icon="pi pi-box">
        No archives yet.
        <template #action>
          <span class="muted small">
            Run a backup from the Servers page, or wait for the scheduled one.
          </span>
        </template>
      </EmptyState>

      <table v-else class="backups">
        <thead>
          <tr>
            <th>Archive</th>
            <th>Tier</th>
            <th class="num">Size</th>
            <th>Age</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in files" :key="file.id">
            <td class="mono name">{{ file.name }}</td>
            <td><Tag :value="file.tier" severity="secondary" /></td>
            <td class="num">{{ formatBytes(file.sizeBytes) }}</td>
            <td class="muted small">{{ age(file.mtimeMs) }}</td>
            <td class="actions-col">
              <Button
                v-if="can('backup:download', current)"
                icon="pi pi-download"
                label="Download"
                size="small"
                severity="secondary"
                text
                @click="download(file.id)"
              />
              <Button
                v-if="can('backup:restore', current)"
                icon="pi pi-replay"
                label="Restore"
                size="small"
                severity="danger"
                text
                :loading="restoring === file.id"
                :disabled="restoring !== ''"
                @click="confirmRestore(file)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="files.length > 0" class="foot">
        <span class="muted small">
          Showing {{ files.length }} of {{ total }}
        </span>
        <Button
          v-if="hasMore"
          label="Load more"
          size="small"
          severity="secondary"
          outlined
          :loading="loading"
          @click="loadMore"
        />
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Message from "primevue/message";
import { useToast } from "primevue/usetoast";
import { formatBytes } from "@mcbot/schema";
import { useBackups } from "../composables/useBackups";
import { useCapabilities } from "../composables/useCapabilities";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import type { BackupFileInfo } from "../api";

export default defineComponent({
  name: "BackupsView",
  components: { Button, Tag, Message, ViewHeader, EmptyState },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return { ...useBackups(), ...useCapabilities(), formatBytes, toast: useToast() };
  },
  data() {
    return { current: "" };
  },
  watch: {
    activeServer(id: string) {
      if (id && id !== this.current) void this.select(id);
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (!this.current && ids.length > 0) {
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
      this.current = id;
      await this.load(id);
    },
    reload(): Promise<void> {
      return this.load(this.current);
    },
    age(mtimeMs: number): string {
      const hours = (Date.now() - mtimeMs) / 3_600_000;
      if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
      if (hours < 48) return `${Math.round(hours)} h ago`;
      return `${Math.round(hours / 24)} days ago`;
    },
    /**
     * Restore asks for the server's name, typed.
     *
     * Same rule as rollback: this replaces the live world and cannot be
     * undone from here. An OK button is a reflex, and interrupting the reflex
     * is the entire purpose of the dialog.
     */
    async confirmRestore(file: BackupFileInfo): Promise<void> {
      const typed = window.prompt(
        `This will replace the world on "${this.current}" with ${file.name}.\n` +
          `The current world will be gone and this cannot be undone.\n\n` +
          `Type the server name to confirm:`,
      );
      if (typed === null) return;
      if (typed.trim() !== this.current) {
        this.toast.add({
          severity: "warn",
          summary: "Restore cancelled",
          detail: "The name did not match.",
          life: 3000,
        });
        return;
      }
      const ok = await this.restore(file);
      this.toast.add({
        severity: ok ? "success" : "error",
        summary: ok ? `Restored · ${this.current}` : "Restore failed",
        detail: ok ? file.name : this.error,
        life: ok ? 4000 : 6000,
      });
    },
  },
});
</script>

<style scoped>
.picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.mb { margin-bottom: 10px; }

.backups { width: 100%; border-collapse: collapse; font-size: 13px; }
.backups th {
  text-align: left;
  font-weight: 500;
  color: var(--mc-muted);
  font-size: 12px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--mc-border);
}
.backups td { padding: 7px 8px; border-bottom: 1px solid var(--mc-border); }
.backups tr:last-child td { border-bottom: none; }
.name { word-break: break-all; }
.num { text-align: right; white-space: nowrap; }
.actions-col { text-align: right; white-space: nowrap; }

.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
}
</style>
