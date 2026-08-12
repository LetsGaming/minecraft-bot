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
              <StatusDot :state="statusDot(server)" />
              {{ server.id }}
            </span>
            <Tag
              v-if="stateIsUp(server.state) && server.tps !== null"
              :severity="tpsSeverity(server.tps)"
              :value="`${server.tps.toFixed(1)} TPS`"
              rounded
            />
            <Tag
              v-else-if="!stateIsUp(server.state)"
              :severity="stateSeverity(server.state)"
              :value="stateLabel(server.state)"
              rounded
            />
          </div>
        </template>

        <template #content>
          <!-- Players -->
          <div class="card-body">
            <div v-if="stateIsUp(server.state)" class="players">
              <span class="players-count">
                <template v-if="server.players">
                  {{ server.players.online }}<span class="muted">/{{ server.players.max }}</span>
                </template>
                <span v-else class="muted" v-tooltip.top="'No channel could supply a roster just now.'">—</span>
              </span>
              <span class="muted small">players online</span>
            </div>
            <div v-else class="offline-note muted small">
              {{ stateExplanation(server.state) }}
            </div>

            <!-- The wrapper is a separate fact from the server's state, so it
                 gets its own line — including when the server is perfectly
                 fine and only the controls are gone. -->
            <div v-if="wrapperNote(server)" class="wrapper-note small">
              <i class="pi pi-link" /> {{ wrapperNote(server) }}
            </div>

            <div v-if="server.players?.names.length" class="names">
              <span v-if="server.players.sampled" class="muted small names-note">
                Sample of players online (the server publishes a partial list):
              </span>
              <Tag
                v-for="name in server.players!.names"
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
              v-for="disk in mergeDisks(server.host.disks)"
              :key="disk.paths.join('|')"
              class="metric metric-disk"
              v-tooltip.top="disk.paths.join('\n')"
            >
              <span class="m-label">{{ disk.label }}</span>
              <span class="m-value">{{ formatBytes(disk.usedBytes) }} / {{ formatBytes(disk.totalBytes) }}</span>
              <!-- A meter, not just a number: 33% and 91% read identically as
                   text and very differently as a bar. -->
              <span class="m-meter" :aria-label="`${disk.usedPercent}% used`">
                <span
                  :class="['m-meter-fill', diskSeverity(disk.usedPercent)]"
                  :style="{ width: `${Math.min(100, disk.usedPercent)}%` }"
                />
              </span>
              <span class="m-sub muted">{{ disk.usedPercent }}% used</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="card-foot">
            <!-- Actions that could not run while the wrapper was away. Never
                 replayed automatically: a restart or restore firing by itself
                 hours later is the one outcome nobody wants. -->
            <div v-if="intentsFor(server.id).length" class="intents">
              <span class="muted small">Didn't run while the wrapper was down:</span>
              <span
                v-for="intent in intentsFor(server.id)"
                :key="intent.action"
                class="intent"
              >
                <Button
                  :label="`Retry ${intent.action}`"
                  icon="pi pi-replay"
                  size="small"
                  severity="secondary"
                  outlined
                  :disabled="!isActionApplicable(intent.action, server.state)"
                  v-tooltip.top="`Tried ${relativeAge(intent.attemptedAt)} by ${intent.byTag}. ${intent.reason}`"
                  @click="runAction(server.id, intent.action)"
                />
                <Button
                  icon="pi pi-times"
                  size="small"
                  text
                  severity="secondary"
                  v-tooltip.top="'Dismiss'"
                  @click="dismissIntent(server.id, intent.action)"
                />
              </span>
            </div>

            <div class="ops">
              <Button
                v-for="action in actionsFor(server)"
                :key="action"
                :label="capitalize(action)"
                :icon="actionIcon(action)"
                size="small"
                :severity="actionSeverity(action)"
                :outlined="!isPrimaryAction(action, server)"
                :disabled="busy === server.id || !isActionApplicable(action, server.state)"
                v-tooltip.top="unavailableReason(action, server)"
                @click="runAction(server.id, action)"
              />
            </div>
          </div>

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
import {
  formatBytes,
  mergeDisks,
  diskSeverity,
  tpsSeverity,
  statusDot,
  stateLabel,
  stateSeverity,
  stateExplanation,
  wrapperNote,
} from "../utils/format";
import {
  SERVER_OPERATOR_ACTIONS,
  isActionApplicable,
  type ServerOperatorAction,
} from "@mcbot/schema/serverActions.js";
import { ServerState, stateIsUp } from "@mcbot/schema/serverState.js";
import { relativeAge, timestampTitle } from "../utils/time";
import { apiGet, apiSend } from "../api";

interface PendingIntent {
  action: ServerOperatorAction;
  target?: string;
  attemptedAt: number;
  byTag: string;
  reason: string;
}
import type { ServerStatus } from "../api";
import { useServerStatus } from "../composables/useServerStatus";
import { useServerActions } from "../composables/useServerActions";
import { useCapabilities } from "../composables/useCapabilities";
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

    // Log viewing moved to the Console tab, which streams live instead of
    // fetching a fixed tail — this view keeps only the operator actions.
    const { busy, runAction } = useServerActions(refresh);
    const { can } = useCapabilities();

    /**
     * The operator actions this user may run on THIS server.
     *
     * Rendered from the shared action set rather than a local literal copy,
     * and filtered per server because a grant is per server: someone may
     * restart smp and only read creative.
     */
    function actionsFor(server: ServerStatus): readonly ServerOperatorAction[] {
      if (!can("server:control", server.id)) return [];
      // Gated on what the wrapper advertised, not on this build's version: a
      // suite without rollback.sh should not offer a Rollback button that
      // 409s. A wrapper too old to report features gets the full set, which
      // is the behaviour that shipped before capabilities existed.
      const scripts = server.features?.scripts;
      if (!scripts) return SERVER_OPERATOR_ACTIONS;
      return SERVER_OPERATOR_ACTIONS.filter((a) => scripts[a] !== false);
    }

    return {
      servers, refreshing: loading, refresh,
      busy, runAction,
      can, actionsFor, isActionApplicable,
      formatBytes, mergeDisks, diskSeverity, tpsSeverity, stateIsUp,
      relativeAge, timestampTitle,
      statusDot, stateLabel, stateSeverity, stateExplanation, wrapperNote,
    };
  },
  data() {
    return {
      timer: 0 as ReturnType<typeof setInterval> | 0,
      pendingIntents: {} as Record<string, PendingIntent[]>,
    };
  },
  async mounted() {
    await this.refresh();
    await this.loadIntents();
    this.timer = setInterval(() => {
      void this.refresh();
      void this.loadIntents();
    }, REFRESH_MS);
  },
  unmounted() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    intentsFor(serverId: string): PendingIntent[] {
      return this.pendingIntents[serverId] ?? [];
    },
    /**
     * Poll alongside status. Intents expire server-side, so a stale list here
     * corrects itself rather than offering a retry nobody still wants.
     */
    async loadIntents(): Promise<void> {
      const results = await Promise.all(
        this.servers.map(async (server) => {
          try {
            const res = await apiGet<{ intents: PendingIntent[] }>(
              `/api/servers/${encodeURIComponent(server.id)}/pending-actions`,
            );
            return [server.id, res.intents] as const;
          } catch {
            return [server.id, []] as const;
          }
        }),
      );
      this.pendingIntents = Object.fromEntries(results);
    },
    async dismissIntent(serverId: string, action: string): Promise<void> {
      try {
        await apiSend(
          "DELETE",
          `/api/servers/${encodeURIComponent(serverId)}/pending-actions/${encodeURIComponent(action)}`,
        );
      } finally {
        await this.loadIntents();
      }
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
    /**
     * Exactly one filled button per card, and it is whichever action the
     * server's state actually invites. A permanently filled "Start" on a
     * running server made the one impossible action the loudest one.
     */
    isPrimaryAction(action: ServerOperatorAction, server: ServerStatus): boolean {
      if (!isActionApplicable(action, server.state)) return false;
      return server.state === ServerState.Offline
        ? action === "start"
        : action === "restart";
    },
    /**
     * Why a disabled button is disabled. A greyed control with no explanation
     * reads as a permissions problem or a bug; naming the state turns it into
     * information about the server.
     */
    unavailableReason(action: ServerOperatorAction, server: ServerStatus): string {
      if (this.busy === server.id) return "Another action is still running.";
      if (isActionApplicable(action, server.state)) return "";
      return action === "start"
        ? `${server.id} is already running.`
        : `${server.id} is not running.`;
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
.wrapper-note { margin-top: 8px; color: var(--mc-mid); display: flex; gap: 6px; align-items: baseline; }
.names-note { flex-basis: 100%; margin-bottom: 2px; }
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
.metrics-stale { color: var(--mc-mid); margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
.metrics-stale i { font-size: 11px; }
.intents { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.intent { display: inline-flex; align-items: center; gap: 2px; }

.m-label { font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--mc-dim); }
.m-value { font-size: 14px; color: var(--mc-text); }
.m-sub { font-size: 11px; }
.metric-disk { min-width: 150px; flex: 1 1 150px; max-width: 260px; }
.m-meter {
  display: block; height: 4px; margin: 5px 0 3px;
  border-radius: 999px; background: var(--mc-border-strong); overflow: hidden;
}
.m-meter-fill { display: block; height: 100%; border-radius: 999px; }
.m-meter-fill.good { background: var(--mc-accent); }
.m-meter-fill.mid { background: var(--mc-mid); }
.m-meter-fill.bad { background: var(--mc-bad); }

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
