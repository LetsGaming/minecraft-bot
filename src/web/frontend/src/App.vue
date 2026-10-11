<template>
  <div class="app-root">
    <div v-if="!loading && !me" class="login-screen">
      <main class="login-card">
        <div class="brand-mark"><i class="pi pi-box" aria-hidden="true" /></div>
        <p class="login-brand">{{ t("app.name") }}</p>
        <h1>{{ t("login.title") }}</h1>
        <p class="login-hint muted small">
          {{ t("login.hintLead") }} <code class="mono">adminUsers</code>.
        </p>
        <Button
          :label="t('login.button')"
          icon="pi pi-discord"
          class="discord-btn"
          @click="goLogin"
        />
      </main>
    </div>

    <div v-else-if="loading" class="boot" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" />
      <span class="sr-only">{{ t("shell.loading") }}</span>
    </div>

    <AppShell
      v-else
      :groups="shellGroups"
      :title="currentLabel"
      :servers="servers"
      :active-server="activeServer"
      :show-server-picker="canAnywhere('server:read')"
      :user-tag="me?.tag ?? ''"
      :inviting="inviting"
      @switch-server="switchServer"
      @invite="invite"
      @logout="logout"
    >
      <template v-if="botDown && isSysadmin" #status>
        <i class="pi pi-exclamation-triangle bot-down-icon" aria-hidden="true" />
        <span>{{ botDownText }}</span>
        <RouterLink v-if="activeTab !== 'overview' && shows('overview')" :to="{ name: 'overview' }">
          {{ t("shell.botDownLink") }}
        </RouterLink>
      </template>

      <EmptyState v-if="hasNothing" icon="pi pi-lock">
        {{ t("shell.noAccess") }}
        <template #action>
          <span class="muted small">
            {{ t("shell.noAccessHintLead") }} <code class="mono">webui.grants</code>.
          </span>
        </template>
      </EmptyState>

      <!-- Each view is gated by the same predicate as its nav entry, so the
           two can never disagree. Servers stays mounted on every route: its
           poll feeds the server picker and the bot status line. -->
      <template v-else>
        <template v-for="entry in visibleEntries" :key="entry.id">
          <component
            :is="views[entry.id].component"
            v-if="views[entry.id].keepMounted || activeTab === entry.id"
            v-show="activeTab === entry.id"
            v-bind="viewProps(entry.id)"
            @navigate="goToNav"
            @goto-config="goToNav('config')"
            @bot-state="onBotState"
            @servers="onServers"
            @update-route="patchRoute"
          />
        </template>
      </template>
    </AppShell>

    <Toast position="bottom-right" />
    <ConfirmDialog />
    <TypedConfirmDialog />
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw, type Component } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import TypedConfirmDialog from "./components/ui/TypedConfirmDialog.vue";
import AppShell, { type ShellNavGroup } from "./components/ui/AppShell.vue";
import EmptyState from "./components/ui/EmptyState.vue";
import { apiGet, apiSend, UnauthorizedError } from "./api";
import type { MeResponse, ServerStatus } from "./api";
import { useCapabilities, setCapabilities } from "./composables/useCapabilities";
import { useInvite } from "./composables/useInvite";
import {
  NAV_ENTRIES,
  NAV_GROUPS,
  navLocation,
  patchedLocation,
  serverOf,
  type NavEntry,
  type NavId,
  type RoutePatch,
} from "./router";
import { relativeAge } from "./utils/time";
import { t } from "./i18n";
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

/** Props a view can receive, picked off one shared context per view. */
interface AppViewContext {
  serverIds: string[];
  activeServer: string;
  sysadmin: boolean;
}

interface ViewEntry {
  component: Component;
  /** Which keys of AppViewContext this view takes as props. */
  props?: Array<keyof AppViewContext>;
  keepMounted?: boolean;
}

const VIEWS: Record<NavId, ViewEntry> = {
  overview: { component: markRaw(OverviewView) },
  analytics: { component: markRaw(AnalyticsView), props: ["serverIds", "activeServer"] },
  console: { component: markRaw(ConsoleView), props: ["serverIds", "activeServer"] },
  audit: { component: markRaw(AuditView) },
  servers: { component: markRaw(StatusView), props: ["activeServer"], keepMounted: true },
  backups: { component: markRaw(BackupsView), props: ["serverIds", "activeServer"] },
  mods: { component: markRaw(ModsView), props: ["activeServer"] },
  modconfig: { component: markRaw(ModConfigView), props: ["serverIds", "activeServer"] },
  config: { component: markRaw(ConfigView) },
  commands: { component: markRaw(CommandsView) },
  guilds: { component: markRaw(GuildsView), props: ["sysadmin"] },
};

function queryText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default defineComponent({
  name: "App",
  components: {
    AppShell, Button, Toast, ConfirmDialog, TypedConfirmDialog, EmptyState, RouterLink,
  },
  setup() {
    return {
      ...useInvite(),
      ...useCapabilities(),
      t,
      views: VIEWS,
    };
  },
  data() {
    return {
      loading: true,
      me: null as MeResponse | null,
      botDown: false,
      lastBeat: null as number | null,
      /** The server views fall back to on routes that carry none. */
      lastServer: "",
      servers: [] as ServerStatus[],
      serversLoaded: false,
    };
  },
  computed: {
    isSysadmin(): boolean {
      return !!this.me?.sysadmin;
    },
    visibleEntries(): NavEntry[] {
      return NAV_ENTRIES.filter((entry) => this.navAllowed(entry));
    },
    /** Signed in, but granted nothing: one honest empty state beats views
     *  that all 403. */
    hasNothing(): boolean {
      return this.visibleEntries.length === 0;
    },
    activeTab(): NavId | "" {
      return this.$route.meta.nav ?? "";
    },
    activeEntry(): NavEntry | undefined {
      return NAV_ENTRIES.find((entry) => entry.id === this.activeTab);
    },
    routeServer(): string {
      return serverOf(this.$route);
    },
    activeServer(): string {
      return this.routeServer || this.lastServer;
    },
    currentLabel(): string {
      return this.activeEntry ? t(this.activeEntry.labelKey) : t("app.name");
    },
    shellGroups(): ShellNavGroup[] {
      const visible = new Set(this.visibleEntries.map((entry) => entry.id));
      return NAV_GROUPS.map((group) => ({
        id: group.id,
        label: t(group.labelKey),
        items: group.items
          .filter((entry) => visible.has(entry.id))
          .map((entry) => ({
            id: entry.id,
            label: t(entry.labelKey),
            icon: entry.icon,
            to: navLocation(entry, this.activeServer),
            active: entry.id === this.activeTab,
          })),
      })).filter((group) => group.items.length > 0);
    },
    /** The one source every view's props are picked from, see viewProps. */
    viewContext(): AppViewContext {
      return {
        serverIds: this.servers.map((s) => s.id),
        activeServer: this.activeServer,
        sysadmin: this.isSysadmin,
      };
    },
    botDownText(): string {
      return this.lastBeat
        ? t("shell.botDown", { age: relativeAge(this.lastBeat) })
        : t("shell.botDownNever");
    },
  },
  watch: {
    routeServer(id: string) {
      if (id) this.lastServer = id;
    },
    currentLabel: {
      immediate: true,
      handler(label: string) {
        document.title = t("app.pageTitle", { view: label });
      },
    },
    "$route.fullPath"() {
      this.ensureRoute();
    },
    visibleEntries() {
      this.ensureRoute();
    },
  },
  async mounted() {
    try {
      this.me = await apiGet<MeResponse>("/api/me");
      // One owner of this request, so the composable is populated rather than
      // fetching for itself (see useCapabilities).
      setCapabilities(this.me.capabilities);
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
    await this.$router.isReady();
    this.ensureRoute();
  },
  methods: {
    /**
     * Keeps the URL on something this user may see: a route they cannot open
     * (or the bare `#/`) lands on the first allowed view, and a server scoped
     * view gets the remembered server once the status poll names one.
     */
    ensureRoute(): void {
      if (this.loading || !this.me || this.hasNothing) return;
      const first = this.visibleEntries[0]!;
      const entry = this.activeEntry;
      if (!entry || !this.navAllowed(entry)) {
        void this.$router.replace(navLocation(first, this.activeServer));
        return;
      }
      if (!entry.serverScoped || !this.serversLoaded || this.servers.length === 0) return;
      const known = this.servers.some((s) => s.id === this.routeServer);
      if (!known) {
        const fallback = this.servers.some((s) => s.id === this.lastServer)
          ? this.lastServer
          : this.servers[0]!.id;
        void this.$router.replace(navLocation(entry, fallback));
      }
    },
    goToNav(id: string): void {
      const entry = NAV_ENTRIES.find((e) => e.id === id);
      if (entry) void this.$router.push(navLocation(entry, this.activeServer));
    },
    /** In-view state (open file, filters, raw mode) replaces the URL rather
     *  than stacking history; the view guards its own switch. */
    patchRoute(patch: RoutePatch): void {
      void this.$router.replace(patchedLocation(this.$route, patch));
    },
    /** A server switch on a server scoped view is a route change, so the
     *  router's leave guard asks before unsaved work is thrown away. */
    switchServer(id: string): void {
      if (id === this.activeServer) return;
      const entry = this.activeEntry;
      if (entry?.serverScoped) {
        void this.$router.push(navLocation(entry, id));
      } else {
        this.lastServer = id;
      }
    },
    shows(id: NavId): boolean {
      return this.visibleEntries.some((entry) => entry.id === id);
    },
    navAllowed(entry: NavEntry): boolean {
      if (entry.gate === "sysadmin") return this.isSysadmin;
      if (entry.gate === "guild") return this.isSysadmin || (this.me?.guildCount ?? 0) > 0;
      if (!this.canAnywhere(entry.gate)) return false;
      // The Backups panel needs a wrapper new enough to serve the archive
      // index, so hide it when one positively says it cannot. Until the first
      // status poll answers nothing is known, so a deep link is kept.
      //
      // `!== false` and not `=== true`: null means "could not ask the wrapper"
      // (unreachable, or still loading), and that must not hide the view. It
      // matches how action buttons already treat unknown, and it avoids an
      // outage looking like the feature disappeared.
      if (entry.id === "backups" && this.serversLoaded) {
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
    onBotState(alive: boolean, lastBeat?: number | null) {
      this.botDown = !alive;
      this.lastBeat = lastBeat ?? null;
    },
    onServers(servers: ServerStatus[]) {
      this.servers = servers;
      this.serversLoaded = true;
      if (!this.lastServer && servers.length) {
        this.lastServer = this.routeServer || servers[0]!.id;
      }
      this.ensureRoute();
    },
    /** This view's declared props plus the route state it owns. */
    viewProps(id: NavId): Record<string, unknown> {
      const ctx = this.viewContext;
      const out: Record<string, unknown> = {};
      for (const key of this.views[id].props ?? []) out[key] = ctx[key];
      if (id !== this.activeTab) return out;
      const { params, query } = this.$route;
      if (id === "mods") {
        out.check = queryText(query.check);
        out.filter = queryText(query.filter);
      } else if (id === "modconfig") {
        out.fileId = queryText(params.fileId);
      } else if (id === "config") {
        out.raw = params.mode === "raw";
        out.q = queryText(query.q);
      } else if (id === "guilds") {
        out.guildId = queryText(params.guildId);
      }
      return out;
    },
  },
});
</script>

<style scoped>
.app-root { min-height: 100vh; position: relative; z-index: 1; }

.login-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-5);
}
.login-card {
  background: var(--surface-nav);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  padding: 40px 44px;
  text-align: center;
  max-width: 380px;
  width: 100%;
  box-shadow: var(--shadow-overlay);
}
.login-brand { margin: 16px 0 2px; color: var(--text-dim); font-weight: 500; }
.login-card h1 { margin: 0; font-size: var(--text-2xl); font-weight: 600; }
.login-hint { margin: 18px 0 22px; }
.discord-btn { width: 100%; }
:deep(.discord-btn.p-button) {
  background: var(--discord);
  border-color: var(--discord);
  color: var(--on-brand);
}
:deep(.discord-btn.p-button:hover) {
  background: var(--discord-strong);
  border-color: var(--discord-strong);
}

.brand-mark {
  width: 56px; height: 56px;
  border-radius: var(--radius-surface);
  display: grid; place-items: center;
  margin: 0 auto;
  background: var(--accent-tint);
  border: 1px solid var(--accent-border);
  color: var(--accent);
  font-size: 26px;
}

.boot {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--text-dim);
  font-size: var(--text-2xl);
}

.bot-down-icon { color: var(--st-degraded); }
</style>
