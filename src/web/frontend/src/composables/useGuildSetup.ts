import { computed, ref, toValue } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { isRecord } from "../utils/isRecord";
import { useToast } from "primevue/usetoast";
import { DEFAULT_NOTIFICATION_EVENTS, type GuildFeatureKey } from "@mcbot/schema";
import { apiGet, apiSend, isConflict, validationErrors } from "../api";
import type { SetupGuild, SetupChannel, SetupRole } from "../api";

export type FeatureInput =
  | "channel"
  | "channel+webhook"
  | "channel+interval"
  | "channel+admin"
  | "enabled"
  | "role";

export interface FeatureDesc {
  key: GuildFeatureKey;
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
  /**
   * The existing value has a shape the wizard cannot express (several chat
   * bridges, for example). It is written back untouched while the feature
   * stays on, and edited in the Config view instead.
   */
  preserved: boolean;
  /** Was the feature on in the block the wizard started from? */
  wasEnabled: boolean;
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
      preserved: false,
      wasEnabled: false,
    };
  }
  return m;
}

/** Fill a feature model from an existing guild block so re-running edits rather than blanks. */
export function seedModel(block: Record<string, unknown>): Record<string, FeatureModel> {
  const model = blankModel();
  for (const f of FEATURES) {
    const val = block[f.key];
    if (val === undefined || val === null) continue;
    const m = model[f.key]!;
    if (f.key === "linkedRole") {
      m.enabled = true;
      m.roleId = typeof val === "string" ? val : "";
    } else if (f.key === "statusEmbed") {
      m.enabled = isRecord(val) && val.enabled === true;
    } else if (Array.isArray(val)) {
      m.enabled = true;
      m.preserved = true;
    } else if (isRecord(val)) {
      m.enabled = true;
      m.channelId = typeof val.channelId === "string" ? val.channelId : null;
      if (typeof val.adminChannelId === "string") m.adminChannelId = val.adminChannelId;
      if (typeof val.useWebhook === "boolean") m.useWebhook = val.useWebhook;
      if (typeof val.interval === "string") m.interval = val.interval;
    }
    m.wasEnabled = m.enabled;
  }
  return model;
}

/**
 * The guild block to write: the existing block with the wizard's decisions
 * merged in. Every sub-key the wizard does not ask about (`server`,
 * `mentionRole`, `postTime`, `events`, ...) survives, and a feature the user
 * did not touch is left exactly as it was.
 */
export function buildGuildBlock(
  existing: Record<string, unknown>,
  model: Record<string, FeatureModel>,
  defaultServer: string | null,
): Record<string, unknown> {
  const block: Record<string, unknown> = { ...existing };

  if (defaultServer) block.defaultServer = defaultServer;
  else delete block.defaultServer;

  for (const f of FEATURES) {
    const m = model[f.key]!;
    const prior = existing[f.key];
    const priorRecord = isRecord(prior) ? prior : {};

    if (!m.enabled) {
      if (!m.wasEnabled) continue;
      if (f.key === "statusEmbed" && isRecord(prior)) {
        block.statusEmbed = { ...prior, enabled: false };
      } else {
        delete block[f.key];
      }
      continue;
    }
    if (m.preserved) continue;

    if (f.key === "linkedRole") {
      block.linkedRole = m.roleId;
    } else if (f.key === "statusEmbed") {
      block.statusEmbed = { ...priorRecord, enabled: true };
    } else if (f.input === "channel+webhook") {
      block[f.key] = { ...priorRecord, channelId: m.channelId, useWebhook: m.useWebhook };
    } else if (f.input === "channel+interval") {
      block[f.key] = { ...priorRecord, channelId: m.channelId, interval: m.interval };
    } else if (f.input === "channel+admin") {
      block[f.key] = { ...priorRecord, channelId: m.channelId, adminChannelId: m.adminChannelId };
    } else if (f.key === "notifications") {
      // Without `events` the dispatcher delivers nothing, so a new block gets
      // the default set (the same six the template and docs document) and an
      // existing selection is kept.
      block.notifications = {
        ...priorRecord,
        channelId: m.channelId,
        events: priorRecord.events ?? [...DEFAULT_NOTIFICATION_EVENTS],
      };
    } else {
      block[f.key] = { ...priorRecord, channelId: m.channelId };
    }
  }
  return block;
}

/**
 * All of the setup wizard's data + mutation logic: loading the guild list
 * (scoped) and, for sysadmins, the server list; seeding the feature model
 * from an existing guild block so re-running edits rather than blanks;
 * loading a guild's channels + assignable roles; and writing just this
 * guild's block back through the scoped endpoint, guarded by the hash that
 * came with the seed read. The component keeps step navigation and
 * presentation.
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

  // The guild's current block and the token read with it. Writing is only
  // possible once both are in hand.
  const seeding = ref(false);
  const seedError = ref("");
  const seeded = ref(false);
  let seedHash = "";

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
  const conflicted = ref(false);

  const canWrite = computed(() => seeded.value && !seeding.value && !writing.value);

  function clearSeed(): void {
    defaultServer.value = null;
    model.value = blankModel();
    existingGuildBlock.value = {};
    seeded.value = false;
    seedError.value = "";
    seedHash = "";
    conflicted.value = false;
  }

  function reset(): void {
    guildId.value = "";
    clearSeed();
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
      guildError.value = errorMessage(err);
    } finally {
      loadingGuilds.value = false;
    }
  }

  /** The guild picker changed: drop the old guild's state and read the new one. */
  async function onGuildPicked(): Promise<void> {
    clearSeed();
    if (!guildId.value) return;
    await seedFromExisting();
  }

  /**
   * Read the guild's current block and its concurrency token. Failure is
   * surfaced (`seedError`) and leaves writing blocked: carrying on from an
   * empty base would overwrite whatever the guild already has configured.
   */
  async function seedFromExisting(): Promise<boolean> {
    const id = guildId.value;
    seeding.value = true;
    seedError.value = "";
    seeded.value = false;
    try {
      const res = await apiGet<{ hash: string; guildConfig: Record<string, unknown> }>(
        `/api/guilds/${encodeURIComponent(id)}/config`,
      );
      if (guildId.value !== id) return false;
      const block = res.guildConfig ?? {};
      seedHash = res.hash;
      existingGuildBlock.value = block;
      defaultServer.value =
        typeof block.defaultServer === "string" ? block.defaultServer : null;
      model.value = seedModel(block);
      seeded.value = true;
      return true;
    } catch (err) {
      if (guildId.value === id) {
        seedError.value = `Could not read this guild's current config: ${errorMessage(err)}`;
      }
      return false;
    } finally {
      seeding.value = false;
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
      channelError.value = errorMessage(err);
    } finally {
      loadingChannels.value = false;
    }
  }

  /** Re-read the guild after a conflict, discarding the wizard's choices. */
  async function reloadLatest(): Promise<boolean> {
    writeError.value = "";
    conflicted.value = false;
    return seedFromExisting();
  }

  /** Write this guild's block. Returns true on success (caller emits). */
  async function write(): Promise<boolean> {
    if (!canWrite.value) {
      writeError.value = seedError.value || "The guild's current config has not been read yet.";
      return false;
    }
    writing.value = true;
    writeError.value = "";
    try {
      await apiSend("PUT", `/api/guilds/${encodeURIComponent(guildId.value)}/config`, {
        baseHash: seedHash,
        guildConfig: buildGuildBlock(existingGuildBlock.value, model.value, defaultServer.value),
      });
      const name = guilds.value.find((g) => g.id === guildId.value)?.name ?? guildId.value;
      toast.add({
        severity: "success",
        summary: "Guild configured",
        detail: `${name} is set up. Written to config.json.`,
        life: 4000,
      });
      return true;
    } catch (err) {
      if (isConflict(err)) {
        conflicted.value = true;
        writeError.value =
          "This guild's config changed while the wizard was open (someone else saved). Reload the latest config to start from it; nothing was written.";
      } else {
        const list = validationErrors(err);
        writeError.value = list.length > 0 ? list.join("\n") : errorMessage(err);
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
    seeding, seedError, seeded, canWrite, conflicted,
    reset, loadGuilds, onGuildPicked, seedFromExisting, loadChannelsRoles, reloadLatest, write,
  };
}
