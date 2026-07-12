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

        <!-- Server switcher (sysadmin only — exposes server state) -->
        <template v-if="isSysadmin">
          <div class="switcher-label muted small">SERVER</div>
          <div class="switcher">
            <button
              v-for="s in servers"
              :key="s.id"
              :class="['switch-item', { active: s.id === activeServer }]"
              @click="activeServer = s.id"
            >
              <StatusDot :state="s.online ? 'up' : 'down'" />
              <span class="switch-name">{{ s.id }}</span>
              <span v-if="s.online && s.tps !== null" class="switch-tps muted small">
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

        <template v-else>
          <OverviewView v-if="activeTab === 'overview' && isSysadmin" @navigate="activeTab = $event" />
          <StatusView
            v-if="isSysadmin"
            v-show="activeTab === 'status'"
            :active-server="activeServer"
            @bot-state="botDown = !$event"
            @servers="onServers"
          />
          <GuildsView
            v-if="activeTab === 'guilds'"
            :sysadmin="isSysadmin"
            @goto-config="activeTab = 'config'"
          />
          <CommandsView v-if="activeTab === 'commands' && isSysadmin" />
          <ConfigView v-if="activeTab === 'config' && isSysadmin" />
          <AuditView v-if="activeTab === 'audit' && isSysadmin" />
        </template>
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
import type { MeResponse, ServerStatus } from "./api";
import { useInvite } from "./composables/useInvite";
import StatusDot from "./components/StatusDot.vue";
import OverviewView from "./views/OverviewView.vue";
import StatusView from "./views/StatusView.vue";
import GuildsView from "./views/GuildsView.vue";
import CommandsView from "./views/CommandsView.vue";
import ConfigView from "./views/ConfigView.vue";
import AuditView from "./views/AuditView.vue";

export default defineComponent({
  name: "App",
  components: {
    Button, Message, Toast, ConfirmDialog, StatusDot,
    OverviewView, StatusView, GuildsView, CommandsView, ConfigView, AuditView,
  },
  setup() {
    return { ...useInvite() };
  },
  data() {
    return {
      loading: true,
      me: null as MeResponse | null,
      botDown: false,
      activeTab: "overview",
      activeServer: "",
      servers: [] as ServerStatus[],
      nav: [
        { id: "overview", label: "Overview", icon: "pi pi-th-large" },
        { id: "status", label: "Servers", icon: "pi pi-server" },
        { id: "guilds", label: "Guilds", icon: "pi pi-discord" },
        { id: "commands", label: "Commands", icon: "pi pi-bolt" },
        { id: "config", label: "Config", icon: "pi pi-sliders-h" },
        { id: "audit", label: "Audit Log", icon: "pi pi-history" },
      ],
    };
  },
  computed: {
    isSysadmin(): boolean {
      return !!this.me?.sysadmin;
    },
    visibleNav(): Array<{ id: string; label: string; icon: string }> {
      // Guild managers only get the Guilds tab; everything else exposes the
      // Minecraft server, global config, or the audit log (sysadmin-only).
      return this.isSysadmin ? this.nav : this.nav.filter((n) => n.id === "guilds");
    },
  },
  async mounted() {
    try {
      this.me = await apiGet<MeResponse>("/api/me");
      // Land somewhere the role can actually see.
      this.activeTab = this.isSysadmin ? "overview" : "guilds";
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        // Browser context: console is the only error sink available, and an
        // unexpected failure here (network, unexpected 5xx) is worth surfacing
        // for debugging. A 401 is an expected "not signed in" and stays quiet.
        console.error(err);
      }
      this.me = null;
    } finally {
      this.loading = false;
    }
  },
  methods: {
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
.shell { display: flex; min-height: 100vh; }

.sidebar {
  width: var(--mc-sidebar-w);
  flex: none;
  background: var(--mc-surface);
  border-right: 0.5px solid var(--mc-border);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  position: sticky;
  top: 0;
  height: 100vh;
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
.content {
  flex: 1;
  min-width: 0;
  padding: 24px 26px 48px;
  max-width: 1160px;
}
.bot-down { margin-bottom: 20px; }
.center { display: grid; place-items: center; padding: 80px 0; }

@media (max-width: 760px) {
  .shell { flex-direction: column; }
  .sidebar {
    width: 100%; height: auto; position: static;
    flex-direction: row; flex-wrap: wrap; align-items: center;
    gap: 8px;
  }
  .sidebar-cta { margin: 0; padding: 0; }
  .sidebar-cta .cta-hint { display: none; }
  .content { padding: 20px 16px 40px; }
}
</style>
