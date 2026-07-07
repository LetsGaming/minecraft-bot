<template>
  <div>
    <div class="view-head">
      <div>
        <h2>Commands</h2>
        <p class="muted small">Enable, disable, or gate commands per scope.</p>
      </div>
      <Button
        label="Save changes"
        icon="pi pi-save"
        :disabled="saving || !dirty"
        :loading="saving"
        @click="save"
      />
    </div>

    <div class="scope-bar">
      <span class="muted small">Scope</span>
      <Select
        v-model="scope"
        :options="scopeOptions"
        optionLabel="label"
        optionValue="value"
        optionGroupLabel="group"
        optionGroupChildren="items"
        class="scope-select"
      />
    </div>

    <Message severity="secondary" :closable="false" class="scope-note">
      Scoped settings override the global block <em>field by field</em> —
      "inherit" keeps the global value (or the default). Built-in admin
      commands stay admin-gated regardless, and re-enabling a command that
      was disabled in every scope needs one bot restart to register it again.
    </Message>

    <div v-if="loadError" class="empty">
      <i class="pi pi-exclamation-circle" />
      <p>{{ loadError }}</p>
    </div>

    <template v-for="section in visibleSections" :key="section.kind">
      <h3 class="section-title">
        <i :class="section.kind === 'slash' ? 'pi pi-slash' : 'pi pi-hashtag'" />
        {{ section.title }}
      </h3>
      <DataTable :value="section.commands" class="cmd-table" dataKey="name" size="small" stripedRows>
        <Column header="Command" style="width: 18%">
          <template #body="{ data }">
            <code class="cmd-name">{{ section.prefix }}{{ data.name }}</code>
          </template>
        </Column>
        <Column header="Description">
          <template #body="{ data }">
            <span class="muted small">{{ data.description }}</span>
          </template>
        </Column>
        <Column header="Enabled" style="width: 130px">
          <template #body="{ data }">
            <Select
              :modelValue="fieldValue(data.name, 'enabled')"
              :options="enabledOptions"
              optionLabel="label"
              optionValue="value"
              size="small"
              class="cell-select"
              @update:modelValue="setField(data.name, 'enabled', $event)"
            />
          </template>
        </Column>
        <Column header="Access" style="width: 140px">
          <template #body="{ data }">
            <Select
              :modelValue="fieldValue(data.name, 'adminOnly')"
              :options="adminOptions"
              optionLabel="label"
              optionValue="value"
              size="small"
              class="cell-select"
              @update:modelValue="setField(data.name, 'adminOnly', $event)"
            />
          </template>
        </Column>
        <Column header="Effective" style="width: 120px">
          <template #body="{ data }">
            <Tag :value="effectiveLabel(data.name)" :severity="effectiveSeverity(data.name)" />
          </template>
        </Column>
      </DataTable>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Select from "primevue/select";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Tag from "primevue/tag";
import Message from "primevue/message";
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";

interface ManifestEntry {
  name: string;
  description: string;
}
interface Override {
  enabled?: boolean;
  adminOnly?: boolean;
  [key: string]: unknown;
}
interface CommandsResponse {
  manifest: { slash: ManifestEntry[]; ingame: ManifestEntry[] };
  scopes: { guildIds: string[]; serverIds: string[] };
  overrides: {
    global: Record<string, Override>;
    guilds: Record<string, Record<string, Override>>;
    servers: Record<string, Record<string, Override>>;
  };
  effective: Record<
    string,
    Record<string, { enabled: boolean; adminOnly: boolean }>
  >;
}

export default defineComponent({
  name: "CommandsView",
  components: { Select, Button, DataTable, Column, Tag, Message },
  data() {
    return {
      loadError: "",
      saving: false,
      dirty: false,
      scope: "global",
      data: null as CommandsResponse | null,
      overrides: {
        global: {} as Record<string, Override>,
        guilds: {} as Record<string, Record<string, Override>>,
        servers: {} as Record<string, Record<string, Override>>,
      },
    };
  },
  computed: {
    scopeOptions(): unknown[] {
      const opts: unknown[] = [
        { value: "global", label: "Global (fallback for everything)", group: null },
      ];
      const guilds = this.data?.scopes.guildIds ?? [];
      const servers = this.data?.scopes.serverIds ?? [];
      if (guilds.length) {
        opts.push({
          group: "Guilds — slash commands",
          items: guilds.map((g) => ({ value: `guild:${g}`, label: `Guild ${g}` })),
        });
      }
      if (servers.length) {
        opts.push({
          group: "Servers — in-game commands",
          items: servers.map((s) => ({ value: `server:${s}`, label: `Server ${s}` })),
        });
      }
      return opts;
    },
    enabledOptions(): { value: string; label: string }[] {
      const inherit = this.scope === "global" ? "default (on)" : "inherit";
      return [
        { value: "inherit", label: inherit },
        { value: "true", label: "On" },
        { value: "false", label: "Off" },
      ];
    },
    adminOptions(): { value: string; label: string }[] {
      const inherit = this.scope === "global" ? "default (all)" : "inherit";
      return [
        { value: "inherit", label: inherit },
        { value: "true", label: "Admins" },
        { value: "false", label: "Everyone" },
      ];
    },
    visibleSections(): Array<{ kind: string; title: string; prefix: string; commands: ManifestEntry[] }> {
      if (!this.data) return [];
      const slash = { kind: "slash", title: "Slash commands", prefix: "/", commands: this.data.manifest.slash };
      const ingame = { kind: "ingame", title: "In-game commands", prefix: "!", commands: this.data.manifest.ingame };
      if (this.scope.startsWith("guild:")) return [slash];
      if (this.scope.startsWith("server:")) return [ingame];
      return [slash, ingame];
    },
  },
  async mounted() {
    try {
      this.data = await apiGet<CommandsResponse>("/api/commands");
      this.overrides = JSON.parse(JSON.stringify(this.data.overrides));
    } catch (err) {
      this.loadError = (err as Error).message;
    }
  },
  methods: {
    currentBlock(): Record<string, Override> {
      if (this.scope.startsWith("guild:")) {
        const gid = this.scope.slice(6);
        return (this.overrides.guilds[gid] ??= {});
      }
      if (this.scope.startsWith("server:")) {
        const sid = this.scope.slice(7);
        return (this.overrides.servers[sid] ??= {});
      }
      return this.overrides.global;
    },
    fieldValue(name: string, field: "enabled" | "adminOnly"): string {
      const value = this.currentBlock()[name]?.[field];
      return value === undefined ? "inherit" : String(value);
    },
    setField(name: string, field: "enabled" | "adminOnly", raw: string) {
      const block = this.currentBlock();
      const entry = (block[name] ??= {});
      if (raw === "inherit") delete entry[field];
      else entry[field] = raw === "true";
      if (Object.keys(entry).length === 0) delete block[name];
      this.dirty = true;
    },
    effectiveLabel(name: string): string {
      const eff = this.data?.effective[name]?.[this.scope];
      if (!eff) return "—";
      return `${eff.enabled ? "on" : "off"}${eff.adminOnly ? " · admins" : ""}`;
    },
    effectiveSeverity(name: string): string {
      const eff = this.data?.effective[name]?.[this.scope];
      if (!eff) return "secondary";
      return eff.enabled ? "success" : "danger";
    },
    async save() {
      this.saving = true;
      try {
        // Read the FULL config envelope (config + baseHash) so the PUT
        // carries optimistic-concurrency info and never writes the
        // envelope's `hash` field into config.json itself.
        const res = await apiGet<ConfigResponse>("/api/config");
        const config = res.config as Record<string, unknown>;
        config.commands = this.overrides.global;
        const guilds = (config.guilds ?? {}) as Record<string, Record<string, unknown>>;
        for (const [gid, block] of Object.entries(this.overrides.guilds)) {
          if (!guilds[gid]) continue;
          if (Object.keys(block).length > 0) guilds[gid].commands = block;
          else delete guilds[gid].commands;
        }
        const servers = (config.servers ?? {}) as Record<string, Record<string, unknown>>;
        for (const [sid, block] of Object.entries(this.overrides.servers)) {
          if (!servers[sid]) continue;
          if (Object.keys(block).length > 0) servers[sid].commands = block;
          else delete servers[sid].commands;
        }

        await apiSend("PUT", "/api/config", { baseHash: res.hash, config });
        this.dirty = false;
        this.$toast.add({
          severity: "success",
          summary: "Saved",
          detail: "Applies on the bot's next config reload (automatic).",
          life: 3000,
        });
        this.data = await apiGet<CommandsResponse>("/api/commands");
        this.overrides = JSON.parse(JSON.stringify(this.data.overrides));
      } catch (err) {
        const message = (err as Error).message;
        const detail = message.startsWith("[")
          ? (JSON.parse(message) as string[]).join("\n")
          : message;
        this.$toast.add({ severity: "error", summary: "Save failed", detail, life: 5000 });
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.view-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 16px; }
.view-head h2 { margin: 0 0 3px; font-size: 18px; font-weight: 500; }
.view-head p { margin: 0; }

.scope-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.scope-select { min-width: 320px; }
.scope-note { margin-bottom: 20px; }

.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; margin: 24px 0 10px; }
.section-title i { color: var(--mc-accent); font-size: 13px; }
.cmd-name { color: var(--mc-accent); font-family: ui-monospace, monospace; }
.cell-select { width: 100%; }

.empty { text-align: center; padding: 48px 0; color: var(--mc-muted); }
.empty i { font-size: 34px; opacity: 0.5; }
.empty p { margin: 10px 0 0; }
</style>
