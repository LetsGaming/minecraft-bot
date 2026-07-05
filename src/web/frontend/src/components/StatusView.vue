<template>
  <div>
    <div class="cards">
      <div v-for="server in servers" :key="server.id" class="card">
        <div class="card-head">
          <h3>
            <span :class="['dot', server.online ? 'up' : 'down']"></span>
            {{ server.id }}
          </h3>
          <span v-if="server.tps !== null" :class="tpsClass(server.tps)">
            {{ server.tps.toFixed(1) }} TPS
          </span>
        </div>

        <p v-if="server.online">
          {{ server.players.online }} / {{ server.players.max }} players
          <span v-if="server.players.names.length" class="muted">
            — {{ server.players.names.join(", ") }}
          </span>
        </p>
        <p v-else class="muted">offline</p>

        <p v-if="server.host" class="muted small">
          <span v-if="server.host.process">
            {{ formatBytes(server.host.process.rssBytes) }} RAM ·
            {{ server.host.process.cpuPercent.toFixed(0) }}% CPU
          </span>
          <span v-for="disk in server.host.disks" :key="disk.path">
            · {{ disk.path }}: {{ disk.usedPercent }}%
          </span>
        </p>

        <div class="ops">
          <button
            v-for="action in actions"
            :key="action"
            :disabled="busy === server.id"
            @click="runAction(server.id, action)"
          >
            {{ action }}
          </button>
          <button :disabled="busy === server.id" @click="toggleLog(server.id)">
            {{ logServer === server.id ? "hide log" : "log" }}
          </button>
        </div>

        <pre v-if="logServer === server.id" class="log">{{ logLines.join("\n") }}</pre>
      </div>
    </div>

    <p v-if="message" class="message">{{ message }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiSend } from "../api";
import type { StatusResponse, ServerStatus } from "../api";

const REFRESH_MS = 15_000;

export default defineComponent({
  name: "StatusView",
  emits: ["bot-state"],
  data() {
    return {
      servers: [] as ServerStatus[],
      actions: ["start", "stop", "restart", "backup"] as const,
      busy: "" as string,
      message: "",
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
      try {
        const status = await apiGet<StatusResponse>("/api/status");
        this.servers = status.servers;
        this.$emit("bot-state", status.bot.alive);
      } catch (err) {
        this.message = `Status refresh failed: ${(err as Error).message}`;
      }
    },
    async runAction(serverId: string, action: string) {
      if (
        (action === "stop" || action === "restart") &&
        !confirm(`Really ${action} ${serverId}?`)
      ) {
        return;
      }
      this.busy = serverId;
      this.message = `${action} on ${serverId}…`;
      try {
        const res = await apiSend<{ ok: boolean; exitCode: number | null }>(
          "POST",
          `/api/servers/${encodeURIComponent(serverId)}/${action}`,
        );
        this.message = res.ok
          ? `${action} on ${serverId}: done`
          : `${action} on ${serverId}: exit code ${res.exitCode}`;
        await this.refresh();
      } catch (err) {
        this.message = `${action} on ${serverId} failed: ${(err as Error).message}`;
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
        this.message = `Log tail failed: ${(err as Error).message}`;
      }
    },
    tpsClass(tps: number): string {
      return tps >= 18 ? "tps good" : tps >= 12 ? "tps mid" : "tps bad";
    },
    formatBytes(bytes: number): string {
      if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
      return `${Math.round(bytes / 1024 ** 2)} MB`;
    },
  },
});
</script>
