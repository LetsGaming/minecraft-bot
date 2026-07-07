import { ref, toValue } from "vue";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import type { SetupGuild, SetupChannel, SetupRole } from "../api";

export type FeatureInput =
  | "channel"
  | "channel+webhook"
  | "channel+interval"
  | "channel+admin"
  | "enabled"
  | "role";

export interface FeatureDesc {
  key: string;
  label: string;
  icon: string;
  input: FeatureInput;
  hint: string;
}

// Declarative feature set — order is the display order. Each maps to a
// key in the guild config block. `server` is intentionally never asked
// per-feature: an unset server inherits the guild's defaultServer (see
// schema), which keeps this flow simple.
export const FEATURES: FeatureDesc[] = [
  { key: "notifications", label: "Notifications", icon: "pi pi-bell", input: "channel", hint: "Join/leave and server-event messages." },
  { key: "chatBridge", label: "Chat Bridge", icon: "pi pi-comments", input: "channel+webhook", hint: "Relay chat between Discord and Minecraft." },
  { key: "leaderboard", label: "Leaderboard", icon: "pi pi-chart-bar", input: "channel+interval", hint: "Periodic stat leaderboards." },
  { key: "statusEmbed", label: "Status Embed", icon: "pi pi-desktop", input: "enabled", hint: "Live status embed (creates its own channel)." },
  { key: "downtimeAlerts", label: "Downtime Alerts", icon: "pi pi-exclamation-triangle", input: "channel", hint: "Alerts when a server goes down." },
  { key: "tpsAlerts", label: "TPS Alerts", icon: "pi pi-gauge", input: "channel", hint: "Alerts on sustained low TPS." },
  { key: "reports", label: "Reports", icon: "pi pi-flag", input: "channel", hint: "In-game !report routed to a channel." },
  { key: "console", label: "Console Relay", icon: "pi pi-code", input: "channel", hint: "Admin-only live console via /console live." },
  { key: "channelPurge", label: "Channel Purge", icon: "pi pi-trash", input: "channel", hint: "Auto-clear a channel on a schedule." },
  { key: "whitelistApplications", label: "Whitelist Apps", icon: "pi pi-user-plus", input: "channel+admin", hint: "Application prompt + a staff review channel." },
  { key: "linkedRole", label: "Linked Role", icon: "pi pi-id-card", input: "role", hint: "Role granted when a member links their account." },
];

export interface FeatureModel {
  enabled: boolean;
  channelId: string | null;
  adminChannelId: string | null;
  roleId: string | null;
  useWebhook: boolean;
  interval: string;
}

function blankModel(): Record<string, FeatureModel> {
  const m: Record<string, FeatureModel> = {};
  for (const f of FEATURES) {
    m[f.key] = {
      enabled: false,
      channelId: null,
      adminChannelId: null,
      roleId: null,
      useWebhook: true,
      interval: "weekly",
    };
  }
  return m;
}

/**
 * All of the setup wizard's data + mutation logic: loading the guild list
 * (scoped) and, for sysadmins, the server list; seeding the feature model
 * from an existing guild block so re-running edits rather than blanks;
 * loading a guild's channels + assignable roles; and writing just this
 * guild's block back through the scoped endpoint with optimistic
 * concurrency. The component keeps step navigation and presentation.
 *
 * `getSysadmin` / `getInitialGuildId` are passed as getters so the
 * composable stays reactive to the component's props.
 */
export function useGuildSetup(
  getSysadmin: () => boolean,
  getInitialGuildId: () => string,
) {
  const toast = useToast();

  // step 0 — guild + server selection
  const guilds = ref<SetupGuild[]>([]);
  const configuredGuildIds = ref<string[]>([]);
  const configuredServers = ref<string[]>([]);
  const guildId = ref("");
  const defaultServer = ref<string | null>(null);
  const loadingGuilds = ref(false);
  const guildError = ref("");

  // step 1 — feature model + the target guild's channels/roles
  const channels = ref<SetupChannel[]>([]);
  const roles = ref<SetupRole[]>([]);
  const channelsForGuild = ref("");
  const model = ref<Record<string, FeatureModel>>(blankModel());
  const existingGuildBlock = ref<Record<string, unknown>>({});
  const loadingChannels = ref(false);
  const channelError = ref("");

  // step 2 — write
  const writing = ref(false);
  const writeError = ref("");

  function reset(): void {
    guildId.value = "";
    defaultServer.value = null;
    model.value = blankModel();
    existingGuildBlock.value = {};
    writeError.value = "";
    channelsForGuild.value = "";
    void loadGuilds();
  }

  async function loadGuilds(): Promise<void> {
    loadingGuilds.value = true;
    guildError.value = "";
    try {
      const [guildsRes, myGuildsRes] = await Promise.all([
        apiGet<{ guilds: SetupGuild[] }>("/api/setup/guilds"),
        apiGet<{ guilds: { id: string; configured: boolean }[] }>("/api/guilds"),
      ]);
      guilds.value = guildsRes.guilds.sort((a, b) => a.name.localeCompare(b.name));
      configuredGuildIds.value = myGuildsRes.guilds
        .filter((g) => g.configured)
        .map((g) => g.id);
      // The server picker (and thus the server list) is sysadmin-only —
      // guild managers get no information about the Minecraft servers.
      if (toValue(getSysadmin)) {
        try {
          const srv = await apiGet<{ servers: string[] }>("/api/setup/servers");
          configuredServers.value = srv.servers;
        } catch {
          configuredServers.value = [];
        }
      } else {
        configuredServers.value = [];
      }
      // Editing an existing guild: preselect it and seed from its block.
      const initial = toValue(getInitialGuildId);
      if (initial && guilds.value.some((g) => g.id === initial)) {
        guildId.value = initial;
        await seedFromExisting();
      }
    } catch (err) {
      guildError.value = (err as Error).message;
    } finally {
      loadingGuilds.value = false;
    }
  }

  function onGuildPicked(): void {
    // Seed defaultServer + feature model from any existing guild block,
    // so re-running the wizard edits rather than blanks the config.
    defaultServer.value = null;
    model.value = blankModel();
    existingGuildBlock.value = {};
    if (!guildId.value) return;
    void seedFromExisting();
  }

  async function seedFromExisting(): Promise<void> {
    try {
      const res = await apiGet<{ hash: string; guildConfig: Record<string, unknown> }>(
        `/api/guilds/${encodeURIComponent(guildId.value)}/config`,
      );
      const block = res.guildConfig;
      if (!block || Object.keys(block).length === 0) return;
      existingGuildBlock.value = block;
      defaultServer.value = (block.defaultServer as string) ?? null;
      for (const f of FEATURES) {
        const val = block[f.key];
        if (val === undefined || val === null) continue;
        const m = model.value[f.key];
        if (f.key === "linkedRole") {
          m.enabled = true;
          m.roleId = val as string;
        } else if (f.key === "statusEmbed") {
          m.enabled = (val as { enabled?: boolean }).enabled === true;
        } else {
          const obj = val as {
            channelId?: string;
            adminChannelId?: string;
            useWebhook?: boolean;
            interval?: string;
          };
          m.enabled = true;
          m.channelId = obj.channelId ?? null;
          if (obj.adminChannelId) m.adminChannelId = obj.adminChannelId;
          if (obj.useWebhook !== undefined) m.useWebhook = obj.useWebhook;
          if (obj.interval) m.interval = obj.interval;
        }
      }
    } catch {
      /* seeding is best-effort; a fresh block is a fine fallback */
    }
  }

  async function loadChannelsRoles(): Promise<void> {
    if (channelsForGuild.value === guildId.value && channels.value.length) return;
    loadingChannels.value = true;
    channelError.value = "";
    try {
      const [ch, rl] = await Promise.all([
        apiGet<{ channels: SetupChannel[] }>(
          `/api/setup/guilds/${encodeURIComponent(guildId.value)}/channels`,
        ),
        apiGet<{ roles: SetupRole[] }>(
          `/api/setup/guilds/${encodeURIComponent(guildId.value)}/roles`,
        ),
      ]);
      channels.value = ch.channels;
      roles.value = rl.roles.filter((r) => r.assignable);
      channelsForGuild.value = guildId.value;
    } catch (err) {
      channelError.value = (err as Error).message;
    } finally {
      loadingChannels.value = false;
    }
  }

  function buildGuildBlock(): Record<string, unknown> {
    // Start from the existing block so we preserve fields the wizard
    // doesn't manage (adminUsers, allowedServers, language, command
    // overrides, …), then overlay the wizard's decisions.
    const block: Record<string, unknown> = { ...existingGuildBlock.value };

    if (defaultServer.value) block.defaultServer = defaultServer.value;
    else delete block.defaultServer;

    for (const f of FEATURES) {
      const m = model.value[f.key];
      if (!m.enabled) {
        delete block[f.key];
        continue;
      }
      if (f.key === "linkedRole") {
        block.linkedRole = m.roleId;
      } else if (f.key === "statusEmbed") {
        block.statusEmbed = { enabled: true };
      } else if (f.input === "channel+webhook") {
        block[f.key] = { channelId: m.channelId, useWebhook: m.useWebhook };
      } else if (f.input === "channel+interval") {
        block[f.key] = { channelId: m.channelId, interval: m.interval };
      } else if (f.input === "channel+admin") {
        block[f.key] = { channelId: m.channelId, adminChannelId: m.adminChannelId };
      } else {
        block[f.key] = { channelId: m.channelId };
      }
    }
    return block;
  }

  /** Write this guild's block. Returns true on success (caller emits). */
  async function write(): Promise<boolean> {
    writing.value = true;
    writeError.value = "";
    try {
      // Scoped read for a current baseHash, then a scoped write of just
      // this guild's block. The server merges it into the full config;
      // the wizard never sees or sends anyone else's settings.
      const cur = await apiGet<{ hash: string; guildConfig: Record<string, unknown> }>(
        `/api/guilds/${encodeURIComponent(guildId.value)}/config`,
      );
      await apiSend("PUT", `/api/guilds/${encodeURIComponent(guildId.value)}/config`, {
        baseHash: cur.hash,
        guildConfig: buildGuildBlock(),
      });
      const name = guilds.value.find((g) => g.id === guildId.value)?.name ?? guildId.value;
      toast.add({
        severity: "success",
        summary: "Guild configured",
        detail: `${name} is set up. The bot reloads config automatically.`,
        life: 4000,
      });
      return true;
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("conflict")) {
        writeError.value =
          "Config changed underneath the wizard (someone else saved). Reopen the wizard to start from the current config.";
      } else if (message.startsWith("[")) {
        try {
          writeError.value = (JSON.parse(message) as string[]).join("\n");
        } catch {
          writeError.value = message;
        }
      } else {
        writeError.value = message;
      }
      return false;
    } finally {
      writing.value = false;
    }
  }

  return {
    guilds, configuredGuildIds, configuredServers, guildId, defaultServer,
    channels, roles, channelsForGuild, model, existingGuildBlock,
    loadingGuilds, guildError, loadingChannels, channelError, writing, writeError,
    reset, loadGuilds, onGuildPicked, loadChannelsRoles, write,
  };
}
