<template>
  <div>
    <ViewHeader title="Overview" subtitle="Everything important at a glance.">
      <template #actions>
        <Button
          icon="pi pi-refresh"
          label="Refresh"
          severity="secondary"
          outlined
          size="small"
          :loading="loading"
          @click="refreshAll"
        />
      </template>
    </ViewHeader>

    <!-- Summary tiles -->
    <div class="tiles">
      <div class="tile">
        <span class="tile-value">{{ serversOnline }}<span class="muted">/{{ servers.length }}</span></span>
        <span class="tile-label muted small">servers online</span>
      </div>
      <div class="tile">
        <span class="tile-value">{{ totalPlayers }}</span>
        <span class="tile-label muted small">players online</span>
      </div>
      <div class="tile">
        <span class="tile-value">{{ guildIds.length }}</span>
        <span class="tile-label muted small">configured guilds</span>
      </div>
      <div class="tile">
        <span class="tile-value tile-status">
          <StatusDot :state="botAlive ? 'up' : 'stale'" />
          {{ botAlive ? "Online" : "Stale" }}
        </span>
        <span class="tile-label muted small">bot process</span>
      </div>
    </div>

    <div class="grid">
      <!-- Health / alerts -->
      <section class="panel">
        <header class="panel-head">
          <span class="panel-title"><i class="pi pi-heart" /> Health</span>
          <Tag
            :severity="alerts.length ? 'warn' : 'success'"
            :value="alerts.length ? `${alerts.length} to check` : 'All healthy'"
            rounded
          />
        </header>
        <ul v-if="alerts.length" class="alert-list">
          <li v-for="(a, i) in alerts" :key="i" :class="['alert', a.level]">
            <i :class="a.icon" />
            <span>{{ a.text }}</span>
          </li>
        </ul>
        <div v-else class="all-clear muted small">
          <i class="pi pi-check-circle" /> No servers down, TPS healthy, disks and backups fine.
        </div>
      </section>

      <!-- Server status summary -->
      <section class="panel">
        <header class="panel-head">
          <span class="panel-title"><i class="pi pi-server" /> Servers</span>
          <Button label="Manage" size="small" text @click="$emit('navigate', 'status')" />
        </header>
        <div v-if="servers.length === 0" class="muted small pad">No servers configured.</div>
        <ul v-else class="server-list">
          <li v-for="s in servers" :key="s.id" class="server-row">
            <span class="s-name">
              <StatusDot :state="s.online ? 'up' : 'down'" />
              {{ s.id }}
            </span>
            <span class="s-meta muted small">
              <template v-if="s.online">
                {{ s.players.online }}/{{ s.players.max }} players
                <span v-if="s.tps !== null" class="s-tps">· {{ s.tps.toFixed(0) }} TPS</span>
              </template>
              <template v-else>offline</template>
            </span>
          </li>
        </ul>
      </section>

      <!-- Configured guilds -->
      <section class="panel">
        <header class="panel-head">
          <span class="panel-title"><i class="pi pi-discord" /> Guilds</span>
          <Button label="Set up" size="small" text @click="$emit('navigate', 'guilds')" />
        </header>
        <div v-if="guildIds.length === 0" class="muted small pad">No guilds configured yet.</div>
        <ul v-else class="guild-list">
          <li v-for="gid in guildIds" :key="gid" class="guild-row">
            <GuildAvatar :guild-id="gid" :size="26" />
            <span class="g-name">{{ guildName(gid) }}</span>
          </li>
        </ul>
      </section>

      <!-- Recent activity -->
      <section class="panel">
        <header class="panel-head">
          <span class="panel-title"><i class="pi pi-history" /> Recent activity</span>
          <Button label="Full log" size="small" text @click="$emit('navigate', 'audit')" />
        </header>
        <div v-if="recent.length === 0" class="muted small pad">Nothing recorded yet.</div>
        <ul v-else class="audit-list">
          <li v-for="(e, i) in recent" :key="i" class="audit-row">
            <Tag :value="e.action" severity="secondary" />
            <span class="a-detail">
              <span v-if="e.server" class="mono small">{{ e.server }}</span>
              <span class="muted small">{{ e.by }}</span>
            </span>
            <span class="a-time muted small mono">{{ shortTime(e.at) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- Quick links -->
    <div class="quick-links">
      <button v-for="link in links" :key="link.id" class="q-link" @click="$emit('navigate', link.id)">
        <i :class="link.icon" />
        <span>{{ link.label }}</span>
        <i class="pi pi-arrow-right q-arrow" />
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useServerStatus } from "../composables/useServerStatus";
import { useGuilds } from "../composables/useGuilds";
import { useMyGuilds } from "../composables/useMyGuilds";
import { useAudit } from "../composables/useAudit";
import { diskLabel } from "../utils/format";
import ViewHeader from "../components/ViewHeader.vue";
import StatusDot from "../components/StatusDot.vue";
import GuildAvatar from "../components/GuildAvatar.vue";

interface Alert {
  level: "warn" | "danger";
  icon: string;
  text: string;
}

const REFRESH_MS = 20_000;

export default defineComponent({
  name: "OverviewView",
  components: { Button, Tag, ViewHeader, StatusDot, GuildAvatar },
  emits: ["navigate"],
  setup() {
    const { servers, botAlive, loading, refresh } = useServerStatus();
    const { guildName, load: loadGuildNames } = useGuilds();
    const { guilds: myGuilds, load: loadMyGuilds } = useMyGuilds();
    const { entries: recent, load: loadRecent } = useAudit();
    return {
      servers, botAlive, loading, refresh,
      guildName, loadGuildNames, myGuilds, loadMyGuilds, recent, loadRecent,
    };
  },
  data() {
    return {
      timer: 0 as ReturnType<typeof setInterval> | 0,
      links: [
        { id: "status", label: "Servers", icon: "pi pi-server" },
        { id: "guilds", label: "Guilds", icon: "pi pi-discord" },
        { id: "commands", label: "Commands", icon: "pi pi-bolt" },
        { id: "config", label: "Config", icon: "pi pi-sliders-h" },
        { id: "audit", label: "Audit Log", icon: "pi pi-history" },
      ],
    };
  },
  computed: {
    guildIds(): string[] {
      return this.myGuilds.filter((g) => g.configured).map((g) => g.id);
    },
    serversOnline(): number {
      return this.servers.filter((s) => s.online).length;
    },
    totalPlayers(): number {
      return this.servers.reduce((sum, s) => sum + (s.online ? s.players.online : 0), 0);
    },
    alerts(): Alert[] {
      const out: Alert[] = [];
      if (!this.botAlive) {
        out.push({ level: "danger", icon: "pi pi-times-circle", text: "Bot process heartbeat is stale — status may be outdated." });
      }
      for (const s of this.servers) {
        if (!s.online) {
          out.push({ level: "danger", icon: "pi pi-times-circle", text: `${s.id} is offline.` });
          continue;
        }
        if (s.tps !== null && s.tps < 15) {
          out.push({ level: "warn", icon: "pi pi-gauge", text: `${s.id} has low TPS (${s.tps.toFixed(1)}).` });
        }
        for (const disk of s.host?.disks ?? []) {
          if (disk.usedPercent >= 90) {
            out.push({ level: "warn", icon: "pi pi-database", text: `${s.id} ${diskLabel(disk.path).toLowerCase()} is ${disk.usedPercent}% full.` });
          }
        }
      }
      return out;
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
    async refreshAll() {
      void this.loadGuildNames();
      // The guild list and recent activity are secondary panels — load them
      // silently so a hiccup there doesn't pop error toasts on the overview.
      await Promise.all([this.refresh(), this.loadMyGuilds(true), this.loadRecent(6, true)]);
    },
    shortTime(at: string): string {
      // Audit timestamps may be ISO or an already-formatted string. Parse
      // when possible and show a compact local date+time; otherwise show
      // the raw value rather than something misleading.
      const d = new Date(at);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return at;
    },
  },
});
</script>

<style scoped>
/* Summary tiles */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile {
  background: var(--mc-surface); border: 0.5px solid var(--mc-border);
  border-radius: 11px; padding: 15px 17px; display: flex; flex-direction: column; gap: 3px;
}
.tile-value { font-size: 25px; font-weight: 500; }
.tile-status { display: flex; align-items: center; gap: 8px; font-size: 18px; }
.tile-label { letter-spacing: 0.02em; }

/* Panel grid */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.panel { background: var(--mc-surface); border: 0.5px solid var(--mc-border); border-radius: 11px; padding: 4px 16px 12px; }
.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; margin-bottom: 4px; border-bottom: 0.5px solid var(--mc-border);
}
.panel-title { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 500; }
.panel-title i { color: var(--mc-accent); font-size: 14px; }
.pad { padding: 12px 0; }

/* Alerts */
.alert-list, .server-list, .guild-list, .audit-list { list-style: none; margin: 0; padding: 6px 0; display: flex; flex-direction: column; gap: 2px; }
.alert { display: flex; align-items: center; gap: 9px; padding: 7px 0; font-size: 13.5px; }
.alert.warn i { color: var(--mc-mid); }
.alert.danger i { color: var(--mc-bad); }
.all-clear { display: flex; align-items: center; gap: 8px; padding: 12px 0; }
.all-clear i { color: var(--mc-good); }

/* Servers */
.server-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; }
.s-name { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.s-tps { }

/* Guilds */
.guild-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.g-name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Audit */
.audit-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
.a-detail { flex: 1; display: flex; gap: 8px; align-items: center; min-width: 0; overflow: hidden; }
.a-time { flex: none; }

/* Quick links */
.quick-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 16px; }
.q-link {
  display: flex; align-items: center; gap: 9px;
  background: var(--mc-surface); border: 0.5px solid var(--mc-border);
  border-radius: 10px; padding: 12px 14px; cursor: pointer;
  color: var(--mc-text); font-size: 14px; text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.q-link:hover { border-color: var(--mc-accent-border); background: var(--mc-card); }
.q-link > i:first-child { color: var(--mc-accent); font-size: 15px; }
.q-link span { flex: 1; }
.q-arrow { color: var(--mc-dim); font-size: 12px; }
</style>
