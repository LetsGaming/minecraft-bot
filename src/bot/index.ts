import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getServerIds, watchConfig } from "@mcbot/core/config.js";
import { startRuntimeHeartbeat } from "@mcbot/core/utils/server/runtimeHeartbeat.js";
import { verifyWrapperContract } from "@mcbot/core/utils/server/serverAccess.js";
import { consumeToken, cooldownSeconds } from "@mcbot/core/utils/rateLimiter.js";
import {
  resolveCommandPolicy,
  commandEnabledAnywhere,
} from "@mcbot/core/utils/commands/commandPolicy.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { recordCommandUsage } from "@mcbot/core/utils/commands/commandUsage.js";
import { registerManifestCommands } from "@mcbot/core/utils/commands/commandManifest.js";
import {
  discoverModules,
  manifestOf,
  assertCommandsLoaded,
} from "./utils/commands/loadCommandFiles.js";
import { errorContentOf, replyDenied, replyError } from "./commands/middleware.js";
import { isInvokerAdmin } from "./utils/guild/permissions.js";
import { dispatchAutocomplete } from "./utils/autocomplete.js";
import { applyConfig, markStartupConfigApplied } from "./utils/applyConfig.js";
import { initServers, getAllInstances } from "@mcbot/core/utils/server/server.js";
import { closeDb, getDb } from "@mcbot/core/db/index.js";
import { runRewardsMigration } from "@mcbot/core/rewardsMigration.js";
import {
  capabilityCommandSkips,
  capabilitySummary,
} from "@mcbot/core/utils/server/capabilities.js";
import { migrateLegacySnapshots } from "@mcbot/core/utils/minecraft/snapshotUtils.js";
import { initMinecraftCommands } from "./logWatcher/initMinecraftCommands.js";
import { currentVersion } from "./logWatcher/watchers/monitors/updateNotifier.js";
import { log } from "@mcbot/core/utils/logger.js";
import { invalidateStatusChannelCache } from "./logWatcher/watchers/schedulers/statusEmbed.js";
import { handleWhitelistApplicationInteraction } from "./interactions/whitelistApplications.js";
import { handleFollowUpHintInteraction } from "./interactions/followUpHints.js";
import { handleRelayInteraction } from "./interactions/relayNotice.js";
import { handleConfirmInteraction } from "./interactions/confirmActions.js";
import type { BotCommand, BotClient } from "@mcbot/core/types/index.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { installProcessGuards } from "./processGuards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

// MCBOT_DEV_NO_DISCORD=1 skips the Discord gateway login and global command
// registration (both need a real bot token and application), so everything
// else (config and DB loading, capability probing, log watchers, RCON) can
// run in an isolated dev session. Slash commands, interactions and channel
// posts do not work in this mode. Only scripts/dev-up.mjs sets it.
const DEV_NO_DISCORD = process.env.MCBOT_DEV_NO_DISCORD === "1";

initServers(config.servers);
// Open the SQLite store early: schema migrations and the one-time legacy
// JSON import run here, before any command can touch a store.
getDb();
// Reward files from before entry ids and exceptions are upgraded here; a file
// that cannot be proven equal is left alone and still read correctly.
await runRewardsMigration();

// Probe which setup-suite artifacts each server provides. The result
// gates command registration below and per-invocation checks in the
// suite-dependent commands; probe failures leave `capabilities` null, which
// every gate treats as fully capable (legacy behaviour).
for (const inst of getAllInstances()) {
  try {
    const cap = await inst.probeCapabilities();
    log.info("capabilities", `${inst.id}: ${capabilitySummary(cap)}`);
  } catch (err) {
    log.warn("capabilities", `Probe failed for ${inst.id}: ${errMsg(err)}`);
  }
}

// Remote instances: report once, per instance, where this bot and the
// wrapper disagree about what exists. A missing feature otherwise only
// shows up as a command quietly doing nothing.
await Promise.all(
  getAllInstances().map((inst) =>
    verifyWrapperContract(inst.config, currentVersion()),
  ),
);

// Heartbeat file for the (optional) dashboard process: a fresh
// data/runtime.json means "bot alive", stale means banner in the UI.
markStartupConfigApplied(config);
startRuntimeHeartbeat(currentVersion());

// Move legacy loose snapshot files into the first server's directory
// so existing baselines survive the per-server snapshot layout change.
const firstServerId = Object.keys(config.servers)[0];
if (firstServerId) {
  migrateLegacySnapshots(firstServerId).catch((err) => {
    log.warn("snapshots", `Legacy snapshot migration failed: ${errMsg(err)}`);
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // discord.js's Client has no typed `commands` map; BotClient adds it and we
  // populate it immediately below, so branding the freshly-made client here is
  // the intended one-time widening (see the BotClient interface).
}) as BotClient;

// Re-cache automatically when config.json is edited on disk. Server
// additions and removals are reconciled live. A reload that lands before
// the client is ready cannot be applied yet (watchers are not wired); it is
// remembered and applied once at ready.
let reloadMissedBeforeReady = false;

function applyConfigReload(fresh: ReturnType<typeof loadConfig>): void {
  applyConfig(client, fresh).catch((err: unknown) => {
    log.error("config", `Reconciliation after reload failed: ${errMsg(err)}`);
  });
  void refreshSlashCommands();
}

watchConfig((fresh) => {
  if (!client.isReady()) {
    reloadMissedBeforeReady = true;
    return;
  }
  applyConfigReload(fresh);
});

/** The slash commands currently registered with Discord, by name. */
const commands = new Collection<string, BotCommand>();

/** Every slash command module found on disk, whether currently registered or not. */
const knownCommands = new Map<
  string,
  { cmd: BotCommand; capabilitySkip: string | undefined }
>();

/**
 * Make `commands` match the live config: a command enabled somewhere is
 * registered, one disabled everywhere is dropped. Returns whether the set
 * changed.
 */
function syncCommands(): boolean {
  let changed = false;
  for (const [name, { cmd, capabilitySkip }] of knownCommands) {
    const wanted = !capabilitySkip && commandEnabledAnywhere(name);
    if (wanted && !commands.has(name)) {
      commands.set(name, cmd);
      changed = true;
    } else if (!wanted && commands.has(name)) {
      commands.delete(name);
      changed = true;
    }
  }
  return changed;
}

async function refreshSlashCommands(): Promise<void> {
  if (!syncCommands() || DEV_NO_DISCORD) return;
  log.info("commands", "Command enablement changed, re-registering slash commands");
  await registerGlobalCommands();
}

async function loadCommands(): Promise<void> {
  // Skip registering suite-dependent commands when NO configured
  // server provides the capability ("/server" stays registered, see
  // capabilityCommandSkips for why).
  const capabilitySkips = capabilityCommandSkips(getAllInstances());

  const commandsRoot = path.join(__dirname, "commands");
  const modules = await discoverModules<BotCommand>(
    commandsRoot,
    "slash",
    (mod) => {
      // Command modules are loaded dynamically, so their shape isn't known at
      // compile time: validate the required members (data + execute).
      const cmd = mod as Partial<BotCommand>;
      if (!cmd.data || !cmd.execute) return null;
      return {
        name: cmd.data.name,
        description: cmd.data.description ?? "",
        value: cmd as BotCommand,
      };
    },
  );
  assertCommandsLoaded(modules.length, commandsRoot);

  for (const { name, value } of modules) {
    const skipReason = capabilitySkips.get(name);
    knownCommands.set(name, { cmd: value, capabilitySkip: skipReason });
    // Only a command disabled in EVERY scope (global + all guild
    // overrides) is skipped entirely; anything else stays registered
    // and is gated per guild at dispatch time.
    if (!commandEnabledAnywhere(name)) {
      log.info("commands", `Skipping disabled: /${name}`);
    } else if (skipReason) {
      log.info("commands", `Skipping /${name}: ${skipReason} (see docs/admin/setup.md)`);
    }
  }
  syncCommands();

  // Dashboard manifest: the web process cannot discover commands itself. It
  // lists disabled commands too, so they can be re-enabled from the UI.
  registerManifestCommands("slash", manifestOf(modules));
}

async function registerGlobalCommands(): Promise<void> {
  const commandData = commands.map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.token);
  try {
    log.info("commands", "Registering global slash commands...");
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commandData,
    });
    log.info("commands", `${commandData.length} slash commands registered.`);
  } catch (err) {
    log.error("commands", `Failed to register: ${errMsg(err)}`);
  }
}

// ── Interaction routing ──

/**
 * Components with stable customIds, routed before the slash-command path so
 * their buttons survive restarts (no collectors). The first handler that
 * claims an interaction ends routing; one that throws also ends it.
 */
const COMPONENT_HANDLERS: ReadonlyArray<{
  tag: string;
  handle: (interaction: Interaction) => Promise<boolean>;
}> = [
  { tag: "wlapp", handle: handleWhitelistApplicationInteraction },
  { tag: "hint", handle: handleFollowUpHintInteraction },
  { tag: "relay", handle: handleRelayInteraction },
  { tag: "confirm", handle: handleConfirmInteraction },
];

/** True when a component handler took the interaction (or failed on it). */
async function routeComponent(interaction: Interaction): Promise<boolean> {
  for (const { tag, handle } of COMPONENT_HANDLERS) {
    try {
      if (await handle(interaction)) return true;
    } catch (err) {
      log.error(tag, `Interaction failed: ${errMsg(err)}`);
      return true;
    }
  }
  return false;
}

async function dispatchSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = commands.get(interaction.commandName);
  if (!command) return;
  const guildId = interaction.guild?.id;

  // Effective per-command policy for THIS guild (guild override, then
  // global block, then defaults), resolved at dispatch time so config
  // reloads and dashboard edits apply without a restart. `adminOnly`
  // uses the same check as requireServerAdmin; built-in admin
  // commands additionally keep their own wrapper regardless.
  const policy = resolveCommandPolicy(interaction.commandName, { guildId });
  if (!policy.enabled) {
    await interaction.reply({
      content: t("command.disabledHere", { command: interaction.commandName }, guildId),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (policy.adminOnly && !isInvokerAdmin(interaction)) {
    await replyDenied(interaction);
    return;
  }

  let succeeded = false;
  try {
    // Per-user rate limit: prevents RCON pool exhaustion from command spam
    if (!consumeToken(interaction.user.id)) {
      await interaction.reply({
        content: t(
          "common.rateLimited",
          { seconds: cooldownSeconds(interaction.user.id) },
          guildId,
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await runWithGuildLocale(guildId, () => command.execute(interaction));
    succeeded = true;
  } catch (err) {
    log.error("command", `/${interaction.commandName}: ${errMsg(err)}`);
    await runWithGuildLocale(guildId, () =>
      replyError(interaction, errorContentOf(err)),
    );
  }

  // Recorded here, for EVERY command, rather than inside an optional wrapper:
  // not every command wraps its execute in withErrorHandling, so a wrapper
  // would leave those uncounted. A failed invocation does not count, and a
  // failure to record never changes the reply the user already got.
  if (!succeeded) return;
  try {
    recordCommandUsage({
      command: interaction.commandName,
      surface: "slash",
      userId: interaction.user.id,
      guildId: guildId ?? null,
    });
  } catch (err) {
    log.warn("command", `Usage not recorded for /${interaction.commandName}: ${errMsg(err)}`);
  }
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    await dispatchAutocomplete(interaction, commands.get(interaction.commandName));
    return;
  }
  if (
    (interaction.isButton() || interaction.isModalSubmit()) &&
    (await routeComponent(interaction))
  ) {
    return;
  }
  if (interaction.isChatInputCommand()) await dispatchSlash(interaction);
}

// ── Main ──

void (async () => {
  try {
    await loadCommands();
  } catch (err) {
    log.error("commands", `Startup aborted: ${errMsg(err)}`);
    process.exit(1);
  }
  if (!DEV_NO_DISCORD) await registerGlobalCommands();

  // Attach commands to client for help command access
  client.commands = commands;

  client.once("clientReady", async () => {
    log.info("bot", `Ready as ${client.user!.tag}`);
    log.info("bot", `Servers: ${getServerIds().join(", ")}`);
    log.info("bot", `Guilds: ${client.guilds.cache.size}`);

    try {
      await initMinecraftCommands(client);
    } catch (err) {
      log.error("init", `Failed to initialize MC commands: ${errMsg(err)}`);
    }

    if (reloadMissedBeforeReady) {
      reloadMissedBeforeReady = false;
      applyConfigReload(loadConfig());
    }
  });

  // Invalidate the statusEmbed channel ref cache after every Discord
  // reconnect so stale TextChannel/VoiceChannel objects are not reused.
  client.on("shardResume", () => invalidateStatusChannelCache());

  // An async listener's rejection is not caught by discord.js, and the
  // process guard exits on any unhandled rejection. One slow autocomplete (an
  // expired interaction makes respond() throw) must not take the bot down,
  // so every rejection ends here.
  client.on("interactionCreate", (interaction) =>
    handleInteraction(interaction).catch((err: unknown) => {
      log.error("interaction", `Unhandled interaction failure: ${errMsg(err)}`);
    }),
  );

  if (DEV_NO_DISCORD) {
    log.warn(
      "bot",
      "MCBOT_DEV_NO_DISCORD=1: skipping Discord gateway login (dev only). " +
        "Slash commands, interactions, and Discord messages are unavailable " +
        "this run; running the clientReady init anyway so log watchers / " +
        "RCON / server monitoring can still be exercised.",
    );
    try {
      await initMinecraftCommands(client);
    } catch (err) {
      log.error("init", `Failed to initialize MC commands: ${errMsg(err)}`);
    }
  } else {
    await client.login(config.token);
  }
})();

// ── Graceful shutdown ──

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("bot", `Received ${signal}, shutting down`);
  try {
    await client.destroy();
  } catch (err) {
    log.warn("bot", `Discord client did not close cleanly: ${errMsg(err)}`);
  }
  closeDb();
  process.exit(0);
}

installProcessGuards(async () => closeDb());

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});
process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});
