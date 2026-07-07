<template>
  <div>
    <ViewHeader title="Commands" subtitle="Turn commands on or off and choose who can use them, per scope.">
      <template #actions>
        <Button
          label="Save changes"
          icon="pi pi-save"
          :disabled="saving || !dirty"
          :loading="saving"
          @click="save"
        />
      </template>
    </ViewHeader>

    <!-- Controls: scope + search -->
    <div class="controls">
      <div class="scope-field">
        <label class="ctl-label muted small">Applies to</label>
        <Select
          v-model="scope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          optionGroupLabel="group"
          optionGroupChildren="items"
          class="scope-select"
        >
          <template #value="{ value }">
            <span class="scope-value">
              <i :class="scopeIcon(value)" /> {{ scopeLabel(value) }}
            </span>
          </template>
        </Select>
      </div>
      <div class="search-field">
        <label class="ctl-label muted small">Find</label>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText v-model="query" placeholder="Filter commands…" class="search-input" />
        </IconField>
      </div>
    </div>

    <p class="scope-hint muted small">
      <i class="pi pi-info-circle" />
      <span v-if="scope === 'global'">
        These are the defaults for every guild and server. Pick a specific
        guild or server above to override individual commands there.
      </span>
      <span v-else>
        Overriding <strong>{{ scopeLabel(scope) }}</strong>. Anything left on
        <em>Default</em> follows the global setting. Switch back to
        <strong>Global defaults</strong> any time to see everything.
      </span>
    </p>

    <EmptyState v-if="loadError" icon="pi pi-exclamation-circle">
      {{ loadError }}
    </EmptyState>

    <Accordion v-else v-model:value="openPanels" multiple>
      <AccordionPanel
        v-for="section in visibleSections"
        :key="section.kind"
        :value="section.kind"
      >
        <AccordionHeader>
          <span class="panel-h">
            <i :class="section.kind === 'slash' ? 'pi pi-bolt' : 'pi pi-hashtag'" />
            {{ section.title }}
            <span class="count">{{ filtered(section).length }}</span>
          </span>
        </AccordionHeader>
        <AccordionContent>
          <div v-if="filtered(section).length === 0" class="no-match muted small">
            No commands match “{{ query }}”.
          </div>
          <div v-else class="cmd-grid">
            <div
              v-for="cmd in filtered(section)"
              :key="cmd.name"
              :class="['cmd-card', effectiveState(cmd.name)]"
            >
              <div class="cmd-card-head">
                <code class="cmd-name">{{ section.prefix }}{{ cmd.name }}</code>
                <Tag :value="effectiveLabel(cmd.name)" :severity="effectiveSeverity(cmd.name)" />
              </div>
              <p class="cmd-desc muted small">{{ cmd.description }}</p>
              <div class="cmd-controls">
                <div class="cmd-ctl">
                  <span class="cmd-ctl-label muted small">Enabled</span>
                  <SelectButton
                    :modelValue="fieldValue(cmd.name, 'enabled')"
                    :options="enabledOptions"
                    optionLabel="label"
                    optionValue="value"
                    :allowEmpty="false"
                    size="small"
                    @update:modelValue="setField(cmd.name, 'enabled', $event)"
                  />
                </div>
                <div class="cmd-ctl">
                  <span class="cmd-ctl-label muted small">Who can use it</span>
                  <SelectButton
                    :modelValue="fieldValue(cmd.name, 'adminOnly')"
                    :options="adminOptions"
                    optionLabel="label"
                    optionValue="value"
                    :allowEmpty="false"
                    size="small"
                    @update:modelValue="setField(cmd.name, 'adminOnly', $event)"
                  />
                </div>
              </div>
            </div>
          </div>
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Select from "primevue/select";
import Button from "primevue/button";
import Tag from "primevue/tag";
import SelectButton from "primevue/selectbutton";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Accordion from "primevue/accordion";
import AccordionPanel from "primevue/accordionpanel";
import AccordionHeader from "primevue/accordionheader";
import AccordionContent from "primevue/accordioncontent";
import { useGuilds } from "../composables/useGuilds";
import { useCommands, type ManifestEntry } from "../composables/useCommands";
import ViewHeader from "../components/ViewHeader.vue";
import EmptyState from "../components/EmptyState.vue";

interface Section {
  kind: string;
  title: string;
  prefix: string;
  commands: ManifestEntry[];
}

export default defineComponent({
  name: "CommandsView",
  components: {
    Select, Button, Tag, SelectButton, InputText, IconField, InputIcon,
    Accordion, AccordionPanel, AccordionHeader, AccordionContent,
    ViewHeader, EmptyState,
  },
  setup() {
    const commands = useCommands();
    const { guildName, load: loadGuildNames } = useGuilds();
    return { ...commands, guildName, loadGuildNames };
  },
  data() {
    return {
      query: "",
      openPanels: ["slash", "ingame"] as string[],
    };
  },
  computed: {
    scopeOptions(): unknown[] {
      const opts: unknown[] = [
        { value: "global", label: "Global defaults", group: null },
      ];
      const guilds = this.data?.scopes.guildIds ?? [];
      const servers = this.data?.scopes.serverIds ?? [];
      if (guilds.length) {
        opts.push({
          group: "A specific guild (slash commands)",
          items: guilds.map((g) => ({ value: `guild:${g}`, label: this.guildName(g) })),
        });
      }
      if (servers.length) {
        opts.push({
          group: "A specific server (in-game commands)",
          items: servers.map((s) => ({ value: `server:${s}`, label: s })),
        });
      }
      return opts;
    },
    enabledOptions(): { value: string; label: string }[] {
      return [
        { value: "inherit", label: this.scope === "global" ? "Default" : "Inherit" },
        { value: "true", label: "On" },
        { value: "false", label: "Off" },
      ];
    },
    adminOptions(): { value: string; label: string }[] {
      return [
        { value: "inherit", label: this.scope === "global" ? "Default" : "Inherit" },
        { value: "false", label: "Everyone" },
        { value: "true", label: "Admins" },
      ];
    },
    visibleSections(): Section[] {
      if (!this.data) return [];
      const slash: Section = { kind: "slash", title: "Slash commands", prefix: "/", commands: this.data.manifest.slash };
      const ingame: Section = { kind: "ingame", title: "In-game commands", prefix: "!", commands: this.data.manifest.ingame };
      if (this.scope.startsWith("guild:")) return [slash];
      if (this.scope.startsWith("server:")) return [ingame];
      return [slash, ingame];
    },
  },
  async mounted() {
    void this.loadGuildNames();
    await this.load();
  },
  methods: {
    filtered(section: Section): ManifestEntry[] {
      const q = this.query.trim().toLowerCase();
      if (!q) return section.commands;
      return section.commands.filter(
        (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
      );
    },
    scopeLabel(value: string): string {
      if (value === "global") return "Global defaults";
      if (value.startsWith("guild:")) return this.guildName(value.slice(6));
      if (value.startsWith("server:")) return value.slice(7);
      return value;
    },
    scopeIcon(value: string): string {
      if (value.startsWith("guild:")) return "pi pi-discord";
      if (value.startsWith("server:")) return "pi pi-server";
      return "pi pi-globe";
    },
    effectiveLabel(name: string): string {
      const eff = this.effectiveFor(name);
      if (!eff) return "—";
      return `${eff.enabled ? "On" : "Off"}${eff.adminOnly ? " · admins" : ""}`;
    },
    effectiveSeverity(name: string): string {
      const eff = this.effectiveFor(name);
      if (!eff) return "secondary";
      return eff.enabled ? "success" : "danger";
    },
    effectiveState(name: string): string {
      const eff = this.effectiveFor(name);
      if (!eff) return "";
      return eff.enabled ? "on" : "off";
    },
  },
});
</script>

<style scoped>
.controls { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
.ctl-label { display: block; margin-bottom: 5px; letter-spacing: 0.02em; }
.scope-field { flex: 1; min-width: 240px; }
.search-field { flex: 1; min-width: 200px; }
.scope-select { width: 100%; }
.search-input { width: 100%; }
.scope-value { display: flex; align-items: center; gap: 8px; }
.scope-value i { color: var(--mc-accent); font-size: 13px; }

.scope-hint { display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; margin: 0 0 18px; }
.scope-hint i { color: var(--mc-accent); margin-top: 2px; }

/* Card grid inside each accordion section */
.panel-h { display: flex; align-items: center; gap: 9px; font-weight: 500; }
.panel-h i { color: var(--mc-accent); font-size: 13px; }
.count {
  background: var(--mc-card); color: var(--mc-muted);
  border-radius: 999px; padding: 1px 9px; font-size: 12px; font-weight: 400;
}
.no-match { padding: 14px 4px; }
.cmd-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 12px; padding: 6px 2px 4px;
}
.cmd-card {
  border: 0.5px solid var(--mc-border); border-left: 2px solid var(--mc-border-strong);
  border-radius: 9px; padding: 12px 14px; background: var(--mc-surface);
  display: flex; flex-direction: column; gap: 8px;
}
.cmd-card.on { border-left-color: var(--mc-accent); }
.cmd-card.off { border-left-color: var(--mc-bad); }
.cmd-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cmd-name { color: var(--mc-accent); font-family: ui-monospace, monospace; font-size: 13.5px; }
.cmd-desc { margin: 0; line-height: 1.45; min-height: 2.6em; }
.cmd-controls { display: flex; flex-direction: column; gap: 9px; margin-top: 2px; }
.cmd-ctl { display: flex; flex-direction: column; gap: 4px; }
.cmd-ctl-label { letter-spacing: 0.02em; }
.cmd-ctl :deep(.p-selectbutton) { display: flex; }
.cmd-ctl :deep(.p-togglebutton) { flex: 1; }
</style>
