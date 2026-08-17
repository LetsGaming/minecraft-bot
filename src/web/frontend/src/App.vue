<template>
  <div class="app-root">
    <!-- ── Login gate ── -->
    <div v-if="!loading && !me" class="login-screen">
      <div class="login-card">
        <div class="brand-mark"><i class="pi pi-box" /></div>
        <h1>Minecraft Bot</h1>
        <p class="muted">Server dashboard</p>
        <p class="login-hint muted small">
          Sign in with the Discord account listed in
          <code class="mono">adminUsers</code>.
        </p>
        <Button
          label="Login with Discord"
          icon="pi pi-discord"
          class="discord-btn"
          @click="goLogin"
        />
      </div>
    </div>

    <!-- ── Main app ── -->
    <div v-else class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark sm"><i class="pi pi-box" /></div>
          <div class="brand-text">
            <strong>Minecraft Bot</strong>
            <span class="muted small">Dashboard</span>
          </div>
        </div>

        <!-- Server switcher. /api/status already returns only the servers the
             caller may read, so the list needs no client-side filter: an empty
             list is either "none configured" or "none granted", and both read
             the same to the person looking at it. -->
        <template v-if="canAnywhere('server:read')">
          <div class="switcher-label muted small">SERVER</div>
          <div class="switcher">
            <button
              v-for="s in servers"
              :key="s.id"
              :class="['switch-item', { active: s.id === activeServer }]"
              @click="activeServer = s.id"
            >
              <StatusDot :state="statusDot(s)" />
              <span class="switch-name">{{ s.id }}</span>
              <span v-if="stateIsUp(s.state) && s.tps !== null" class="switch-tps muted small">
                {{ s.tps.toFixed(0) }} TPS
              </span>
            </button>
            <div v-if="servers.length === 0" class="muted small switcher-empty">
              No servers configured
            </div>
          </div>
        </template>

        <!-- Nav -->
        <nav class="nav">
          <button
            v-for="item in visibleNav"
            :key="item.id"
            :class="['nav-item', { active: activeTab === item.id }]"
            @click="activeTab = item.id"
          >
            <i :class="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <!-- Add to Server: the headline action -->
        <div class="sidebar-cta">
          <Button
            label="Add to Server"
            icon="pi pi-plus-circle"
            class="w-full"
            :loading="inviting"
            @click="invite"
          />
          <p class="muted small cta-hint">Invite the bot to a new Discord guild.</p>
        </div>

        <!-- Session footer -->
        <div class="sidebar-foot">
          <div class="who">
            <i class="pi pi-user" />
            <span class="small">{{ me?.tag }}</span>
          </div>
          <Button
            icon="pi pi-sign-out"
            text
            rounded
            severity="secondary"
            aria-label="Logout"
            v-tooltip.top="'Logout'"
            @click="logout"
          />
        </div>
      </aside>

      <main class="content">
        <div class="content-inner">
        <Message
          v-if="botDown && isSysadmin"
          severity="warn"
          :closable="false"
          class="bot-down"
        >
          The bot process looks down (heartbeat stale) — status data may be
          outdated and config changes only apply once it's back.
        </Message>

        <div v-if="loading" class="center muted">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem" />
        </div>

        <!-- Signed in and granted nothing. Better one clear line than an
             empty shell that looks broken. -->
        <EmptyState v-else-if="hasNothing" icon="pi pi-lock">
          Your account has no dashboard access yet.
          <template #action>
            <span class="muted small">
              Ask an operator to grant you access under <strong>webui.grants</strong>.
            </span>
          </template>
        </EmptyState>

        <!-- Each view is gated by the same predicate as its tab, so the two
             can never disagree. -->
        <template v-else>
          <OverviewView v-if="activeTab === 'overview' && shows('overview')" @navigate="activeTab = $event" />
          <StatusView
            v-if="shows('status')"
            v-show="activeTab === 'status'"
            :active-server="activeServer"
            @bot-state="botDown = !$event"
            @servers="onServers"
          />
          <ConsoleView
            v-if="activeTab === 'console' && shows('console')"
            :server-ids="servers.map((s) => s.id)"
            :active-server="activeServer"
          />
          <BackupsView
            v-if="activeTab === 'backups' && shows('backups')"
            :server-ids="servers.map((s) => s.id)"
            :active-server="activeServer"
          />
          <ModsView
            v-if="activeTab === 'mods' && shows('mods')"
            :active-server="activeServer"
          />
          <ModConfigView
            v-if="activeTab === 'modconfig' && shows('modconfig')"
            :server-ids="servers.map((s) => s.id)"
            :active-server="activeServer"
          />
          <GuildsView
            v-if="activeTab === 'guilds' && shows('guilds')"
            :sysadmin="isSysadmin"
            @goto-config="activeTab = 'config'"
          />
          <AnalyticsView
            v-if="activeTab === 'analytics' && shows('analytics')"
            :server-ids="servers.map((s) => s.id)"
            :active-server="activeServer"
          />
          <CommandsView v-if="activeTab === 'commands' && shows('commands')" />
          <ConfigView v-if="activeTab === 'config' && shows('config')" />
          <AuditView v-if="activeTab === 'audit' && shows('audit')" />
        </template>
        </div>
      </main>
    </div>

    <Toast position="bottom-right" />
    <ConfirmDialog />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import { apiGet, apiSend, UnauthorizedError } from "./api";
import type { MeResponse, ServerStatus, GrantableCapability } from "./api";
import { useCapabilities, setCapabilities } from "./composables/useCapabilities";
import { useInvite } from "./composables/useInvite";
import StatusDot from "./components/ui/StatusDot.vue";
import EmptyState from "./components/ui/EmptyState.vue";
import { statusDot } from "./utils/format";
import { stateIsUp } from "@mcbot/schema/serverState.js";
import OverviewView from "./views/OverviewView.vue";
import StatusView from "./views/StatusView.vue";
import ConsoleView from "./views/ConsoleView.vue";
import BackupsView from "./views/BackupsView.vue";
import ModConfigView from "./views/ModConfigView.vue";
import ModsView from "./views/ModsView.vue";
import GuildsView from "./views/GuildsView.vue";
import CommandsView from "./views/CommandsView.vue";
import ConfigView from "./views/ConfigView.vue";
import AuditView from "./views/AuditView.vue";
import AnalyticsView from "./views/AnalyticsView.vue";

/** A sidebar entry and the condition for showing it. */
interface NavItem {
  id: string;
  label: string;
  icon: string;
  gate: GrantableCapability | "sysadmin" | "guild";
}

export default defineComponent({
  name: "App",
  components: {
    Button, Message, Toast, ConfirmDialog, StatusDot, EmptyState,
    OverviewView, StatusView, ConsoleView, BackupsView, ModsView, ModConfigView, GuildsView,
    CommandsView, ConfigView, AuditView, AnalyticsView,
  },
  setup() {
    return { ...useInvite(), ...useCapabilities(), statusDot, stateIsUp };
  },
  data() {
    return {
      loading: true,
      me: null as MeResponse | null,
      botDown: false,
      activeTab: "overview",
      activeServer: "",
      servers: [] as ServerStatus[],
      // One table drives the sidebar and the view switch below, so a tab
      // can't be visible and its view gated differently (or the reverse).
      //
      // `gate` is a capability, or one of two things a capability can't
      // express: "sysadmin" for the config surface (bot:config is never
      // granted, by design) and "guild" for the Discord-side tab, which has
      // nothing to do with host access.
      nav: [
        { id: "overview", label: "Overview", icon: "pi pi-th-large", gate: "server:read" },
        { id: "status", label: "Servers", icon: "pi pi-server", gate: "server:read" },
        { id: "guilds", label: "Guilds", icon: "pi pi-discord", gate: "guild" },
        { id: "console", label: "Console", icon: "pi pi-desktop", gate: "server:read" },
        { id: "analytics", label: "Analytics", icon: "pi pi-chart-bar", gate: "server:read" },
        { id: "commands", label: "Commands", icon: "pi pi-bolt", gate: "sysadmin" },
        { id: "backups", label: "Backups", icon: "pi pi-box", gate: "server:read" },
        { id: "mods", label: "Mods", icon: "pi pi-download", gate: "mods:read" },
        { id: "modconfig", label: "Mod Config", icon: "pi pi-sliders-h", gate: "config:read" },
        { id: "config", label: "Config", icon: "pi pi-sliders-h", gate: "sysadmin" },
        { id: "audit", label: "Audit Log", icon: "pi pi-history", gate: "audit:read" },
      ] as NavItem[],
    };
  },
  computed: {
    isSysadmin(): boolean {
      return !!this.me?.sysadmin;
    },
    visibleNav(): NavItem[] {
      return this.nav.filter((item) => this.navAllowed(item));
    },
    /** Signed in, but granted nothing: one honest empty state beats six
     *  tabs that all 403. */
    hasNothing(): boolean {
      return this.visibleNav.length === 0;
    },
  },
  async mounted() {
    try {
      this.me = await apiGet<MeResponse>("/api/me");
      // One owner of this request, so the composable is populated rather than
      // fetching for itself (see useCapabilities).
      setCapabilities(this.me.capabilities);
      // Land on the first tab this user can actually see, whatever that is.
      this.activeTab = this.visibleNav[0]?.id ?? "";
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        // Browser context: console is the only error sink available, and an
        // unexpected failure here (network, unexpected 5xx) is worth surfacing
        // for debugging. A 401 is an expected "not signed in" and stays quiet.
        console.error(err);
      }
      this.me = null;
      setCapabilities(undefined);
    } finally {
      this.loading = false;
    }
  },
  methods: {
    /** Is this tab id one the caller may see? The view switch reads the same
     *  answer the sidebar does. */
    shows(id: string): boolean {
      return this.visibleNav.some((item) => item.id === id);
    },
    navAllowed(item: NavItem): boolean {
      if (item.gate === "sysadmin") return this.isSysadmin;
      if (item.gate === "guild") return this.isSysadmin || (this.me?.guildCount ?? 0) > 0;
      if (!this.canAnywhere(item.gate)) return false;
      // The Backups panel needs a wrapper new enough to serve the archive
      // index, so hide it when one positively says it cannot — better than a
      // tab that errors on open.
      //
      // `!== false` and not `=== true`: null means "could not ask the wrapper"
      // (unreachable, or still loading), and that must not hide the tab. It
      // matches how action buttons already treat unknown, and it avoids an
      // outage looking like the feature disappeared.
      if (item.id === "backups") {
        return this.servers.some((s) => s.features?.backupFiles !== false);
      }
      return true;
    },
    goLogin() {
      window.location.href = "/auth/login";
    },
    async logout() {
      try {
        await apiSend("POST", "/auth/logout");
      } catch {
        /* ignore */
      }
      this.me = null;
    },
    onServers(servers: ServerStatus[]) {
      this.servers = servers;
      if (!this.activeServer && servers.length) {
        this.activeServer = servers[0].id;
      }
    },
  },
});
</script>

<style scoped>
.app-root { min-height: 100vh; position: relative; z-index: 1; }

/* ── Login ── */
.login-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.login-card {
  background: var(--mc-surface);
  border: 0.5px solid var(--mc-border);
  border-radius: 14px;
  padding: 40px 44px;
  text-align: center;
  max-width: 380px;
  width: 100%;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.login-card h1 { margin: 16px 0 2px; font-size: 22px; font-weight: 500; }
.login-hint { margin: 18px 0 22px; }
.discord-btn { width: 100%; }
:deep(.discord-btn.p-button) {
  background: var(--mc-discord);
  border-color: var(--mc-discord);
  color: var(--mc-on-brand);
}
:deep(.discord-btn.p-button:hover) {
  background: var(--mc-discord-strong);
  border-color: var(--mc-discord-strong);
}

.brand-mark {
  width: 56px; height: 56px;
  border-radius: 14px;
  display: grid; place-items: center;
  margin: 0 auto;
  background: var(--mc-accent-bg);
  border: 0.5px solid var(--mc-accent-border);
  color: var(--mc-accent);
  font-size: 26px;
}
.brand-mark.sm { width: 34px; height: 34px; border-radius: 9px; font-size: 16px; margin: 0; }

/* ── Shell ── */
/* The shell owns the viewport and the content column owns the scroll, so
   the sidebar never scrolls away, `position: sticky` inside a view sticks
   to the top of the content area, and a view can claim the remaining
   height (Console, Mod Config) instead of guessing at a vh fraction. */
.shell { display: flex; height: 100dvh; overflow: hidden; }

.sidebar {
  width: var(--mc-sidebar-w);
  flex: none;
  background: var(--mc-surface);
  border-right: 0.5px solid var(--mc-border);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  height: 100%;
  overflow-y: auto;
}
.sidebar-brand {
  display: flex; align-items: center; gap: 10px;
  padding: 2px 4px 14px;
  margin-bottom: 4px;
  border-bottom: 0.5px solid var(--mc-border);
}
.brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.brand-text strong { font-size: 13.5px; font-weight: 500; }

.switcher-label { padding: 8px 6px 6px; letter-spacing: 0.07em; }
.switcher { display: flex; flex-direction: column; gap: 1px; margin-bottom: 4px; }
.switch-item {
  display: flex; align-items: center; gap: 8px;
  background: none; border: none; color: var(--mc-text);
  padding: 7px 9px; border-radius: 7px; cursor: pointer;
  font-size: 13px; text-align: left; width: 100%;
}
.switch-item:hover { background: var(--mc-card); }
.switch-item.active {
  background: linear-gradient(90deg, rgba(52, 197, 106, 0.10), transparent);
  box-shadow: inset 2px 0 0 var(--mc-accent);
}
.switch-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.switcher-empty { padding: 6px 9px; }

.nav {
  display: flex; flex-direction: column; gap: 1px;
  margin-top: 10px; padding-top: 11px;
  border-top: 0.5px solid var(--mc-border);
}
.nav-item {
  display: flex; align-items: center; gap: 10px;
  background: none; border: none; color: var(--mc-muted);
  padding: 8px 10px; border-radius: 7px; cursor: pointer;
  font-size: 13.5px; text-align: left; width: 100%;
}
.nav-item i { font-size: 15px; width: 17px; }
.nav-item:hover { color: var(--mc-text); background: var(--mc-card); }
.nav-item.active { color: var(--mc-text); background: var(--mc-card); }
.nav-item.active i { color: var(--mc-accent); }

.sidebar-cta { margin-top: auto; padding: 12px 2px 4px; }
.w-full { width: 100%; }
.cta-hint { margin: 7px 2px 0; line-height: 1.4; }

.sidebar-foot {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 8px; padding: 9px 4px 0;
  border-top: 0.5px solid var(--mc-border);
}
.who { display: flex; align-items: center; gap: 7px; color: var(--mc-muted); }
.who i { font-size: 13px; }

/* ── Content ── */
.content { flex: 1; min-width: 0; overflow-y: auto; }
.content-inner {
  min-height: 100%;
  max-width: var(--mc-content-max);
  margin-inline: auto;
  padding: 24px 26px 48px;
  display: flex;
  flex-direction: column;
}
/* A view that opts into filling (`.view-fill`) takes the leftover height;
   every other view keeps its natural height. `min-height: 0` is what lets
   an inner pane scroll instead of stretching its parent. */
.content-inner > :deep(.view-fill) { flex: 1; min-height: 0; }

.bot-down { margin-bottom: 20px; }
.center { display: grid; place-items: center; padding: 80px 0; }

@media (max-width: 760px) {
  .shell { flex-direction: column; height: auto; overflow: visible; }
  .sidebar {
    width: 100%; height: auto;
    flex-direction: row; flex-wrap: wrap; align-items: center;
    gap: 8px;
  }
  .sidebar-cta { margin: 0; padding: 0; }
  .sidebar-cta .cta-hint { display: none; }
  .content { overflow: visible; }
  .content-inner { padding: 20px 16px 40px; }
}
</style>
