<template>
  <div>
    <ViewHeader title="Servers" subtitle="Live status, controls, and logs for each configured instance.">
      <template #actions>
        <Button
          icon="pi pi-refresh"
          label="Refresh"
          severity="secondary"
          outlined
          size="small"
          :loading="refreshing"
          @click="refresh"
        />
      </template>
    </ViewHeader>

    <EmptyState v-if="servers.length === 0" icon="pi pi-server">
      No servers are configured yet.
      <template #action>
        <span class="muted small">Add one under <strong>Config</strong>, or run the setup wizard.</span>
      </template>
    </EmptyState>

    <div class="cards" v-else>
      <Card
        v-for="server in servers"
        :key="server.id"
        :class="['status-card', { focused: server.id === activeServer }]"
      >
        <template #title>
          <div class="card-head">
            <span class="card-title">
              <StatusDot :state="server.online ? 'up' : 'down'" />
              {{ server.id }}
            </span>
            <Tag
              v-if="server.online && server.tps !== null"
              :severity="tpsSeverity(server.tps)"
              :value="`${server.tps.toFixed(1)} TPS`"
              rounded
            />
            <Tag v-else-if="!server.online" severity="danger" value="Offline" rounded />
          </div>
        </template>

        <template #content>
          <!-- Players -->
          <div class="card-body">
            <div v-if="server.online" class="players">
              <span class="players-count">
                {{ server.players.online }}<span class="muted">/{{ server.players.max }}</span>
              </span>
              <span class="muted small">players online</span>
            </div>
            <div v-else class="offline-note muted small">
              This server is not responding right now.
            </div>

            <div v-if="server.online && server.players.names.length" class="names">
              <Tag
                v-for="name in server.players.names"
                :key="name"
                :value="name"
                severity="secondary"
              />
            </div>
          </div>

          <!-- Host metrics, clearly labelled -->
          <div v-if="server.host" class="metrics">
            <div v-if="server.host.process" class="metric">
              <span class="m-label">RAM</span>
              <span class="m-value">{{ formatBytes(server.host.process.rssBytes) }}</span>
            </div>
            <div v-if="server.host.process" class="metric">
              <span class="m-label">CPU</span>
              <span class="m-value">{{ server.host.process.cpuPercent.toFixed(0) }}%</span>
            </div>
            <div
              v-for="disk in server.host.disks"
              :key="disk.path"
              class="metric metric-disk"
              v-tooltip.top="disk.path"
            >
              <span class="m-label">{{ diskLabel(disk.path) }}</span>
              <span class="m-value">{{ formatBytes(disk.usedBytes) }} / {{ formatBytes(disk.totalBytes) }}</span>
              <span class="m-sub muted">{{ disk.usedPercent }}% used</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="card-foot">
            <div class="ops">
              <Button
                v-for="action in actions"
                :key="action"
                :label="capitalize(action)"
                :icon="actionIcon(action)"
                size="small"
                :severity="actionSeverity(action)"
                :outlined="action !== 'start'"
                :disabled="busy === server.id"
                @click="runAction(server.id, action)"
              />
            </div>
            <Button
              :label="logServer === server.id ? 'Hide log' : 'View log'"
              icon="pi pi-align-left"
              size="small"
              severity="secondary"
              text
              :disabled="busy === server.id"
              @click="toggleLog(server.id)"
            />
          </div>

          <pre v-if="logServer === server.id" class="log mono">{{ logLines.join("\n") }}</pre>
        </template>
      </Card>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Card from "primevue/card";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";
import { formatBytes, diskLabel, tpsSeverity } from "../utils/format";
import { useServerStatus } from "../composables/useServerStatus";
import { useServerActions } from "../composables/useServerActions";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusDot from "../components/ui/StatusDot.vue";
import EmptyState from "../components/ui/EmptyState.vue";

const REFRESH_MS = 15_000;

export default defineComponent({
  name: "StatusView",
  components: { Card, Button, Tag, ViewHeader, StatusDot, EmptyState },
  props: {
    activeServer: { type: String, default: "" },
  },
  emits: ["bot-state", "servers"],
  setup(_props, { emit }) {
    const { servers, loading, error, refresh: pullStatus } = useServerStatus();
    const toast = useToast();

    // Pull status, then inform the shell (switcher + heartbeat banner).
    async function refresh(): Promise<void> {
      const res = await pullStatus();
      if (res) {
        emit("bot-state", res.bot.alive);
        emit("servers", res.servers);
      } else if (error.value) {
        toast.add({ severity: "error", summary: "Status refresh failed", detail: error.value, life: 3500 });
      }
    }

    const { busy, logServer, logLines, runAction, toggleLog } = useServerActions(refresh);

    return {
      servers, refreshing: loading, refresh,
      busy, logServer, logLines, runAction, toggleLog,
      formatBytes, diskLabel, tpsSeverity,
    };
  },
  data() {
    return {
      actions: ["start", "stop", "restart", "backup"] as const,
      timer: 0 as ReturnType<typeof setInterval> | 0,
    };
  },
  async mounted() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  },
  unmounted() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    actionIcon(action: string): string {
      return {
        start: "pi pi-play",
        stop: "pi pi-stop",
        restart: "pi pi-replay",
        backup: "pi pi-save",
      }[action] ?? "pi pi-cog";
    },
    actionSeverity(action: string): string {
      if (action === "start") return "success";
      if (action === "stop") return "danger";
      return "secondary";
    },
    capitalize(s: string): string {
      return capitalize(s);
    },
  },
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
</script>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.status-card { border: 0.5px solid var(--mc-border); transition: box-shadow 0.15s, border-color 0.15s; }
.status-card.focused {
  border-color: var(--mc-accent-border);
  box-shadow: 0 0 0 0.5px var(--mc-accent-border), 0 0 22px -8px rgba(52, 197, 106, 0.25);
}

/* Header */
.card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.card-title { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 500; }

/* Body */
.card-body {
  padding: 4px 0 14px;
  border-bottom: 0.5px solid var(--mc-border);
}
.players { display: flex; align-items: baseline; gap: 8px; }
.players-count { font-size: 27px; font-weight: 500; }
.offline-note { padding: 6px 0; }
.names { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 11px; }

/* Metrics row — labelled key/value pairs */
.metrics {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 14px 0;
  border-bottom: 0.5px solid var(--mc-border);
}
.metric {
  display: flex; flex-direction: column; gap: 1px;
  padding: 5px 11px; border-radius: 7px;
  background: var(--mc-card);
  min-width: 84px;
}
.m-label { font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--mc-dim); }
.m-value { font-size: 14px; color: var(--mc-text); }
.m-sub { font-size: 11px; }
.metric-disk { min-width: 120px; }

/* Footer */
.card-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding-top: 14px;
}
.ops { display: flex; flex-wrap: wrap; gap: 6px; }

.log {
  background: #101114; border: 0.5px solid var(--mc-border); border-radius: 8px;
  padding: 12px; margin-top: 14px; font-size: 12px; line-height: 1.5;
  max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-all;
}
</style>
