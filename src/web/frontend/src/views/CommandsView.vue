<template>
  <div class="commands-view">
    <ViewHeader :title="t('commands.title')" :subtitle="t('commands.lede')" />

    <p v-if="!ready && !loadError" class="cmd-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("commands.loading") }}
    </p>

    <EmptyState
      v-else-if="manifestMissing"
      icon="pi pi-list"
      :title="t('commands.noManifestTitle')"
      :heading-level="2"
    >
      {{ t("commands.noManifestText") }}
      <template #action>
        <span class="cmd-empty-actions">
          <Button class="tap" :label="t('commands.reload')" icon="pi pi-refresh" :loading="loading" @click="load" />
          <Button
            class="tap"
            :label="t('commands.openOverview')"
            icon="pi pi-home"
            severity="secondary"
            outlined
            @click="$emit('navigate', 'overview')"
          />
        </span>
      </template>
    </EmptyState>

    <InlineError
      v-else-if="!ready"
      :title="t('commands.loadFailed')"
      :recovery="t('commands.loadFailedRecovery')"
      :detail="loadError"
      :busy="loading"
      :heading-level="2"
      @retry="load"
    />

    <EditorShell v-else :state="editorState">
      <template #banners>
        <InlineBanner v-if="stale" tone="warn" :title="t('commands.staleTitle')">
          {{ t("commands.staleText") }}
          <template #actions>
            <Button class="tap" :label="t('commands.reload')" icon="pi pi-refresh" size="small" severity="secondary" outlined @click="load" />
          </template>
        </InlineBanner>
        <InlineBanner v-if="bannerErrors.length" tone="danger" :title="t('commands.saveFailedTitle')">
          <ul class="cmd-list">
            <li v-for="(line, i) in bannerErrors" :key="i">{{ line }}</li>
          </ul>
        </InlineBanner>
      </template>

      <template #conflict>
        <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
      </template>
      <template #conflict-actions>
        <Button
          class="tap"
          :label="t('commands.dropMine')"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          @click="reloadDiscardingMine"
        />
      </template>

      <!-- The edit bar and the filters stay on screen together on wide
           screens, so the scope being edited never scrolls out of sight. -->
      <template #bar>
        <div class="cmd-sticky">
          <EditBar
            :state="editorState"
            :change-count="pendingCount()"
            :conflict-count="conflicts.length"
            :can-save="!stale"
            :save-hint="t('commands.saveHint')"
            :saving-hint="t('commands.savingHint')"
            @save="onSave"
            @discard="discard"
          >
            <template #status>
              <ConfigStatusChip :refresh-key="savedCount" />
            </template>
            <template #extra>
              <Button
                v-if="overriddenCount() > 0"
                v-tooltip.top="t('commands.resetTip')"
                class="tap"
                :label="t('commands.reset', { scope: scopeLabel(scope) })"
                icon="pi pi-undo"
                severity="secondary"
                outlined
                :disabled="saving"
                @click="confirmReset"
              />
            </template>
          </EditBar>

          <div class="cmd-filters" role="group" :aria-label="t('commands.filters')">
            <div class="cf-scope">
              <label id="cmd-scope-label" class="cf-label" for="cmd-scope">{{ t("commands.scopeLabel") }}</label>
              <Select
                v-model="scope"
                :options="scopeOptions"
                option-label="label"
                option-value="value"
                option-group-label="group"
                option-group-children="items"
                label-id="cmd-scope"
                aria-labelledby="cmd-scope-label"
                class="cf-full"
              >
                <template #value="{ value }">
                  <span class="scope-value">
                    <i :class="scopeIcon(value)" aria-hidden="true" /> {{ scopeLabel(value) }}
                  </span>
                </template>
              </Select>
            </div>
            <div class="cf-find">
              <label class="cf-label" for="cmd-find">{{ t("commands.findLabel") }}</label>
              <IconField>
                <InputIcon class="pi pi-search" />
                <InputText
                  id="cmd-find"
                  v-model="query"
                  type="search"
                  autocomplete="off"
                  :placeholder="t('commands.findPlaceholder')"
                  class="cf-full"
                />
              </IconField>
            </div>
            <div class="cf-seg">
              <span id="cmd-show-label" class="cf-label">{{ t("commands.showLabel") }}</span>
              <SelectButton
                v-model="showFilter"
                :options="showOptions"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                size="small"
                aria-labelledby="cmd-show-label"
              />
            </div>
            <div class="cf-seg">
              <span id="cmd-layout-label" class="cf-label">{{ t("commands.layoutLabel") }}</span>
              <SelectButton
                v-model="layout"
                :options="layoutOptions"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                size="small"
                aria-labelledby="cmd-layout-label"
              />
            </div>
          </div>
        </div>
      </template>

      <template #toolbar>
        <p class="scope-hint">
          <i class="pi pi-info-circle" aria-hidden="true" />
          <span v-if="scope === 'global'">{{ t("commands.hintGlobal") }}</span>
          <span v-else>
            {{ t("commands.hintScopeLead") }} <strong>{{ scopeLabel(scope) }}</strong>. {{ t("commands.hintScopeTail") }}
          </span>
        </p>
      </template>

      <template #default="{ locked }">
        <Accordion v-model:value="openPanels" multiple>
          <AccordionPanel v-for="section in visibleSections" :key="section.kind" :value="section.kind">
            <h2 class="panel-heading">
              <AccordionHeader>
                <span class="panel-h">
                  <i :class="section.kind === 'slash' ? 'pi pi-bolt' : 'pi pi-hashtag'" aria-hidden="true" />
                  {{ section.title }}
                  <span class="count">{{ filtered(section).length }}</span>
                </span>
              </AccordionHeader>
            </h2>
            <AccordionContent>
              <p v-if="filtered(section).length === 0" class="no-match" aria-live="polite">{{ noMatchText }}</p>
              <template v-else>
                <!-- Grouped by source folder, mirroring the repo layout. A
                     single group renders without a heading over one list. -->
                <div v-for="group in categoryGroups(section)" :key="group.category" class="cat-group">
                  <h3 v-if="categoryGroups(section).length > 1" class="cat-head">
                    {{ group.label }}
                    <span class="cat-count">{{ group.commands.length }}</span>
                  </h3>
                  <ul :class="['cmd-grid', layout]">
                    <li
                      v-for="cmd in group.commands"
                      :key="cmd.name"
                      :class="['cmd-card', effectiveState(cmd.name)]"
                    >
                      <div class="cmd-card-head">
                        <code :id="ctlId(section, cmd.name, 'name')" class="cmd-name">{{ section.prefix }}{{ cmd.name }}</code>
                        <span v-if="isOverridden(cmd.name)" v-tooltip.top="t('commands.overriddenTip')" class="cmd-tag">
                          {{ t("commands.overridden") }}
                        </span>
                        <StatusChip :state="effectiveRole(cmd.name)" :label="effectiveLabel(cmd.name)" />
                      </div>
                      <p class="cmd-desc">{{ cmd.description }}</p>
                      <p class="cmd-usage">{{ usageLabel(cmd.name) }}</p>
                      <div class="cmd-controls">
                        <div class="cmd-ctl">
                          <span :id="ctlId(section, cmd.name, 'enabled')" class="cmd-ctl-label">{{ t("commands.enabled") }}</span>
                          <SelectButton
                            :model-value="fieldValue(cmd.name, 'enabled')"
                            :options="enabledOptions"
                            option-label="label"
                            option-value="value"
                            :allow-empty="false"
                            size="small"
                            :disabled="locked"
                            :aria-labelledby="`${ctlId(section, cmd.name, 'name')} ${ctlId(section, cmd.name, 'enabled')}`"
                            @update:model-value="setField(cmd.name, 'enabled', $event)"
                          />
                        </div>
                        <div class="cmd-ctl">
                          <span :id="ctlId(section, cmd.name, 'who')" class="cmd-ctl-label">{{ t("commands.who") }}</span>
                          <SelectButton
                            :model-value="fieldValue(cmd.name, 'adminOnly')"
                            :options="adminOptions"
                            option-label="label"
                            option-value="value"
                            :allow-empty="false"
                            size="small"
                            :disabled="locked"
                            :aria-labelledby="`${ctlId(section, cmd.name, 'name')} ${ctlId(section, cmd.name, 'who')}`"
                            @update:model-value="setField(cmd.name, 'adminOnly', $event)"
                          />
                        </div>
                      </div>

                      <div v-if="optionSpecs(cmd.name).length" class="cmd-options">
                        <div v-for="opt in optionSpecs(cmd.name)" :key="opt.key" class="cmd-ctl">
                          <label
                            :id="ctlId(section, cmd.name, `opt-${opt.key}-l`)"
                            :for="ctlId(section, cmd.name, `opt-${opt.key}`)"
                            class="cmd-opt-label"
                          >{{ opt.label }}</label>
                          <SelectButton
                            v-if="opt.type === 'boolean'"
                            :model-value="optionValue(cmd.name, opt.key) || 'inherit'"
                            :options="enabledOptions"
                            option-label="label"
                            option-value="value"
                            :allow-empty="false"
                            size="small"
                            :disabled="locked"
                            :aria-labelledby="`${ctlId(section, cmd.name, 'name')} ${ctlId(section, cmd.name, `opt-${opt.key}-l`)}`"
                            @update:model-value="setOption(cmd.name, opt.key, $event === 'inherit' ? '' : $event, 'boolean')"
                          />
                          <InputText
                            v-else
                            :id="ctlId(section, cmd.name, `opt-${opt.key}`)"
                            :model-value="optionValue(cmd.name, opt.key)"
                            :placeholder="opt.placeholder ?? ''"
                            :type="opt.type === 'number' ? 'number' : 'text'"
                            :disabled="locked"
                            :aria-describedby="opt.help ? ctlId(section, cmd.name, `opt-${opt.key}-h`) : undefined"
                            class="cmd-opt-input"
                            @update:model-value="setOption(cmd.name, opt.key, $event ?? '', opt.type)"
                          />
                          <span v-if="opt.help" :id="ctlId(section, cmd.name, `opt-${opt.key}-h`)" class="cmd-opt-help">{{ opt.help }}</span>
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
              </template>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </EditorShell>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Select from "primevue/select";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Accordion from "primevue/accordion";
import AccordionPanel from "primevue/accordionpanel";
import AccordionHeader from "primevue/accordionheader";
import AccordionContent from "primevue/accordioncontent";
import { StatusRole } from "@mcbot/schema";
import { useGuilds } from "../composables/useGuilds";
import { useCommands, type ManifestEntry } from "../composables/useCommands";
import { useConfirmAction } from "../composables/useConfirmAction";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import EditorShell from "../components/ui/EditorShell.vue";
import EditBar from "../components/ui/EditBar.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import InlineError from "../components/ui/InlineError.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import ConfigStatusChip from "../components/ui/ConfigStatusChip.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import type { EditorState } from "../components/ui/types";
import { t, type MessageKey } from "../i18n";

interface Section {
  kind: string;
  title: string;
  prefix: string;
  commands: ManifestEntry[];
}

/** Fixed order, so the categories edited most sit near the top. */
const CATEGORY_ORDER = [
  "connection", "server", "moderation", "admin",
  "info", "stats", "communication", "general", "shared", "other",
] as const;

export default defineComponent({
  name: "CommandsView",
  components: {
    Select, Button, SelectButton, InputText, IconField, InputIcon,
    Accordion, AccordionPanel, AccordionHeader, AccordionContent,
    ViewHeader, EmptyState, EditorShell, EditBar, InlineBanner, InlineError,
    StatusChip, ConfigStatusChip, ConflictPicker,
  },
  emits: ["navigate"],
  setup() {
    const commands = useCommands();
    const { guildName, load: loadGuildNames } = useGuilds();
    return { ...commands, t, guildName, loadGuildNames, confirmAction: useConfirmAction() };
  },
  data() {
    return {
      query: "",
      showFilter: "all",
      layout: "list",
      showOptions: [
        { value: "all", label: t("commands.showAll") },
        { value: "overridden", label: t("commands.showOverridden") },
        { value: "unused", label: t("commands.showUnused") },
      ],
      layoutOptions: [
        { value: "list", label: t("commands.layoutList") },
        { value: "cards", label: t("commands.layoutCards") },
      ],
      openPanels: ["slash", "ingame"] as string[],
      savedCount: 0,
    };
  },
  computed: {
    editorState(): EditorState {
      if (this.saving) return "saving";
      if (this.conflicts.length > 0) return "conflict";
      if (this.dirty) return "dirty";
      return "clean";
    },
    /** The conflict banner already says why a save stopped on a conflict. */
    bannerErrors(): string[] {
      return this.conflicts.length > 0 ? [] : this.saveFailure;
    },
    scopeOptions(): unknown[] {
      const opts: unknown[] = [{ value: "global", label: t("commands.scopeGlobal"), group: null }];
      const guilds = this.data?.scopes.guildIds ?? [];
      const servers = this.data?.scopes.serverIds ?? [];
      if (guilds.length) {
        opts.push({
          group: t("commands.scopeGroupGuild"),
          items: guilds.map((g) => ({ value: `guild:${g}`, label: this.guildName(g) })),
        });
      }
      if (servers.length) {
        opts.push({
          group: t("commands.scopeGroupServer"),
          items: servers.map((s) => ({ value: `server:${s}`, label: s })),
        });
      }
      return opts;
    },
    enabledOptions(): { value: string; label: string }[] {
      return [
        { value: "inherit", label: this.scope === "global" ? t("commands.optDefault") : t("commands.optInherit") },
        { value: "true", label: t("commands.optOn") },
        { value: "false", label: t("commands.optOff") },
      ];
    },
    adminOptions(): { value: string; label: string }[] {
      return [
        { value: "inherit", label: this.scope === "global" ? t("commands.optDefault") : t("commands.optInherit") },
        { value: "false", label: t("commands.optEveryone") },
        { value: "true", label: t("commands.optAdmins") },
      ];
    },
    /** What to say when a filter, not the search box, emptied the list. */
    noMatchText(): string {
      if (this.showFilter === "overridden") return t("commands.noMatchOverridden");
      if (this.showFilter === "unused") return t("commands.noMatchUnused");
      return t("commands.noMatchQuery", { query: this.query });
    },
    visibleSections(): Section[] {
      if (!this.data) return [];
      const slash: Section = { kind: "slash", title: t("commands.sectionSlash"), prefix: "/", commands: this.data.manifest.slash };
      const ingame: Section = { kind: "ingame", title: t("commands.sectionIngame"), prefix: "!", commands: this.data.manifest.ingame };
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
    async onSave(): Promise<void> {
      if (await this.save()) this.savedCount += 1;
    },
    /** A unique, stable element id for one control of one command. */
    ctlId(section: Section, name: string, part: string): string {
      return `cmd-${section.kind}-${name}-${part}`;
    },
    /**
     * Usage over the reporting window, or an explicit "unused": an unused
     * command is either badly advertised or worth deleting, and silence
     * would hide both.
     */
    usageLabel(name: string): string {
      const days = t("commands.days", { count: this.data?.usage?.windowDays ?? 30 });
      const row = this.data?.usage?.byCommand?.[name];
      if (!row || row.count === 0) return t("commands.unused", { days });
      return t("commands.usage", {
        uses: t("commands.uses", { count: row.count }),
        users: t("commands.users", { count: row.users }),
        days,
      });
    },
    /**
     * The section's filtered commands, grouped by source-folder category.
     * Search and the show facet apply first, so a category with no matches
     * does not appear.
     */
    categoryGroups(section: Section): { category: string; label: string; commands: ManifestEntry[] }[] {
      const buckets = new Map<string, ManifestEntry[]>();
      for (const cmd of this.filtered(section)) {
        const key = cmd.category || "other";
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(cmd);
      }
      const order: readonly string[] = CATEGORY_ORDER;
      const rank = (c: string): number => {
        const i = order.indexOf(c);
        return i === -1 ? order.length : i;
      };
      return [...buckets.entries()]
        .map(([category, commands]) => ({ category, label: this.categoryLabel(category), commands }))
        .sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category));
    },
    categoryLabel(category: string): string {
      if ((CATEGORY_ORDER as readonly string[]).includes(category)) {
        return t(`commands.category.${category}` as MessageKey);
      }
      return category.charAt(0).toUpperCase() + category.slice(1);
    },
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
    async confirmReset(): Promise<void> {
      const scope = this.scopeLabel(this.scope);
      const result = await this.confirmAction({
        level: "disruptive",
        header: t("commands.resetHeader", { scope }),
        message: t("commands.resetMessage", { count: this.overriddenCount(), scope }),
        acceptLabel: t("commands.resetAccept"),
        cancelLabel: t("commands.resetReject"),
      });
      if (result === "confirm") this.resetScope();
    },
    scopeLabel(value: string): string {
      if (value === "global") return t("commands.scopeGlobal");
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
      if (!eff) return t("commands.stateUnknown");
      const state = eff.enabled ? t("commands.stateOn") : t("commands.stateOff");
      return eff.adminOnly ? t("commands.stateAdmins", { state }) : state;
    },
    effectiveRole(name: string): StatusRole {
      const eff = this.effectiveFor(name);
      if (!eff) return StatusRole.Unknown;
      return eff.enabled ? StatusRole.Online : StatusRole.Offline;
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
.commands-view { min-width: 0; }
.cmd-note { margin: 0; padding: var(--space-5) 0; color: var(--text-dim); }
.cmd-empty-actions { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); }
.cmd-list { margin: 0; padding-left: 18px; }

/* The bar and the filters share one sticky block on wide screens. On phones
   the edit bar docks to the bottom edge by itself and the filters scroll. */
.cmd-sticky { display: flex; flex-direction: column; gap: var(--space-3); }
@media (min-width: 761px) {
  .cmd-sticky {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding-bottom: var(--space-3);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
}

.cmd-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3) var(--space-4); }
.cf-label { display: block; margin-bottom: 6px; color: var(--text-dim); font-size: var(--text-sm); }
.cf-scope { flex: 2 1 220px; min-width: 0; }
.cf-find { flex: 2 1 180px; min-width: 0; }
.cf-seg { flex: none; }
.cf-full { width: 100%; }
.scope-value { display: flex; align-items: center; gap: var(--space-2); }
.scope-value i { color: var(--accent); font-size: var(--text-sm); }

.scope-hint {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: baseline;
  max-width: 90ch;
  margin: 0;
  color: var(--text-dim);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
}
.scope-hint i { color: var(--st-info); }
.scope-hint strong { color: var(--text); }

.panel-heading { margin: 0; font: inherit; }
.panel-heading > :deep(.p-accordionheader) { width: 100%; }
.panel-h { display: flex; align-items: center; gap: var(--space-2); font-weight: 500; }
.panel-h i { color: var(--accent); font-size: var(--text-sm); }
.count {
  background: var(--surface-raised); color: var(--text-dim);
  border-radius: var(--radius-full); padding: 1px 9px; font-size: var(--text-xs); font-weight: 400;
}
.no-match { margin: 0; padding: 14px 4px; color: var(--text-dim); font-size: var(--text-sm); }

.cat-group + .cat-group { margin-top: 18px; }
.cat-head {
  display: flex; align-items: center; gap: var(--space-2);
  margin: 0 2px var(--space-2); padding-bottom: 4px;
  font-size: var(--text-xs); font-weight: 600; letter-spacing: var(--tracking-caps);
  text-transform: uppercase; color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.cat-count {
  font-weight: 400; color: var(--text-dim);
  background: var(--surface-raised); border-radius: var(--radius-full);
  padding: 0 7px;
}

.cmd-grid { margin: 0; padding: 6px 2px 4px; list-style: none; }
.cmd-grid.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: var(--space-3); }

/* List is the default: in a row the controls line up in columns and the
   labels are implied by position, instead of repeating them on every card. */
.cmd-grid.list { display: flex; flex-direction: column; gap: 6px; --enabled-col: 210px; --admin-col: 250px; }
.cmd-grid.list .cmd-card {
  display: grid;
  /* Fixed tracks so every row's columns line up vertically. */
  grid-template-columns:
    minmax(160px, 260px)
    minmax(0, 1fr)
    170px
    var(--enabled-col)
    var(--admin-col);
  align-items: center; gap: 4px var(--space-4);
  padding: 8px 12px;
}
.cmd-grid.list .cmd-card-head { grid-column: 1; }
.cmd-grid.list .cmd-desc {
  grid-column: 2; min-height: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cmd-grid.list .cmd-usage { grid-column: 3; margin: 0; text-align: right; }
.cmd-grid.list .cmd-controls { display: contents; }
.cmd-grid.list .cmd-ctl:nth-of-type(1) { grid-column: 4; }
.cmd-grid.list .cmd-ctl:nth-of-type(2) { grid-column: 5; }
.cmd-grid.list .cmd-ctl { margin: 0; }
.cmd-grid.list .cmd-ctl :deep(.p-selectbutton) { width: 100%; }
.cmd-grid.list .cmd-ctl-label { display: none; }
.cmd-grid.list .cmd-options { grid-column: 1 / -1; }
@media (max-width: 1100px) {
  .cmd-grid.list .cmd-card { grid-template-columns: minmax(0, 1fr); }
  .cmd-grid.list .cmd-card > * { grid-column: 1; }
  .cmd-grid.list .cmd-desc { white-space: normal; }
  .cmd-grid.list .cmd-usage { text-align: left; }
  .cmd-grid.list .cmd-controls { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .cmd-grid.list .cmd-ctl { grid-column: auto !important; }
  .cmd-grid.list .cmd-ctl-label { display: block; }
}

.cmd-card {
  min-width: 0;
  border: 1px solid var(--border); border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-surface); padding: 12px 14px; background: var(--surface);
  display: flex; flex-direction: column; gap: var(--space-2);
}
.cmd-card.on { border-left-color: var(--st-online); }
.cmd-card.off { border-left-color: var(--st-offline); }
.cmd-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
.cmd-name { color: var(--accent); font-family: var(--font-mono); font-size: var(--text-sm); overflow-wrap: anywhere; }
.cmd-tag {
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  color: var(--text-dim);
  font-size: var(--text-xs);
}
.cmd-desc, .cmd-usage { margin: 0; color: var(--text-dim); font-size: var(--text-sm); line-height: 1.45; }
.cmd-desc { min-height: 2.6em; }
.cmd-controls { display: flex; flex-direction: column; gap: 9px; margin-top: 2px; }
.cmd-options {
  display: flex; flex-direction: column; gap: 9px;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--border);
}
.cmd-opt-input { width: 100%; }
.cmd-opt-help { color: var(--text-dim); font-size: var(--text-sm); line-height: 1.35; }
.cmd-ctl { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cmd-ctl-label, .cmd-opt-label { color: var(--text-dim); font-size: var(--text-sm); }
.cmd-ctl :deep(.p-selectbutton) { display: flex; }
.cmd-ctl :deep(.p-togglebutton) { flex: 1; }

@media (max-width: 760px) {
  .cf-seg { flex: 1 1 100%; }
  .cf-seg :deep(.p-selectbutton) { display: flex; }
  .cf-seg :deep(.p-togglebutton) { flex: 1; }
  .cmd-grid.list .cmd-controls { flex-direction: column; }
}
@media (pointer: coarse), (max-width: 760px) {
  .cmd-filters :deep(.p-togglebutton),
  .cmd-ctl :deep(.p-togglebutton),
  .commands-view :deep(.p-accordionheader),
  .cf-full,
  .cmd-opt-input { min-height: var(--touch-min); }
  .cf-scope :deep(.p-select-label) { display: flex; align-items: center; min-height: calc(var(--touch-min) - 2px); }
}
</style>
