<template>
  <div class="shell">
    <header>
      <h1>minecraft-bot</h1>
      <nav v-if="me">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="session" v-if="me">
        <span>{{ me.tag }}</span>
        <button class="ghost" @click="logout">Logout</button>
      </div>
    </header>

    <div v-if="me && botDown" class="banner">
      ⚠ The bot process looks down (heartbeat stale) — status data may be
      outdated and config changes only apply once it's back.
    </div>

    <main>
      <div v-if="loading" class="center">Loading…</div>

      <div v-else-if="!me" class="center login">
        <h2>Dashboard login</h2>
        <p>
          Sign in with the Discord account that is listed in
          <code>adminUsers</code>.
        </p>
        <a class="button" href="/auth/login">Login with Discord</a>
      </div>

      <StatusView
        v-else-if="activeTab === 'status'"
        @bot-state="botDown = !$event"
      />
      <CommandsView v-else-if="activeTab === 'commands'" />
      <ConfigView v-else-if="activeTab === 'config'" />
      <AuditView v-else-if="activeTab === 'audit'" />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiSend, UnauthorizedError } from "./api";
import StatusView from "./components/StatusView.vue";
import CommandsView from "./components/CommandsView.vue";
import ConfigView from "./components/ConfigView.vue";
import AuditView from "./components/AuditView.vue";

export default defineComponent({
  name: "App",
  components: { StatusView, CommandsView, ConfigView, AuditView },
  data() {
    return {
      loading: true,
      me: null as { uid: string; tag: string } | null,
      activeTab: "status",
      botDown: false,
      tabs: [
        { id: "status", label: "Status" },
        { id: "commands", label: "Commands" },
        { id: "config", label: "Config" },
        { id: "audit", label: "Audit" },
      ],
    };
  },
  async mounted() {
    try {
      this.me = await apiGet<{ uid: string; tag: string }>("/api/me");
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) console.error(err);
      this.me = null;
    } finally {
      this.loading = false;
    }
  },
  methods: {
    async logout() {
      await apiSend("POST", "/auth/logout");
      this.me = null;
    },
  },
});
</script>
