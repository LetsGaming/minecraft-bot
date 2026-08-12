<template>
  <div>
    <ViewHeader title="Commands" subtitle="Turn commands on or off and choose who can use them, per scope." />

    <!-- Sticky toolbar: the scope being edited, the filters, and the save
         state stay on screen. All three used to scroll away after the first
         few commands, so 3000px down the page you could no longer see which
         scope you were editing or that you had unsaved work. -->
    <div class="toolbar">
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
        <div class="show-field">
          <label class="ctl-label muted small">Show</label>
          <SelectButton
            v-model="showFilter"
            :options="showOptions"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
            size="small"
          />
        </div>
        <div class="layout-field">
          <label class="ctl-label muted small">Layout</label>
          <SelectButton
            v-model="layout"
            :options="layoutOptions"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
            size="small"
            aria-label="Layout"
          />
        </div>
      </div>

      <div class="toolbar-actions">
        <span v-if="dirty" class="dirty-note small">
          <i class="pi pi-circle-fill" />
          {{ pendingCount() }} unsaved {{ pendingCount() === 1 ? "change" : "changes" }}
        </span>
        <Button
          v-if="overriddenCount() > 0"
          :label="`Reset ${scopeLabel(scope)}`"
          icon="pi pi-undo"
          size="small"
          severity="secondary"
          outlined
          v-tooltip.top="'Clear every override at this scope and fall back to the inherited settings.'"
          @click="confirmReset"
        />
        <Button
          v-if="dirty"
          label="Discard"
          size="small"
          severity="secondary"
          text
          :disabled="saving"
          @click="discard"
        />
        <Button
          label="Save changes"
          icon="pi pi-save"
          size="small"
          :disabled="saving || !dirty"
          :loading="saving"
          @click="save"
        />
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
            {{ noMatchText }}
          </div>
          <div v-else :class="['cmd-grid', layout]">
            <div
              v-for="cmd in filtered(section)"
              :key="cmd.name"
              :class="['cmd-card', effectiveState(cmd.name)]"
            >
              <div class="cmd-card-head">
                <code class="cmd-name">{{ section.prefix }}{{ cmd.name }}</code>
                <Tag
                  v-if="isOverridden(cmd.name)"
                  value="overridden"
                  severity="warn"
                  v-tooltip.top="'Set explicitly at this scope rather than inherited.'"
                />
                <Tag :value="effectiveLabel(cmd.name)" :severity="effectiveSeverity(cmd.name)" />
              </div>
              <p class="cmd-desc muted small">{{ cmd.description }}</p>
              <p class="cmd-usage muted small">
                {{ usageLabel(cmd.name) }}
              </p>
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

              <!-- Command-specific options (e.g. /map's URL) -->
              <div v-if="optionSpecs(cmd.name).length" class="cmd-options">
                <div
                  v-for="opt in optionSpecs(cmd.name)"
                  :key="opt.key"
                  class="cmd-ctl"
                >
                  <span class="cmd-ctl-label muted small">{{ opt.label }}</span>
                  <SelectButton
                    v-if="opt.type === 'boolean'"
                    :modelValue="optionValue(cmd.name, opt.key) || 'inherit'"
                    :options="enabledOptions"
                    optionLabel="label"
                    optionValue="value"
                    :allowEmpty="false"
                    size="small"
                    @update:modelValue="
                      setOption(cmd.name, opt.key, $event === 'inherit' ? '' : $event, 'boolean')
                    "
                  />
                  <InputText
                    v-else
                    :modelValue="optionValue(cmd.name, opt.key)"
                    :placeholder="opt.placeholder ?? ''"
                    :type="opt.type === 'number' ? 'number' : 'text'"
                    size="small"
                    class="cmd-opt-input"
                    @update:modelValue="setOption(cmd.name, opt.key, $event ?? '', opt.type)"
                  />
                  <span v-if="opt.help" class="cmd-opt-help muted small">{{ opt.help }}</span>
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
import { useConfirm } from "primevue/useconfirm";
import { useGuilds } from "../composables/useGuilds";
import { useCommands, type ManifestEntry } from "../composables/useCommands";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";

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
    return { ...commands, guildName, loadGuildNames, confirm: useConfirm() };
  },
  data() {
    return {
      query: "",
      showFilter: "all",
      layout: "list",
      showOptions: [
        { value: "all", label: "All" },
        { value: "overridden", label: "Overridden" },
        { value: "unused", label: "Unused" },
      ],
      layoutOptions: [
        { value: "list", label: "List" },
        { value: "cards", label: "Cards" },
      ],
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
    /** What to say when a filter, not the search box, emptied the list. */
    noMatchText(): string {
      if (this.showFilter === "overridden") return "Nothing is overridden at this scope.";
      if (this.showFilter === "unused") return "Every command here has been used recently.";
      return `No commands match “${this.query}”.`;
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
    /**
     * Usage over the reporting window, or an explicit "unused" — the
     * distinction the whole column exists for. An unused command is
     * either badly advertised or worth deleting, and silence would hide
     * both.
     */
    usageLabel(name: string): string {
      const window = this.data?.usage?.windowDays ?? 30;
      const row = this.data?.usage?.byCommand?.[name];
      if (!row || row.count === 0) return `Not used in ${window} days`;
      const uses = row.count === 1 ? "1 use" : `${row.count} uses`;
      const users = row.users === 1 ? "1 person" : `${row.users} people`;
      return `${uses} by ${users} in ${window} days`;
    },
    /**
     * Text search plus the "show" facet.
     *
     * Both narrowings matter at this size: with 57 commands on one page the
     * questions people actually arrive with are "what have I changed here"
     * and "what is nobody using", and neither was answerable without reading
     * every card.
     */
    filtered(section: Section): ManifestEntry[] {
      const q = this.query.trim().toLowerCase();
      return section.commands.filter((c) => {
        if (q && !c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) {
          return false;
        }
        if (this.showFilter === "overridden") return this.isOverridden(c.name);
        if (this.showFilter === "unused") return this.isUnused(c.name);
        return true;
      });
    },
    /** No uses recorded over the reporting window. */
    isUnused(name: string): boolean {
      return (this.data?.usage?.byCommand?.[name]?.count ?? 0) === 0;
    },
    confirmReset(): void {
      this.confirm.require({
        header: "Reset this scope",
        message:
          `Clear all ${this.overriddenCount()} override(s) on ` +
          `${this.scopeLabel(this.scope)}? Every command there falls back to what it inherits. ` +
          `Nothing is written until you save.`,
        icon: "pi pi-undo",
        acceptLabel: "Clear overrides",
        rejectLabel: "Cancel",
        accept: () => this.resetScope(),
      });
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
/* Usage is information, not a warning. Amber on "Not used in 30 days" made
   every quiet command look like a fault to fix. */
.cmd-usage { margin: 0.25rem 0 0; }

/* ── Sticky toolbar ── */
.toolbar {
  position: sticky; top: 0; z-index: 5;
  display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px;
  justify-content: space-between;
  padding: 10px 0 12px;
  margin-bottom: 4px;
  background: var(--mc-bg);
  border-bottom: 0.5px solid var(--mc-border);
}
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.dirty-note { color: var(--mc-mid); display: inline-flex; align-items: center; gap: 6px; }
.dirty-note i { font-size: 7px; }

.controls { display: flex; flex-wrap: wrap; gap: 14px; flex: 1; min-width: 280px; }
.ctl-label { display: block; margin-bottom: 5px; letter-spacing: 0.02em; }
.scope-field { flex: 2; min-width: 220px; }
.search-field { flex: 2; min-width: 180px; }
.show-field, .layout-field { flex: none; }
.scope-select { width: 100%; }
.search-input { width: 100%; }
.scope-value { display: flex; align-items: center; gap: 8px; }
.scope-value i { color: var(--mc-accent); font-size: 13px; }

/* A group heading in the scope list is a heading, not a disabled option. */
.scope-select :deep(.p-select-option-group) {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--mc-dim); background: var(--mc-card);
  padding-top: 8px; padding-bottom: 4px;
}

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
.cmd-grid { padding: 6px 2px 4px; }
.cmd-grid.cards {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px;
}

/* List is the default: 57 cards each repeating the labels "Enabled" and
   "Who can use it" is the same two words rendered 114 times. In a row the
   controls line up in columns and the labels are implied by position. */
.cmd-grid.list { display: flex; flex-direction: column; gap: 6px; }
.cmd-grid.list .cmd-card {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(0, 2fr) auto auto;
  align-items: center; gap: 8px 16px;
  padding: 8px 12px;
}
.cmd-grid.list .cmd-card-head { grid-column: 1; }
.cmd-grid.list .cmd-desc {
  grid-column: 2; min-height: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cmd-grid.list .cmd-usage { grid-column: 3; margin: 0; white-space: nowrap; }
.cmd-grid.list .cmd-controls {
  grid-column: 4; flex-direction: row; align-items: center; gap: 10px; margin: 0;
}
.cmd-grid.list .cmd-ctl-label { display: none; }
.cmd-grid.list .cmd-options { grid-column: 1 / -1; }
@media (max-width: 1100px) {
  .cmd-grid.list .cmd-card { grid-template-columns: 1fr; }
  .cmd-grid.list .cmd-desc { white-space: normal; }
  .cmd-grid.list .cmd-ctl-label { display: block; }
}
.cmd-card {
  border: 0.5px solid var(--mc-border); border-left: 2px solid var(--mc-border-strong);
  border-radius: 9px; padding: 12px 14px; background: var(--mc-surface);
  display: flex; flex-direction: column; gap: 8px;
}
.cmd-card.on { border-left-color: var(--mc-accent); }
.cmd-card.off { border-left-color: var(--mc-bad); }
.cmd-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.cmd-name { color: var(--mc-accent); font-family: ui-monospace, monospace; font-size: 13.5px; }
.cmd-desc { margin: 0; line-height: 1.45; min-height: 2.6em; }
.cmd-controls { display: flex; flex-direction: column; gap: 9px; margin-top: 2px; }
.cmd-options {
  display: flex; flex-direction: column; gap: 9px;
  margin-top: 10px; padding-top: 10px;
  border-top: 0.5px solid var(--mc-border);
}
.cmd-opt-input { width: 100%; }
.cmd-opt-help { line-height: 1.35; }
.cmd-ctl { display: flex; flex-direction: column; gap: 4px; }
.cmd-ctl-label { letter-spacing: 0.02em; }
.cmd-ctl :deep(.p-selectbutton) { display: flex; }
.cmd-ctl :deep(.p-togglebutton) { flex: 1; }
</style>
