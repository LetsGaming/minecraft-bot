<template>
  <div class="guilds-view">
    <ViewHeader :title="t('guilds.title')" :subtitle="t('guilds.lede')">
      <template v-if="ready && guildRows.length > 0" #actions>
        <Button class="tap" :label="t('guilds.setUp')" icon="pi pi-plus" @click="openWizard('')" />
      </template>
    </ViewHeader>

    <!-- The invite action lives in the sidebar, on every page; this only points at it. -->
    <p class="gv-invite">
      <i class="pi pi-discord" aria-hidden="true" />
      <span>{{ t("guilds.inviteLead") }} <strong>{{ t("shell.invite") }}</strong> {{ t("guilds.inviteTail") }}</span>
    </p>

    <p v-if="!ready && !failure" class="gv-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("guilds.loading") }}
    </p>

    <InlineError
      v-else-if="failure"
      :title="failure.title"
      :recovery="failure.recovery"
      :detail="failure.detail"
      :busy="loading"
      :heading-level="2"
      @retry="reload"
    >
      <template v-if="failure.fixInConfig" #actions>
        <Button
          class="tap"
          :label="t('guilds.openConfig')"
          icon="pi pi-sliders-h"
          size="small"
          severity="secondary"
          outlined
          @click="$emit('goto-config')"
        />
      </template>
    </InlineError>

    <EmptyState
      v-else-if="guildIds.length === 0"
      icon="pi pi-inbox"
      :title="t('guilds.emptyTitle')"
      :heading-level="2"
    >
      {{ guildRows.length > 0 ? t("guilds.emptyWaiting", { count: guildRows.length }) : t("guilds.emptyNoBot") }}
      <template v-if="guildRows.length > 0" #action>
        <Button class="tap" :label="t('guilds.setUpFirst')" icon="pi pi-plus" @click="openWizard('')" />
      </template>
    </EmptyState>

    <section v-else class="gv-list" aria-labelledby="gv-list-h">
      <h2 id="gv-list-h" class="gv-caps">
        {{ t("guilds.configured") }} <span class="gv-count">{{ guildIds.length }}</span>
      </h2>
      <article v-for="gid in guildIds" :key="gid" class="gv-card" :aria-labelledby="`gv-name-${gid}`">
        <div class="gv-head">
          <div class="gv-identity">
            <GuildAvatar :guild-id="gid" :size="34" />
            <h3 :id="`gv-name-${gid}`" class="gv-name">{{ guildName(gid) }}</h3>
          </div>
          <div class="gv-actions">
            <Button
              class="tap"
              :label="t('guilds.editConfig')"
              icon="pi pi-sliders-h"
              size="small"
              @click="openConfigEditor(gid)"
            />
            <Button
              v-tooltip.top="t('guilds.wizardTip')"
              class="tap"
              :label="t('guilds.wizard')"
              icon="pi pi-sparkles"
              size="small"
              severity="secondary"
              outlined
              @click="openWizard(gid)"
            />
          </div>
        </div>

        <div class="gv-features">
          <h4 class="gv-caps">{{ t("guilds.features") }}</h4>
          <ul v-if="enabledFeatures(gid).length" class="gv-chips">
            <li v-for="f in enabledFeatures(gid)" :key="f.key" v-tooltip.top="f.hint" class="gv-chip">
              <i :class="f.icon" aria-hidden="true" /> {{ f.label }}
            </li>
          </ul>
          <p v-else class="gv-none">{{ t("guilds.noFeatures") }}</p>
        </div>

        <div v-if="sysadmin" class="gv-foot">
          <Button
            v-tooltip.top="t('guilds.advancedTip')"
            class="tap"
            :label="t('guilds.advanced')"
            icon="pi pi-code"
            size="small"
            text
            severity="secondary"
            @click="$emit('goto-config')"
          />
        </div>
      </article>
    </section>

    <SetupWizard
      v-model:visible="wizardOpen"
      :initial-guild-id="wizardGuildId"
      :sysadmin="sysadmin"
      @written="reload"
    />

    <GuildConfigEditor
      v-model:visible="configEditorOpen"
      :guild-id="configEditorGuildId"
      :guild-name="guildName(configEditorGuildId)"
      @saved="reload"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import SetupWizard from "../components/SetupWizard.vue";
import GuildConfigEditor from "../components/schema/GuildConfigEditor.vue";
import ViewHeader from "../components/ui/ViewHeader.vue";
import GuildAvatar from "../components/ui/GuildAvatar.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineError from "../components/ui/InlineError.vue";
import { GUILD_FEATURE_KEYS, type GuildFeatureKey } from "@mcbot/schema";
import { useGuilds } from "../composables/useGuilds";
import { useMyGuilds } from "../composables/useMyGuilds";
import { describeDiscordFailure, type DiscordFailureCopy } from "../utils/discordFailure";
import { FEATURE_ICON, featureHint, featureLabel } from "../utils/guildFeatures";
import { t } from "../i18n";

interface FeatureChip {
  key: GuildFeatureKey;
  label: string;
  icon: string;
  hint: string;
}

export default defineComponent({
  name: "GuildsView",
  components: { Button, SetupWizard, GuildConfigEditor, ViewHeader, GuildAvatar, EmptyState, InlineError },
  props: {
    sysadmin: { type: Boolean, default: false },
    /** The guild whose config editor the URL (`#/guilds/<id>`) opens. */
    guildId: { type: String, default: "" },
  },
  emits: ["goto-config", "update-route"],
  setup() {
    const { guilds: guildRows, loading, cause, load: loadGuilds } = useMyGuilds();
    const { guildName, load: loadGuildNames } = useGuilds();
    return { t, guildRows, loading, loadError: cause, loadGuilds, guildName, loadGuildNames };
  },
  data() {
    return {
      wizardOpen: false,
      wizardGuildId: "",
      configEditorOpen: false,
      configEditorGuildId: "",
      loadedOnce: false,
    };
  },
  computed: {
    ready(): boolean {
      return this.loadedOnce && !this.loadError;
    },
    failure(): DiscordFailureCopy | null {
      if (!this.loadError) return null;
      return describeDiscordFailure(this.loadError, this.sysadmin, {
        title: t("guilds.loadFailed"),
        recovery: t("guilds.loadFailedRecovery"),
      });
    },
    guildIds(): string[] {
      return this.guildRows.filter((g) => g.configured).map((g) => g.id);
    },
  },
  watch: {
    guildId(id: string) {
      if (id && !this.configEditorOpen) this.openConfigEditor(id);
    },
    configEditorOpen(open: boolean) {
      const id = open ? this.configEditorGuildId : "";
      if (id !== this.guildId) this.$emit("update-route", { params: { guildId: id || undefined } });
    },
  },
  async mounted() {
    await this.reload();
    if (this.guildId) this.openConfigEditor(this.guildId);
  },
  methods: {
    async reload() {
      // Names (for display) and the scoped guild list load together; a
      // name-lookup failure is non-fatal.
      void this.loadGuildNames();
      await this.loadGuilds(true);
      this.loadedOnce = true;
    },
    openWizard(gid: string) {
      this.wizardGuildId = gid;
      this.wizardOpen = true;
    },
    openConfigEditor(gid: string) {
      this.configEditorGuildId = gid;
      this.configEditorOpen = true;
    },
    enabledFeatures(gid: string): FeatureChip[] {
      const row = this.guildRows.find((g) => g.id === gid);
      const keys = new Set(row?.features ?? []);
      return GUILD_FEATURE_KEYS.filter((key) => keys.has(key)).map((key) => ({
        key,
        label: featureLabel(key),
        icon: FEATURE_ICON[key],
        hint: featureHint(key),
      }));
    },
  },
});
</script>

<style scoped>
.guilds-view { display: flex; flex-direction: column; gap: var(--space-4); }
.guilds-view > :deep(.view-head) { margin-bottom: 0; }

.gv-invite {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: baseline;
  max-width: 78ch;
  margin: 0;
  color: var(--text-dim);
  font-size: var(--text-sm);
}
.gv-invite i { color: var(--discord); }
.gv-invite strong { color: var(--text); }

.gv-note { margin: 0; padding: var(--space-5) 0; color: var(--text-dim); }

.gv-caps {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-dim);
}
.gv-count {
  margin-left: var(--space-1);
  padding: 0 7px;
  border-radius: var(--radius-full);
  background: var(--surface-raised);
  color: var(--text);
  font-weight: 500;
}

.gv-list { display: flex; flex-direction: column; gap: var(--space-3); }
.gv-card {
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  min-width: 0;
}
.gv-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding-bottom: var(--space-3);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.gv-identity { display: flex; align-items: center; gap: var(--space-3); min-width: 0; flex: 1 1 16ch; }
.gv-name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.gv-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.gv-features { display: flex; flex-direction: column; gap: var(--space-2); }
.gv-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.gv-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px var(--space-2);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-control);
  background: var(--accent-tint);
  color: var(--text);
  font-size: var(--text-xs);
}
.gv-chip i { color: var(--accent); font-size: var(--text-xs); }
.gv-none { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }

.gv-foot { margin-top: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--border); }

@media (max-width: 760px) {
  .gv-actions { width: 100%; }
  .gv-actions > * { flex: 1 1 auto; }
}
</style>
