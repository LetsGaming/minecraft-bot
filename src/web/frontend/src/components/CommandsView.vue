<template>
  <div class="commands">
    <div class="toolbar">
      <label>
        Scope:
        <select v-model="scope">
          <option value="global">Global (fallback for everything)</option>
          <optgroup label="Guilds — slash commands">
            <option v-for="gid in guildIds" :key="gid" :value="'guild:' + gid">
              Guild {{ gid }}
            </option>
          </optgroup>
          <optgroup label="Servers — in-game !commands">
            <option v-for="sid in serverIds" :key="sid" :value="'server:' + sid">
              Server {{ sid }}
            </option>
          </optgroup>
        </select>
      </label>
      <button class="primary" :disabled="saving || !dirty" @click="save">
        {{ saving ? "Saving…" : "Save changes" }}
      </button>
    </div>

    <p class="muted small">
      Scoped settings override the global block <em>field by field</em> —
      "inherit" keeps whatever the global value (or the default) is. Note:
      built-in admin commands stay admin-gated regardless of these
      settings, and re-enabling a command that was disabled in every scope
      needs one bot restart to register it again.
    </p>

    <div v-if="error" class="errors"><p>{{ error }}</p></div>
    <p v-if="saved" class="message">✓ Saved — applies on the bot's next config reload (automatic).</p>

    <template v-for="section in visibleSections" :key="section.kind">
      <h3>{{ section.title }}</h3>
      <table class="audit">
        <thead>
          <tr>
            <th>Command</th>
            <th>Description</th>
            <th>Enabled</th>
            <th>Admin only</th>
            <th class="muted">Effective</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cmd in section.commands" :key="cmd.name">
            <td><code>{{ section.prefix }}{{ cmd.name }}</code></td>
            <td class="muted small">{{ cmd.description }}</td>
            <td>
              <select
                :value="fieldValue(cmd.name, 'enabled')"
                @change="setField(cmd.name, 'enabled', ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="scope !== 'global'" value="inherit">inherit</option>
                <option v-else value="inherit">default (on)</option>
                <option value="true">on</option>
                <option value="false">off</option>
              </select>
            </td>
            <td>
              <select
                :value="fieldValue(cmd.name, 'adminOnly')"
                @change="setField(cmd.name, 'adminOnly', ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="scope !== 'global'" value="inherit">inherit</option>
                <option v-else value="inherit">default (off)</option>
                <option value="true">admins</option>
                <option value="false">everyone</option>
              </select>
            </td>
            <td class="muted small">
              {{ effectiveLabel(cmd.name) }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiSend } from "../api";

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
  data() {
    return {
      loadingError: "",
      error: "",
      saved: false,
      saving: false,
      dirty: false,
      scope: "global",
      data: null as CommandsResponse | null,
      // Working copy of the override blocks, mutated by the selects.
      overrides: {
        global: {} as Record<string, Override>,
        guilds: {} as Record<string, Record<string, Override>>,
        servers: {} as Record<string, Record<string, Override>>,
      },
    };
  },
  computed: {
    guildIds(): string[] {
      return this.data?.scopes.guildIds ?? [];
    },
    serverIds(): string[] {
      return this.data?.scopes.serverIds ?? [];
    },
    visibleSections(): Array<{
      kind: string;
      title: string;
      prefix: string;
      commands: ManifestEntry[];
    }> {
      if (!this.data) return [];
      const slash = {
        kind: "slash",
        title: "Slash commands",
        prefix: "/",
        commands: this.data.manifest.slash,
      };
      const ingame = {
        kind: "ingame",
        title: "In-game commands",
        prefix: "!",
        commands: this.data.manifest.ingame,
      };
      // Guild scope governs slash commands, server scope in-game ones;
      // global governs both.
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
      this.error = (err as Error).message;
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
      // Empty override objects are noise in config.json — drop them.
      if (Object.keys(entry).length === 0) delete block[name];
      this.dirty = true;
      this.saved = false;
    },
    effectiveLabel(name: string): string {
      const eff = this.data?.effective[name]?.[this.scope];
      if (!eff) return "";
      return `${eff.enabled ? "on" : "off"}${eff.adminOnly ? " · admins" : ""}`;
    },
    async save() {
      this.error = "";
      this.saving = true;
      try {
        // Merge the edited override blocks into the full config and PUT
        // it whole — same path (validate + atomic write) as the editor.
        const config = await apiGet<Record<string, unknown>>("/api/config");
        config.commands = this.overrides.global;
        const guilds = (config.guilds ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        for (const [gid, block] of Object.entries(this.overrides.guilds)) {
          if (!guilds[gid]) continue;
          if (Object.keys(block).length > 0) guilds[gid].commands = block;
          else delete guilds[gid].commands;
        }
        const servers = (config.servers ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        for (const [sid, block] of Object.entries(this.overrides.servers)) {
          if (!servers[sid]) continue;
          if (Object.keys(block).length > 0) servers[sid].commands = block;
          else delete servers[sid].commands;
        }

        await apiSend("PUT", "/api/config", config);
        this.saved = true;
        this.dirty = false;
        this.data = await apiGet<CommandsResponse>("/api/commands");
      } catch (err) {
        const message = (err as Error).message;
        this.error = message.startsWith("[")
          ? (JSON.parse(message) as string[]).join("\n")
          : message;
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>
