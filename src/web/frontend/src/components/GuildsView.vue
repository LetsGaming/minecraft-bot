<template>
  <div>
    <div class="view-head">
      <div>
        <h2>Guilds</h2>
        <p class="muted small">Discord servers the bot is configured for, and how to add more.</p>
      </div>
    </div>

    <!-- Add-to-server hero -->
    <div class="hero">
      <div class="hero-icon"><i class="pi pi-discord" /></div>
      <div class="hero-body">
        <h3>Add the bot to a new server</h3>
        <p class="muted">
          Invite the bot to any Discord guild where you have the
          <em>Manage Server</em> permission. After it joins, configure that
          guild's features below.
        </p>
      </div>
      <Button
        label="Add to Server"
        icon="pi pi-external-link"
        :loading="inviting"
        @click="invite"
      />
    </div>

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

      <div v-if="guildIds.length === 0" class="empty">
        <i class="pi pi-inbox" />
        <p>No guilds configured yet.</p>
        <p class="muted small">Invite the bot above, then set up its first guild.</p>
        <Button
          label="Set up first guild"
          icon="pi pi-plus"
          class="empty-cta"
          @click="openWizard('')"
        />
      </div>

      <div class="guild-list" v-else>
        <Card v-for="gid in guildIds" :key="gid" class="guild-card">
          <template #content>
            <div class="guild-row">
              <div class="guild-id">
                <i class="pi pi-hashtag" />
                <span class="mono">{{ gid }}</span>
              </div>
              <div class="feature-chips">
                <Tag
                  v-for="f in enabledFeatures(gid)"
                  :key="f.key"
                  :value="f.label"
                  :icon="f.icon"
                  severity="success"
                />
                <span v-if="enabledFeatures(gid).length === 0" class="muted small">
                  No features enabled
                </span>
              </div>
            </div>
            <div class="guild-actions">
              <Button
                label="Edit setup"
                icon="pi pi-sliders-h"
                size="small"
                outlined
                @click="openWizard(gid)"
              />
              <Button
                label="Advanced (Config)"
                icon="pi pi-arrow-right"
                iconPos="right"
                size="small"
                text
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
      @written="reload"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Card from "primevue/card";
import Button from "primevue/button";
import Tag from "primevue/tag";
import SetupWizard from "./SetupWizard.vue";
import { apiGet } from "../api";
import type { ConfigResponse, InviteResponse } from "../api";

// Feature keys inside a guild block → how they show as chips. Kept in
// sync with GuildConfig; a feature counts as "enabled" when its block is
// present (and, for statusEmbed, explicitly enabled).
const FEATURES: { key: string; label: string; icon: string }[] = [
  { key: "notifications", label: "Notifications", icon: "pi pi-bell" },
  { key: "chatBridge", label: "Chat Bridge", icon: "pi pi-comments" },
  { key: "leaderboard", label: "Leaderboard", icon: "pi pi-chart-bar" },
  { key: "statusEmbed", label: "Status Embed", icon: "pi pi-desktop" },
  { key: "downtimeAlerts", label: "Downtime Alerts", icon: "pi pi-exclamation-triangle" },
  { key: "tpsAlerts", label: "TPS Alerts", icon: "pi pi-gauge" },
  { key: "channelPurge", label: "Channel Purge", icon: "pi pi-trash" },
  { key: "reports", label: "Reports", icon: "pi pi-flag" },
  { key: "console", label: "Console", icon: "pi pi-code" },
  { key: "whitelistApplications", label: "Whitelist Apps", icon: "pi pi-user-plus" },
];

type GuildBlock = Record<string, unknown>;

export default defineComponent({
  name: "GuildsView",
  components: { Card, Button, Tag, SetupWizard },
  emits: ["goto-config"],
  data() {
    return {
      loading: true,
      inviting: false,
      guilds: {} as Record<string, GuildBlock>,
      wizardOpen: false,
      wizardGuildId: "",
    };
  },
  computed: {
    guildIds(): string[] {
      return Object.keys(this.guilds);
    },
  },
  async mounted() {
    await this.reload();
  },
  methods: {
    async reload() {
      try {
        const res = await apiGet<ConfigResponse>("/api/config");
        const cfg = res.config as { guilds?: Record<string, GuildBlock> };
        this.guilds = cfg.guilds ?? {};
      } catch (err) {
        this.$toast.add({
          severity: "error",
          summary: "Failed to load guilds",
          detail: (err as Error).message,
          life: 4000,
        });
      } finally {
        this.loading = false;
      }
    },
    openWizard(gid: string) {
      this.wizardGuildId = gid;
      this.wizardOpen = true;
    },
    enabledFeatures(gid: string): { key: string; label: string; icon: string }[] {
      const block = this.guilds[gid] ?? {};
      return FEATURES.filter((f) => {
        const v = block[f.key];
        if (v === undefined || v === null) return false;
        if (f.key === "statusEmbed") return (v as { enabled?: boolean }).enabled === true;
        return true;
      });
    },
    async invite() {
      this.inviting = true;
      try {
        const res = await apiGet<InviteResponse>("/api/invite");
        window.open(res.url, "_blank", "noopener");
      } catch (err) {
        this.$toast.add({
          severity: "error",
          summary: "Invite failed",
          detail: (err as Error).message,
          life: 4000,
        });
      } finally {
        this.inviting = false;
      }
    },
  },
});
</script>

<style scoped>
.view-head { margin-bottom: 20px; }
.view-head h2 { margin: 0 0 3px; font-size: 18px; font-weight: 500; }
.view-head p { margin: 0; }

.hero {
  display: flex; align-items: center; gap: 18px;
  background: linear-gradient(100deg, rgba(52, 197, 106, 0.09), rgba(25, 27, 31, 0.2) 60%);
  border: 0.5px solid var(--mc-border);
  border-radius: 11px;
  padding: 15px 18px;
  margin-bottom: 26px;
}
.hero-icon {
  width: 44px; height: 44px; flex: none;
  border-radius: 11px; display: grid; place-items: center;
  background: #5865f2; color: #fff; font-size: 21px;
}
.hero-body { flex: 1; }
.hero-body h3 { margin: 0 0 2px; font-size: 14.5px; font-weight: 500; }
.hero-body p { margin: 0; max-width: 62ch; }

.section-label {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0 2px 12px; letter-spacing: 0.05em;
}
.guild-list { display: flex; flex-direction: column; gap: 12px; }
.guild-card { border: 0.5px solid var(--mc-border); }
.guild-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.guild-id { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.guild-id i { color: var(--mc-muted); }
.feature-chips { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
.guild-actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.empty-cta { margin-top: 16px; }

.center { display: grid; place-items: center; padding: 60px 0; }
.empty { text-align: center; padding: 48px 0; color: var(--mc-muted); }
.empty i { font-size: 38px; opacity: 0.5; }
.empty p { margin: 10px 0 0; }
</style>
