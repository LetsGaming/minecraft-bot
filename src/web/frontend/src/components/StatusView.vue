<template>
  <div>
    <div class="view-head">
      <div>
        <h2>Servers</h2>
        <p class="muted small">Live status, controls, and logs for each configured instance.</p>
      </div>
      <Button
        icon="pi pi-refresh"
        label="Refresh"
        severity="secondary"
        outlined
        size="small"
        :loading="refreshing"
        @click="refresh"
      />
    </div>

    <div v-if="servers.length === 0" class="empty">
      <i class="pi pi-server" />
      <p>No servers are configured yet.</p>
      <p class="muted small">Add one under <strong>Config</strong>, or run the setup wizard.</p>
    </div>

    <div class="cards" v-else>
      <Card
        v-for="server in servers"
        :key="server.id"
        :class="['status-card', { focused: server.id === activeServer }]"
      >
        <template #title>
          <div class="row-between">
            <span class="card-title">
              <span :class="['dot', server.online ? 'up' : 'down']" />
              {{ server.id }}
            </span>
            <Tag
              v-if="server.tps !== null"
              :severity="tpsSeverity(server.tps)"
              :value="`${server.tps.toFixed(1)} TPS`"
              rounded
            />
          </div>
        </template>

        <template #content>
          <div class="players">
            <template v-if="server.online">
              <span class="players-count">
                {{ server.players.online }}<span class="muted">/{{ server.players.max }}</span>
              </span>
              <span class="muted small">players online</span>
            </template>
            <span v-else class="muted">Offline</span>
          </div>

          <div v-if="server.players.names.length" class="names">
            <Tag
              v-for="name in server.players.names"
              :key="name"
              :value="name"
              severity="secondary"
            />
          </div>

          <div v-if="server.host" class="host muted small">
            <span v-if="server.host.process">
              <i class="pi pi-microchip" /> {{ formatBytes(server.host.process.rssBytes) }} ·
              {{ server.host.process.cpuPercent.toFixed(0) }}% CPU
            </span>
            <span v-for="disk in server.host.disks" :key="disk.path">
              <i class="pi pi-database" /> {{ disk.path }}: {{ disk.usedPercent }}%
            </span>
          </div>

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
            <Button
              :label="logServer === server.id ? 'Hide log' : 'Log'"
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
import { apiGet, apiSend } from "../api";
import type { StatusResponse, ServerStatus } from "../api";

const REFRESH_MS = 15_000;

export default defineComponent({
  name: "StatusView",
  components: { Card, Button, Tag },
  props: {
    activeServer: { type: String, default: "" },
  },
  emits: ["bot-state", "servers"],
  data() {
    return {
      servers: [] as ServerStatus[],
      actions: ["start", "stop", "restart", "backup"] as const,
      busy: "" as string,
      refreshing: false,
      logServer: "",
      logLines: [] as string[],
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
    async refresh() {
      this.refreshing = true;
      try {
        const status = await apiGet<StatusResponse>("/api/status");
        this.servers = status.servers;
        this.$emit("bot-state", status.bot.alive);
        this.$emit("servers", status.servers);
      } catch (err) {
        this.$toast.add({
          severity: "error",
          summary: "Status refresh failed",
          detail: (err as Error).message,
          life: 3500,
        });
      } finally {
        this.refreshing = false;
      }
    },
    async runAction(serverId: string, action: string) {
      if (action === "stop" || action === "restart") {
        const ok = await new Promise<boolean>((resolve) => {
          this.$confirm.require({
            message: `Really ${action} "${serverId}"?`,
            header: `Confirm ${action}`,
            icon: "pi pi-exclamation-triangle",
            acceptLabel: capitalize(action),
            rejectLabel: "Cancel",
            acceptClass: action === "stop" ? "p-button-danger" : "",
            accept: () => resolve(true),
            reject: () => resolve(false),
            onHide: () => resolve(false),
          });
        });
        if (!ok) return;
      }
      this.busy = serverId;
      try {
        const res = await apiSend<{ ok: boolean; exitCode: number | null }>(
          "POST",
          `/api/servers/${encodeURIComponent(serverId)}/${action}`,
        );
        this.$toast.add({
          severity: res.ok ? "success" : "warn",
          summary: `${capitalize(action)} · ${serverId}`,
          detail: res.ok ? "Done" : `Exit code ${res.exitCode}`,
          life: 3000,
        });
        await this.refresh();
      } catch (err) {
        this.$toast.add({
          severity: "error",
          summary: `${capitalize(action)} failed`,
          detail: (err as Error).message,
          life: 4000,
        });
      } finally {
        this.busy = "";
      }
    },
    async toggleLog(serverId: string) {
      if (this.logServer === serverId) {
        this.logServer = "";
        this.logLines = [];
        return;
      }
      try {
        const res = await apiGet<{ lines: string[] }>(
          `/api/servers/${encodeURIComponent(serverId)}/log?lines=50`,
        );
        this.logServer = serverId;
        this.logLines = res.lines;
      } catch (err) {
        this.$toast.add({
          severity: "error",
          summary: "Log tail failed",
          detail: (err as Error).message,
          life: 4000,
        });
      }
    },
    tpsSeverity(tps: number): string {
      return tps >= 18 ? "success" : tps >= 12 ? "warn" : "danger";
    },
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
    formatBytes(bytes: number): string {
      if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
      return `${Math.round(bytes / 1024 ** 2)} MB`;
    },
  },
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
</script>

<style scoped>
.view-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 16px; }
.view-head h2 { margin: 0 0 3px; font-size: 18px; font-weight: 500; }
.view-head p { margin: 0; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.status-card { border: 0.5px solid var(--mc-border); transition: box-shadow 0.15s, border-color 0.15s; }
.status-card.focused {
  border-color: var(--mc-accent-border);
  box-shadow: 0 0 0 0.5px var(--mc-accent-border), 0 0 22px -8px rgba(52, 197, 106, 0.25);
}
.card-title { display: flex; align-items: center; gap: 9px; font-size: 16px; }

.players { display: flex; align-items: baseline; gap: 8px; margin-bottom: 11px; }
.players-count { font-size: 27px; font-weight: 500; }
.names { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
.host { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
.host i { margin-right: 3px; }

.ops { display: flex; flex-wrap: wrap; gap: 6px; }
.log {
  background: #101114; border: 0.5px solid var(--mc-border); border-radius: 8px;
  padding: 12px; margin-top: 14px; font-size: 12px; line-height: 1.5;
  max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-all;
}

.empty {
  text-align: center; padding: 64px 0; color: var(--mc-muted);
}
.empty i { font-size: 40px; opacity: 0.5; }
.empty p { margin: 10px 0 0; }
</style>
