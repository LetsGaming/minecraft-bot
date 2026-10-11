<template>
  <div class="overview-view">
    <ViewHeader :title="t('overview.title')" :subtitle="t('overview.lede')">
      <template #actions>
        <Button
          class="tap"
          icon="pi pi-refresh"
          :label="t('overview.refresh')"
          severity="secondary"
          outlined
          size="small"
          :loading="loading"
          @click="refreshAll"
        />
      </template>
    </ViewHeader>

    <div class="stack-gap">
      <InlineError
        v-if="failure"
        :title="statusFailure.title"
        :recovery="statusFailure.recovery"
        :detail="statusFailure.detail"
        :retryable="statusFailure.retryable"
        :retry-label="statusFailure.retryLabel"
        :busy="loading"
        :heading-level="2"
        @retry="retryStatus"
      />

      <dl class="tiles" :aria-busy="!loaded ? 'true' : undefined">
        <div class="tile">
          <dt class="tile-label">{{ t("overview.tileServers") }}</dt>
          <dd class="tile-value">
            <template v-if="loaded && !failure">
              {{ serversOnline }}<span class="tile-of">/{{ servers.length }}</span>
            </template>
            <span v-else class="tile-unknown">{{ t("overview.notLoaded") }}</span>
          </dd>
        </div>
        <div class="tile">
          <dt class="tile-label">{{ t("overview.tilePlayers") }}</dt>
          <dd class="tile-value">
            <template v-if="loaded && !failure">{{ totalPlayers }}</template>
            <span v-else class="tile-unknown">{{ t("overview.notLoaded") }}</span>
          </dd>
        </div>
        <div class="tile">
          <dt class="tile-label">{{ t("overview.tileGuilds") }}</dt>
          <dd class="tile-value">
            <template v-if="guildsLoaded && !guildsFailure">{{ guildIds.length }}</template>
            <span v-else class="tile-unknown">{{ t("overview.notLoaded") }}</span>
          </dd>
        </div>
        <div class="tile">
          <dt class="tile-label">{{ t("overview.tileBot") }}</dt>
          <dd class="tile-value tile-status">
            <StatusChip v-if="loaded && !failure" :state="botAlive ? 'online' : 'degraded'" :label="botLabel" />
            <span v-else class="tile-unknown">{{ t("overview.notLoaded") }}</span>
          </dd>
        </div>
      </dl>

      <div class="grid">
        <section class="panel" aria-labelledby="ov-health-h">
          <header class="panel-head">
            <h2 id="ov-health-h" class="panel-title">{{ t("overview.health") }}</h2>
            <StatusChip
              v-if="loaded && !failure"
              :state="alerts.length ? 'degraded' : 'online'"
              :label="alerts.length ? t('overview.toCheck', { count: alerts.length }) : t('overview.allHealthy')"
            />
          </header>
          <AlertList :alerts="alerts" />
          <p v-if="loaded && !failure && !alerts.length" class="pad note">{{ t("overview.allClear") }}</p>
          <p v-else-if="!loaded" class="pad note" role="status">{{ t("overview.loadingStatus") }}</p>
        </section>

        <section class="panel" aria-labelledby="ov-servers-h">
          <header class="panel-head">
            <h2 id="ov-servers-h" class="panel-title">{{ t("overview.servers") }}</h2>
            <Button class="tap" :label="t('overview.manageServers')" size="small" text @click="$emit('navigate', 'servers')" />
          </header>
          <p v-if="!loaded" class="pad note" role="status">{{ t("overview.loadingStatus") }}</p>
          <p v-else-if="servers.length === 0 && !failure" class="pad note">{{ t("overview.noServers") }}</p>
          <ul v-else-if="servers.length" class="rows">
            <li v-for="s in servers" :key="s.id" class="row">
              <span class="row-name mono">{{ s.id }}</span>
              <StatusChip :state="serverRole(s)" :label="serverRoleLabel(s)" />
              <span class="row-meta">{{ serverMeta(s) }}</span>
            </li>
          </ul>
        </section>

        <section class="panel" aria-labelledby="ov-guilds-h">
          <header class="panel-head">
            <h2 id="ov-guilds-h" class="panel-title">{{ t("overview.guilds") }}</h2>
            <Button class="tap" :label="t('overview.setUpGuilds')" size="small" text @click="$emit('navigate', 'guilds')" />
          </header>
          <p v-if="!guildsLoaded" class="pad note" role="status">{{ t("overview.loadingGuilds") }}</p>
          <InlineError
            v-else-if="guildsFailure"
            class="panel-error"
            :title="guildsFailureCopy.title"
            :recovery="guildsFailureCopy.recovery"
            :detail="guildsFailureCopy.detail"
            :retryable="guildsFailureCopy.retryable"
            :retry-label="guildsFailureCopy.retryLabel"
            :busy="guildsLoading"
            @retry="retryGuilds"
          />
          <p v-else-if="guildIds.length === 0" class="pad note">{{ t("overview.noGuilds") }}</p>
          <ul v-else class="rows">
            <li v-for="gid in guildIds" :key="gid" class="row">
              <GuildAvatar :guild-id="gid" :size="26" />
              <span class="row-name ellipsis">{{ guildName(gid) }}</span>
            </li>
          </ul>
        </section>

        <section class="panel" aria-labelledby="ov-activity-h">
          <header class="panel-head">
            <h2 id="ov-activity-h" class="panel-title">{{ t("overview.activity") }}</h2>
            <Button class="tap" :label="t('overview.fullLog')" size="small" text @click="$emit('navigate', 'audit')" />
          </header>
          <p v-if="!auditLoaded" class="pad note" role="status">{{ t("overview.loadingActivity") }}</p>
          <InlineError
            v-else-if="auditFailure"
            class="panel-error"
            :title="auditFailureCopy.title"
            :recovery="auditFailureCopy.recovery"
            :detail="auditFailureCopy.detail"
            :retryable="auditFailureCopy.retryable"
            :retry-label="auditFailureCopy.retryLabel"
            :busy="auditLoading"
            @retry="retryAudit"
          />
          <p v-else-if="recent.length === 0" class="pad note">{{ t("overview.noActivity") }}</p>
          <ul v-else class="rows">
            <li v-for="(e, i) in recent" :key="i" class="row activity-row">
              <span class="action-tag">{{ e.action }}</span>
              <span class="row-meta ellipsis">
                <span v-if="e.server" class="mono">{{ e.server }}</span>
                {{ e.by }}
              </span>
              <span class="row-time mono" :title="timestampTitle(e.at)">{{ relativeAge(e.at) }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import { stateIsUp } from "@mcbot/schema/serverState.js";
import { useServerStatus } from "../composables/useServerStatus";
import { useGuilds } from "../composables/useGuilds";
import { useMyGuilds } from "../composables/useMyGuilds";
import { useAudit } from "../composables/useAudit";
import { serverRole, serverRoleLabel, stateExplanation } from "../utils/format";
import { fleetAlerts, type Alert } from "../utils/serverAlerts";
import { failureCopy, signIn, type FailureCopy } from "../utils/loadFailure";
import { relativeAge, timestampTitle } from "../utils/time";
import type { ServerStatus } from "../api";
import { t } from "../i18n";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import GuildAvatar from "../components/ui/GuildAvatar.vue";
import AlertList from "../components/ui/AlertList.vue";
import InlineError from "../components/ui/InlineError.vue";

const REFRESH_MS = 20_000;
const RECENT_LIMIT = 6;

export default defineComponent({
  name: "OverviewView",
  components: { Button, ViewHeader, StatusChip, GuildAvatar, AlertList, InlineError },
  emits: ["navigate"],
  setup() {
    const status = useServerStatus();
    const { guildName, load: loadGuildNames } = useGuilds();
    const myGuilds = useMyGuilds();
    const audit = useAudit();
    return {
      servers: status.servers,
      botAlive: status.botAlive,
      loading: status.loading,
      loaded: status.loaded,
      failure: status.failure,
      statusError: status.error,
      refresh: status.refresh,
      guildName,
      loadGuildNames,
      myGuilds: myGuilds.guilds,
      guildsLoading: myGuilds.loading,
      guildsLoaded: myGuilds.loaded,
      guildsFailure: myGuilds.failure,
      guildsError: myGuilds.error,
      loadMyGuilds: myGuilds.load,
      recent: audit.entries,
      auditLoading: audit.loading,
      auditLoaded: audit.loaded,
      auditFailure: audit.failure,
      auditError: audit.error,
      loadRecent: audit.load,
      serverRole,
      serverRoleLabel,
      relativeAge,
      timestampTitle,
      t,
    };
  },
  data() {
    return {
      timer: 0 as ReturnType<typeof setInterval> | 0,
    };
  },
  computed: {
    guildIds(): string[] {
      return this.myGuilds.filter((g) => g.configured).map((g) => g.id);
    },
    serversOnline(): number {
      return this.servers.filter((s) => stateIsUp(s.state)).length;
    },
    totalPlayers(): number {
      // Only servers that reported a roster contribute; an unknown roster is
      // not zero players, and the per-server row says which one is unknown.
      return this.servers.reduce((sum, s) => sum + (s.players?.online ?? 0), 0);
    },
    alerts(): Alert[] {
      if (!this.loaded || this.failure) return [];
      return fleetAlerts(this.servers, this.botAlive);
    },
    botLabel(): string {
      return this.botAlive ? t("overview.botReporting") : t("overview.botSilent");
    },
    statusFailure(): FailureCopy {
      return failureCopy(this.failure ?? "failed", {
        failedTitle: t("overview.statusFailedTitle"),
        failedText: t("overview.statusFailedText"),
        forbiddenTitle: t("overview.statusForbiddenTitle"),
        capability: "server:read",
        request: "GET /api/status",
        error: this.statusError,
      });
    },
    guildsFailureCopy(): FailureCopy {
      // The guild list is read from Discord, so "did not answer" here usually
      // means the bot token, not the dashboard.
      return failureCopy(this.guildsFailure ?? "failed", {
        failedTitle: t("overview.guildsFailedTitle"),
        failedText:
          this.guildsFailure === "unreachable" ? t("overview.guildsDiscordText") : t("overview.guildsFailedText"),
        forbiddenTitle: t("overview.guildsForbiddenTitle"),
        capability: "guild",
        forbiddenText: t("overview.guildsForbiddenText"),
        request: "GET /api/guilds",
        error: this.guildsError,
      });
    },
    auditFailureCopy(): FailureCopy {
      return failureCopy(this.auditFailure ?? "failed", {
        failedTitle: t("overview.activityFailedTitle"),
        failedText: t("overview.activityFailedText"),
        forbiddenTitle: t("overview.activityForbiddenTitle"),
        capability: "audit:read",
        request: "GET /api/audit",
        error: this.auditError,
      });
    },
  },
  async mounted() {
    await this.refreshAll();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  },
  unmounted() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    async refreshAll(): Promise<void> {
      void this.loadGuildNames();
      // Secondary panels report their own failure in place, never as a toast.
      await Promise.all([this.refresh(), this.loadMyGuilds(true), this.loadRecent(RECENT_LIMIT)]);
    },
    serverMeta(s: ServerStatus): string {
      if (!stateIsUp(s.state)) return stateExplanation(s.state);
      const players = s.players
        ? t("overview.players", { count: s.players.online })
        : t("overview.playersUnknown");
      return s.tps === null ? players : t("overview.playersTps", { players, tps: s.tps.toFixed(0) });
    },
    retryStatus(): void {
      if (this.failure === "signedOut") signIn();
      else void this.refresh();
    },
    retryGuilds(): void {
      if (this.guildsFailure === "signedOut") signIn();
      else void this.loadMyGuilds(true);
    },
    retryAudit(): void {
      if (this.auditFailure === "signedOut") signIn();
      else void this.loadRecent(RECENT_LIMIT);
    },
  },
});
</script>

<style scoped>
.overview-view { min-width: 0; }
.stack-gap { display: flex; flex-direction: column; gap: var(--space-4); }

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: var(--space-3);
  margin: 0;
}
.tile {
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-end;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.tile dd { margin: 0; }
.tile-value { font-size: var(--text-2xl); font-weight: 600; line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.tile-of { color: var(--text-dim); }
.tile-status { display: flex; align-items: center; min-height: 29px; }
.tile-label { color: var(--text-dim); font-size: var(--text-sm); }
.tile-unknown { color: var(--text-dim); font-size: var(--text-md); font-weight: 400; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: var(--space-4);
  align-items: start;
}
.panel {
  min-width: 0;
  padding: var(--space-1) var(--space-4) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  margin-bottom: var(--space-1);
  border-bottom: 1px solid var(--border);
}
.panel-title { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.panel-error { margin: var(--space-3) 0 var(--space-1); }
.pad { padding: var(--space-3) 0; margin: 0; }
.note { color: var(--text-dim); font-size: var(--text-sm); }

.rows { list-style: none; margin: 0; padding: var(--space-1) 0; display: flex; flex-direction: column; gap: 2px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); padding: var(--space-2) 0; min-width: 0; }
.row-name { font-size: var(--text-sm); min-width: 0; }
.row-meta { flex: 1 1 12ch; min-width: 0; color: var(--text-dim); font-size: var(--text-sm); }
.row-time { flex: none; color: var(--text-dim); font-size: var(--text-xs); }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-row { flex-wrap: nowrap; }
.action-tag {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  font-size: var(--text-xs);
}

@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
}
</style>
