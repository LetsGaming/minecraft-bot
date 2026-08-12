<template>
  <div>
    <ViewHeader title="Guilds" subtitle="Discord servers the bot is configured for, and how to add more." />

    <!-- The invite action lives in the sidebar, on every page. Repeating it
         here as a hero made it the third copy of one button and pushed the
         list this page exists for below the fold. -->
    <p class="invite-note muted small">
      <i class="pi pi-discord" />
      Not listed? Use <strong>Add to Server</strong> in the sidebar to invite the
      bot to a Discord server you manage, then set it up here.
    </p>

    <div v-if="loading" class="center muted">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.4rem" />
    </div>

    <template v-else>
      <div class="section-label">
        <span class="muted small">CONFIGURED GUILDS · {{ guildIds.length }}</span>
        <Button
          label="Set up a guild"
          icon="pi pi-plus"
          size="small"
          @click="openWizard('')"
        />
      </div>

      <EmptyState v-if="guildIds.length === 0" icon="pi pi-inbox">
        No guilds configured yet.
        <template #action>
          <div class="muted small" style="margin-bottom: 12px">Invite the bot with <strong>Add to Server</strong> in the sidebar, then set up its first guild.</div>
          <Button
            label="Set up first guild"
            icon="pi pi-plus"
            @click="openWizard('')"
          />
        </template>
      </EmptyState>

      <div class="guild-list" v-else>
        <Card v-for="gid in guildIds" :key="gid" class="guild-card">
          <template #content>
            <div class="guild-header">
              <div class="guild-identity">
                <GuildAvatar :guild-id="gid" :size="34" />
                <span class="guild-name">{{ guildName(gid) }}</span>
              </div>
              <div class="guild-actions">
                <Button
                  label="Edit config"
                  icon="pi pi-sliders-h"
                  size="small"
                  @click="openConfigEditor(gid)"
                />
                <Button
                  label="Setup wizard"
                  icon="pi pi-magic"
                  size="small"
                  text
                  severity="secondary"
                  v-tooltip.top="'Step-by-step guided setup for the common features.'"
                  @click="openWizard(gid)"
                />
              </div>
            </div>

            <div class="guild-features">
              <span class="features-label muted small">ACTIVE FEATURES</span>
              <div class="feature-chips">
                <Tag
                  v-for="f in enabledFeatures(gid)"
                  :key="f.key"
                  :value="f.label"
                  :icon="f.icon"
                  severity="success"
                  v-tooltip.top="f.hint"
                />
                <span v-if="enabledFeatures(gid).length === 0" class="muted small">
                  None yet — click <strong>Edit setup</strong> to turn features on.
                </span>
              </div>
            </div>

            <div v-if="sysadmin" class="guild-foot">
              <Button
                label="Advanced JSON config"
                icon="pi pi-code"
                size="small"
                text
                severity="secondary"
                v-tooltip.top="'Opens the full config editor. Only needed for rarely-changed fields the setup wizard does not cover.'"
                @click="$emit('goto-config')"
              />
            </div>
          </template>
        </Card>
      </div>
    </template>

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
import Card from "primevue/card";
import Button from "primevue/button";
import Tag from "primevue/tag";
import SetupWizard from "../components/SetupWizard.vue";
import GuildConfigEditor from "../components/schema/GuildConfigEditor.vue";
import ViewHeader from "../components/ui/ViewHeader.vue";
import GuildAvatar from "../components/ui/GuildAvatar.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useGuilds } from "../composables/useGuilds";
import { useMyGuilds } from "../composables/useMyGuilds";
import { useInvite } from "../composables/useInvite";

// Feature keys inside a guild block → chip label, icon, and a one-line
// hint shown on hover. Kept in sync with GuildConfig and the backend's
// FEATURE_KEYS list.
const FEATURES: { key: string; label: string; icon: string; hint: string }[] = [
  { key: "notifications", label: "Notifications", icon: "pi pi-bell", hint: "Join/leave and server-event messages." },
  { key: "chatBridge", label: "Chat Bridge", icon: "pi pi-comments", hint: "Relays chat between Discord and Minecraft." },
  { key: "leaderboard", label: "Leaderboard", icon: "pi pi-chart-bar", hint: "Scheduled stat leaderboards." },
  { key: "statusEmbed", label: "Status Embed", icon: "pi pi-desktop", hint: "Live auto-updating status embed." },
  { key: "downtimeAlerts", label: "Downtime Alerts", icon: "pi pi-exclamation-triangle", hint: "Alerts when a server goes down." },
  { key: "tpsAlerts", label: "TPS Alerts", icon: "pi pi-gauge", hint: "Alerts on sustained low TPS." },
  { key: "channelPurge", label: "Channel Purge", icon: "pi pi-trash", hint: "Auto-clears a channel on a schedule." },
  { key: "reports", label: "Reports", icon: "pi pi-flag", hint: "Routes in-game !report to a channel." },
  { key: "console", label: "Console", icon: "pi pi-code", hint: "Admin live console relay." },
  { key: "whitelistApplications", label: "Whitelist Apps", icon: "pi pi-user-plus", hint: "Button-based whitelist applications." },
  { key: "linkedRole", label: "Linked Role", icon: "pi pi-link", hint: "Assigns a role to linked members." },
];

export default defineComponent({
  name: "GuildsView",
  components: { Card, Button, Tag, SetupWizard, GuildConfigEditor, ViewHeader, GuildAvatar, EmptyState },
  props: {
    sysadmin: { type: Boolean, default: false },
  },
  emits: ["goto-config"],
  setup() {
    const { guilds: guildRows, loading, load: loadGuilds } = useMyGuilds();
    const { guildName, load: loadGuildNames } = useGuilds();
    const { inviting, invite } = useInvite();
    return { guildRows, loading, loadGuilds, guildName, loadGuildNames, inviting, invite };
  },
  data() {
    return {
      wizardOpen: false,
      wizardGuildId: "",
      configEditorOpen: false,
      configEditorGuildId: "",
    };
  },
  computed: {
    guildIds(): string[] {
      return this.guildRows.filter((g) => g.configured).map((g) => g.id);
    },
  },
  async mounted() {
    await this.reload();
  },
  methods: {
    async reload() {
      // Names (for display) and the scoped guild list load together; a
      // name-lookup failure is non-fatal.
      void this.loadGuildNames();
      await this.loadGuilds();
    },
    openWizard(gid: string) {
      this.wizardGuildId = gid;
      this.wizardOpen = true;
    },
    openConfigEditor(gid: string) {
      this.configEditorGuildId = gid;
      this.configEditorOpen = true;
    },
    enabledFeatures(gid: string): { key: string; label: string; icon: string; hint: string }[] {
      const row = this.guildRows.find((g) => g.id === gid);
      const keys = new Set(row?.features ?? []);
      return FEATURES.filter((f) => keys.has(f.key));
    },
  },
});
</script>

<style scoped>
.invite-note {
  display: flex; align-items: baseline; gap: 8px;
  max-width: 78ch; margin: 0 0 18px;
}
.invite-note i { color: var(--mc-discord); }


.section-label {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0 2px 12px; letter-spacing: 0.05em;
}
.guild-list { display: flex; flex-direction: column; gap: 12px; }
.guild-card { border: 0.5px solid var(--mc-border); }

.guild-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding-bottom: 12px; margin-bottom: 12px;
  border-bottom: 0.5px solid var(--mc-border);
}
.guild-identity { display: flex; align-items: center; gap: 11px; min-width: 0; }
.guild-actions { display: flex; gap: 8px; flex-shrink: 0; }
.guild-name {
  font-size: 15.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.guild-features { margin-bottom: 4px; }
.features-label { display: block; letter-spacing: 0.05em; margin-bottom: 7px; }
.feature-chips { display: flex; flex-wrap: wrap; gap: 5px; }

.guild-foot {
  margin-top: 12px; padding-top: 10px;
  border-top: 0.5px solid var(--mc-border);
}

.center { display: grid; place-items: center; padding: 60px 0; }
</style>
