<template>
  <div class="servers-view">
    <ViewHeader :title="t('servers.title')" :subtitle="t('servers.lede')">
      <template #actions>
        <Button
          class="tap"
          icon="pi pi-refresh"
          :label="t('servers.refresh')"
          severity="secondary"
          outlined
          size="small"
          :loading="refreshing"
          @click="refreshAll"
        />
      </template>
    </ViewHeader>

    <div class="stack-gap">
      <InlineError
        v-if="failure"
        :title="failureCopy.title"
        :recovery="failureCopy.recovery"
        :detail="failureCopy.detail"
        :retryable="failureCopy.retryable"
        :retry-label="failureCopy.retryLabel"
        :busy="refreshing"
        :heading-level="2"
        @retry="onRetry"
      />

      <div v-if="!loaded" class="skeleton" role="status">
        <span class="sr-only">{{ t("servers.loading") }}</span>
        <span v-for="n in 2" :key="n" class="sk-card" aria-hidden="true" />
      </div>

      <EmptyState
        v-else-if="servers.length === 0 && !failure"
        icon="pi pi-server"
        :title="t('servers.emptyTitle')"
        :heading-level="2"
      >
        {{ t("servers.emptyLead") }} <strong>{{ t("nav.config") }}</strong>{{ t("servers.emptyTail") }}
      </EmptyState>

      <div v-else-if="servers.length" class="cards">
        <section
          v-for="server in servers"
          :key="server.id"
          :class="['card', { focused: server.id === activeServer }]"
          :aria-labelledby="`server-${server.id}-h`"
        >
          <div class="card-head">
            <h2 :id="`server-${server.id}-h`" class="card-title mono">{{ server.id }}</h2>
            <StatusChip :state="serverRole(server)" :label="serverRoleLabel(server)" />
            <StatusChip
              v-if="stateIsUp(server.state) && server.tps !== null"
              :state="tpsRole(server.tps)"
              :label="t('servers.tps', { tps: server.tps.toFixed(1) })"
            />
          </div>

          <div class="card-body">
            <p v-if="stateIsUp(server.state)" class="players">
              <template v-if="server.players">
                <span class="players-count">{{ server.players.online }}</span>
                <span class="players-max">/{{ server.players.max }}</span>
                <span class="players-label">{{ t("servers.playersOnline") }}</span>
              </template>
              <span v-else class="players-label">{{ t("servers.rosterUnknown") }}</span>
            </p>
            <p v-else class="note">{{ stateExplanation(server.state) }}</p>

            <!-- The wrapper is a separate fact from the server's state, so it
                 gets its own line, including when only the controls are gone. -->
            <p v-if="wrapperNote(server)" class="note wrapper-note">{{ wrapperNote(server) }}</p>

            <AlertList :alerts="cardAlerts(server)" compact />

            <div v-if="server.players?.names.length" class="names">
              <p v-if="server.players.sampled" class="names-note">{{ t("servers.playersSampled") }}</p>
              <ul class="name-list">
                <li v-for="name in server.players!.names" :key="name" class="name">{{ name }}</li>
              </ul>
            </div>
          </div>

          <dl v-if="server.host" class="metrics">
            <div v-if="server.host.process" class="metric">
              <dt class="m-label">{{ t("servers.ram") }}</dt>
              <dd class="m-value">{{ formatBytes(server.host.process.rssBytes) }}</dd>
            </div>
            <div v-if="server.host.process" class="metric">
              <dt class="m-label">{{ t("servers.cpu") }}</dt>
              <dd class="m-value">{{ server.host.process.cpuPercent.toFixed(0) }}%</dd>
            </div>
            <div
              v-for="disk in mergeDisks(server.host.disks)"
              :key="disk.paths.join('|')"
              class="metric metric-disk"
              :title="disk.paths.join('\n')"
            >
              <dt class="m-label">{{ disk.label }}</dt>
              <dd class="m-value">
                {{ formatBytes(disk.usedBytes) }} / {{ formatBytes(disk.totalBytes) }}
                <!-- A meter, not just a number: 33% and 91% read identically as
                     text and very differently as a bar. The percentage below
                     carries it for assistive tech. -->
                <span class="m-meter" aria-hidden="true">
                  <span
                    :class="['m-meter-fill', diskSeverity(disk.usedPercent)]"
                    :style="{ width: `${Math.min(100, disk.usedPercent)}%` }"
                  />
                </span>
                <span class="m-sub">{{ t("servers.diskUsed", { percent: disk.usedPercent }) }}</span>
              </dd>
            </div>
          </dl>

          <JobBlock
            v-if="jobs[server.id]"
            :title="jobTitle(server.id)"
            :state="jobs[server.id]!.state"
            :started-at="jobs[server.id]!.startedAt"
            :exit-code="jobs[server.id]!.exitCode"
            :output="jobs[server.id]!.output"
          >
            <p>{{ jobs[server.id]!.note }}</p>
            <template v-if="jobs[server.id]!.state === 'failed'" #actions>
              <Button
                class="tap"
                :label="t('servers.job.retry')"
                size="small"
                :disabled="!isActionApplicable(jobs[server.id]!.action, server.state)"
                @click="runAction(server, jobs[server.id]!.action)"
              />
              <Button
                class="tap"
                :label="t('servers.job.dismiss')"
                size="small"
                severity="secondary"
                text
                @click="dismiss(server.id)"
              />
            </template>
          </JobBlock>

          <div class="card-foot">
            <!-- Actions that could not run while the wrapper was away. Never
                 replayed automatically: a restart or restore firing by itself
                 hours later is the one outcome nobody wants. -->
            <div v-if="intentsFor(server.id).length" class="intents">
              <p class="intents-note">{{ t("servers.intentsNote") }}</p>
              <span v-for="intent in intentsFor(server.id)" :key="intent.action" class="intent">
                <Button
                  class="tap"
                  :label="t('servers.intentRetry', { action: actionLabel(intent.action) })"
                  icon="pi pi-replay"
                  size="small"
                  severity="secondary"
                  outlined
                  :disabled="isRunning(server.id) || !isActionApplicable(intent.action, server.state)"
                  v-tooltip.top="intentTip(intent)"
                  @click="runAction(server, intent.action)"
                />
                <Button
                  class="tap"
                  icon="pi pi-times"
                  size="small"
                  text
                  severity="secondary"
                  :aria-label="t('servers.intentDismiss', { action: actionLabel(intent.action), server: server.id })"
                  v-tooltip.top="t('servers.job.dismiss')"
                  @click="dismissIntent(server.id, intent.action)"
                />
              </span>
            </div>

            <div v-if="actionsFor(server).length" class="ops" role="group" :aria-label="t('servers.actionsFor', { server: server.id })">
              <Button
                v-for="action in actionsFor(server)"
                :key="action"
                class="tap"
                :label="actionLabel(action)"
                :icon="ACTION_ICON[action]"
                size="small"
                :severity="actionSeverity(action, server)"
                :outlined="!isPrimaryAction(action, server)"
                :disabled="isRunning(server.id) || !isActionApplicable(action, server.state)"
                v-tooltip.top="unavailableReason(action, server)"
                @click="runAction(server, action)"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import {
  formatBytes,
  mergeDisks,
  diskSeverity,
  tpsRole,
  serverRole,
  serverRoleLabel,
  stateExplanation,
  wrapperNote,
} from "../utils/format";
import {
  SERVER_OPERATOR_ACTIONS,
  isActionApplicable,
  type ServerOperatorAction,
} from "@mcbot/schema/serverActions.js";
import { ServerState, stateIsUp } from "@mcbot/schema/serverState.js";
import { relativeAge } from "../utils/time";
import { apiGet, apiSend } from "../api";
import type { ServerStatus } from "../api";
import { serverAlerts, type Alert } from "../utils/serverAlerts";
import { failureCopy, signIn, type FailureCopy } from "../utils/loadFailure";
import { useServerStatus } from "../composables/useServerStatus";
import { useServerActions } from "../composables/useServerActions";
import { useCapabilities } from "../composables/useCapabilities";
import { t } from "../i18n";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import AlertList from "../components/ui/AlertList.vue";
import InlineError from "../components/ui/InlineError.vue";
import JobBlock from "../components/ui/JobBlock.vue";

interface PendingIntent {
  action: ServerOperatorAction;
  target?: string;
  attemptedAt: number;
  byTag: string;
  reason: string;
}

const REFRESH_MS = 15_000;

const ACTION_ICON: Record<ServerOperatorAction, string> = {
  start: "pi pi-play",
  stop: "pi pi-stop",
  restart: "pi pi-replay",
  rollback: "pi pi-history",
  backup: "pi pi-save",
};

/** Alerts this card does not already state in its own wrapper and state lines. */
const CARD_ALERT_KINDS = new Set<Alert["kind"]>(["lowTps", "diskFull"]);

export default defineComponent({
  name: "StatusView",
  components: { Button, ViewHeader, StatusChip, EmptyState, AlertList, InlineError, JobBlock },
  props: {
    activeServer: { type: String, default: "" },
  },
  emits: ["bot-state", "servers"],
  setup(_props, { emit }) {
    const status = useServerStatus();

    // Pull status, then inform the shell (switcher + bot status line).
    async function refresh(): Promise<void> {
      const res = await status.refresh();
      if (res) {
        emit("bot-state", res.bot.alive, res.bot.lastBeat);
        emit("servers", res.servers);
      }
    }

    const actions = useServerActions(refresh);
    const { can } = useCapabilities();

    /**
     * The operator actions this user may run on THIS server, filtered per
     * server because a grant is per server: someone may restart smp and only
     * read creative.
     */
    function actionsFor(server: ServerStatus): readonly ServerOperatorAction[] {
      // Rollback is irreversible and has its own capability; everything else
      // rides on server:control.
      const granted = SERVER_OPERATOR_ACTIONS.filter((a) =>
        can(a === "rollback" ? "server:rollback" : "server:control", server.id),
      );
      // Gated on what the wrapper advertised: a suite without rollback.sh
      // should not offer a Rollback button that 409s. A wrapper too old to
      // report features gets the full set.
      const scripts = server.features?.scripts;
      if (!scripts) return granted;
      return granted.filter((a) => scripts[a] !== false);
    }

    return {
      servers: status.servers,
      refreshing: status.loading,
      loaded: status.loaded,
      failure: status.failure,
      statusError: status.error,
      refresh,
      ...actions,
      actionsFor,
      isActionApplicable,
      formatBytes, mergeDisks, diskSeverity, tpsRole, stateIsUp,
      serverRole, serverRoleLabel, stateExplanation, wrapperNote,
      t,
      ACTION_ICON,
    };
  },
  data() {
    return {
      timer: 0 as ReturnType<typeof setInterval> | 0,
      pendingIntents: {} as Record<string, PendingIntent[]>,
    };
  },
  computed: {
    failureCopy(): FailureCopy {
      // Cards from the last good poll stay up, so a failed refresh says the
      // numbers are old rather than that nothing loaded.
      const stale = this.servers.length > 0;
      return failureCopy(this.failure ?? "failed", {
        failedTitle: stale ? t("servers.staleTitle") : t("servers.failedTitle"),
        failedText: stale ? t("servers.staleText") : t("servers.failedText"),
        forbiddenTitle: t("servers.forbiddenTitle"),
        capability: "server:read",
        request: "GET /api/status",
        error: this.statusError,
      });
    },
  },
  async mounted() {
    await this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), REFRESH_MS);
  },
  unmounted() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    async refreshAll(): Promise<void> {
      await this.refresh();
      await this.loadIntents();
    },
    onRetry(): void {
      if (this.failure === "signedOut") {
        signIn();
        return;
      }
      void this.refreshAll();
    },
    intentsFor(serverId: string): PendingIntent[] {
      return this.pendingIntents[serverId] ?? [];
    },
    cardAlerts(server: ServerStatus): Alert[] {
      return serverAlerts(server).filter((a) => CARD_ALERT_KINDS.has(a.kind));
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
    intentTip(intent: PendingIntent): string {
      return t("servers.intentTip", {
        age: relativeAge(intent.attemptedAt),
        who: intent.byTag,
        reason: intent.reason,
      });
    },
    actionLabel(action: ServerOperatorAction): string {
      return t(`servers.action.${action}`);
    },
    jobTitle(serverId: string): string {
      const job = this.jobs[serverId];
      if (!job) return "";
      return job.state === "running"
        ? t(`servers.job.running.${job.action}`, { server: serverId })
        : t(`servers.job.failed.${job.action}`, { server: serverId });
    },
    /**
     * Exactly one filled button per card, and it is whichever action the
     * server's state invites. A permanently filled "Start" on a running
     * server made the one impossible action the loudest one.
     */
    isPrimaryAction(action: ServerOperatorAction, server: ServerStatus): boolean {
      if (!isActionApplicable(action, server.state)) return false;
      return server.state === ServerState.Offline ? action === "start" : action === "restart";
    },
    /** The primary action is the accent fill; the two that take the server away read as danger. */
    actionSeverity(action: ServerOperatorAction, server: ServerStatus): string | undefined {
      if (this.isPrimaryAction(action, server)) return undefined;
      return action === "stop" || action === "rollback" ? "danger" : "secondary";
    },
    /** Why a disabled button is disabled, so it reads as information, not a bug. */
    unavailableReason(action: ServerOperatorAction, server: ServerStatus): string {
      if (this.isRunning(server.id)) return t("servers.busyReason");
      if (isActionApplicable(action, server.state)) return "";
      return action === "start"
        ? t("servers.alreadyRunning", { server: server.id })
        : t("servers.notRunning", { server: server.id });
    },
  },
});
</script>

<style scoped>
.servers-view { min-width: 0; }
.stack-gap { display: flex; flex-direction: column; gap: var(--space-4); }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
  gap: var(--space-4);
  align-items: start;
}
.card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
  transition: border-color var(--dur-fast);
}
.card.focused { border-color: var(--accent); }

.card-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.card-title { margin: 0; margin-right: auto; font-size: var(--text-xl); font-weight: 600; overflow-wrap: anywhere; }

.card-body { display: flex; flex-direction: column; gap: var(--space-2); }
.players { display: flex; align-items: baseline; gap: var(--space-1); margin: 0; flex-wrap: wrap; }
.players-count { font-size: var(--text-3xl); font-weight: 600; line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.players-max { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.players-label { margin-left: var(--space-2); color: var(--text-dim); font-size: var(--text-sm); }
.note { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
.wrapper-note { color: var(--st-degraded); }
.names { display: flex; flex-direction: column; gap: var(--space-2); }
.names-note { margin: 0; color: var(--text-dim); font-size: var(--text-xs); }
.name-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-1); }
.name {
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  font-size: var(--text-xs);
}

.metrics { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; }
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 84px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.metric dd { margin: 0; }
.metric-disk { flex: 1 1 150px; min-width: 150px; max-width: 280px; }
.m-label { color: var(--text-dim); font-size: var(--text-xs); letter-spacing: var(--tracking-caps); text-transform: uppercase; }
.m-value { color: var(--text); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.m-sub { display: block; color: var(--text-dim); font-size: var(--text-xs); }
.m-meter {
  display: block;
  height: 4px;
  margin: var(--space-1) 0 2px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--border-strong);
}
.m-meter-fill { display: block; height: 100%; border-radius: var(--radius-full); }
.m-meter-fill.good { background: var(--accent); }
.m-meter-fill.mid { background: var(--st-degraded); }
.m-meter-fill.bad { background: var(--danger-solid); }

.card-foot { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--border); }
.card-foot:empty { display: none; }
.intents { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.intents-note { flex-basis: 100%; margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
.intent { display: inline-flex; align-items: center; gap: 2px; }
.ops { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.skeleton { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: var(--space-4); }
.sk-card { height: 260px; border-radius: var(--radius-surface); background: var(--surface-nav); border: 1px solid var(--border); }

@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
  .intent .tap.p-button-icon-only { min-width: var(--touch-min); }
}
</style>
