import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  type InteractionReplyOptions,
} from "discord.js";
import { readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getServerIds, watchConfig } from "@mcbot/core/config.js";
import { summarizeConfigChanges } from "@mcbot/core/utils/config/configDiff.js";
import { consumeToken, cooldownSeconds } from "@mcbot/core/utils/rateLimiter.js";
import {
  resolveCommandPolicy,
  commandEnabledAnywhere,
} from "@mcbot/core/utils/commands/commandPolicy.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { registerManifestCommands } from "@mcbot/core/utils/commands/commandManifest.js";

/** Slash commands discovered at load, for the dashboard manifest. */
const manifestSlash: Array<{ name: string; description: string }> = [];
import {
  isServerAdmin,
  getMemberRoleIds,
} from "./commands/middleware.js";
import { initServers, getAllInstances } from "@mcbot/core/utils/server/server.js";
import { getDb } from "@mcbot/core/db/index.js";
import {
  capabilityCommandSkips,
  capabilitySummary,
} from "@mcbot/core/utils/server/capabilities.js";
import { migrateLegacySnapshots } from "@mcbot/core/utils/minecraft/snapshotUtils.js";
import { tryResolveServer } from "./utils/guild/guildRouter.js";
import {
  initMinecraftCommands,
  reconcileServers,
} from "./logWatcher/initMinecraftCommands.js";
import { log } from "@mcbot/core/utils/logger.js";
import { flushUptimeHistory } from "@mcbot/core/utils/stores/uptimeTracker.js";
import { invalidateStatusChannelCache } from "./logWatcher/watchers/schedulers/statusEmbed.js";
import type { BotCommand, BotClient } from "@mcbot/core/types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

// Initialize all server instances
initServers(config.servers);
// Open the SQLite store early: schema migrations and the one-time legacy
// JSON import run here, before any command can touch a store.
getDb();

// Probe which setup-suite artifacts each server provides. The result
// gates command registration below and per-invocation checks in the
// suite-dependent commands; probe failures leave `capabilities` null, which
// every gate treats as fully capable (legacy behaviour).
for (const inst of getAllInstances()) {
  try {
    const cap = await inst.probeCapabilities();
    log.info("capabilities", `${inst.id}: ${capabilitySummary(cap)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("capabilities", `Probe failed for ${inst.id}: ${msg}`);
  }
}

// Remote instances: report once, per instance, where this bot and the
// wrapper disagree about what exists — a missing feature otherwise only
// shows up as a command quietly doing nothing.
{
  const { verifyWrapperContract } = await import("@mcbot/core/utils/server/serverAccess.js");
  const { currentVersion } = await import("./logWatcher/watchers/monitors/updateNotifier.js");
  const botVersion = currentVersion();
  await Promise.all(
    getAllInstances().map((inst) =>
      verifyWrapperContract(inst.config, botVersion),
    ),
  );
}

// Heartbeat file for the (optional) dashboard process: a fresh
// data/runtime.json means "bot alive", stale means banner in the UI.
{
  const { startRuntimeHeartbeat } = await import("@mcbot/core/utils/server/runtimeHeartbeat.js");
  const { currentVersion } = await import(
    "./logWatcher/watchers/monitors/updateNotifier.js"
  );
  startRuntimeHeartbeat(currentVersion());
}

// Move legacy loose snapshot files into the first server's directory
// so existing baselines survive the per-server snapshot layout change.
const firstServerId = Object.keys(config.servers)[0];
if (firstServerId) {
  migrateLegacySnapshots(firstServerId).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("snapshots", `Legacy snapshot migration failed: ${msg}`);
  });
}

// Create client with intents for chat bridge
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

// Re-cache automatically when config.json is edited on disk.
// Server additions/removals are reconciled live — instances and
// watchers are created for added IDs and torn down for removed ones.
// Before the client is ready, watchers can't be wired yet; startup reads
// the fresh config anyway, so skipping is correct rather than lossy.
let lastSeenConfig = config;
watchConfig((fresh) => {
  if (!client.isReady()) return;
  const settingChanges = summarizeConfigChanges(lastSeenConfig, fresh);
  lastSeenConfig = fresh;
  for (const change of settingChanges) {
    log.info("config", `Reload: ${change}`);
  }
  reconcileServers(client, fresh)
    .then(({ added, removed, changed }) => {
      if (added.length > 0 || removed.length > 0 || changed.length > 0) {
        log.info(
          "config",
          `Reload applied — added: [${added.join(", ")}], removed: [${removed.join(", ")}]` +
            (changed.length > 0
              ? `; changed (restart required): [${changed.join(", ")}]`
              : ""),
        );
      }
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("config", `Reconciliation after reload failed: ${msg}`);
    });
});

/**
 * We store commands on the client instance for runtime access.
 * discord.js does not ship a typed `commands` property,
 * so we extend via a Collection on the prototype-less object.
 */
const commands = new Collection<string, BotCommand>();

// ── Load commands ──

function getCommandFiles(dir: string): string[] {
  let files: string[] = [];
  for (const file of readdirSync(dir)) {
    const full = path.join(dir, file);
    if (statSync(full).isDirectory())
      files = files.concat(getCommandFiles(full));
    else if (file.endsWith(".js") && file !== "middleware.js") files.push(full);
  }
  return files;
}

async function loadCommands(): Promise<void> {
  // Skip registering suite-dependent commands when NO configured
  // server provides the capability ("/server" stays registered — see
  // capabilityCommandSkips for why).
  const capabilitySkips = capabilityCommandSkips(getAllInstances());

  const files = getCommandFiles(path.join(__dirname, "commands"));
  for (const file of files) {
    try {
      // Command modules are loaded dynamically, so their shape isn't known at
      // compile time: import as Partial<BotCommand> and validate the required
      // members (data + execute) below before the module is used.
      const cmd = (await import(path.resolve(file))) as Partial<BotCommand>;
      if (!cmd.data || !cmd.execute) continue;
      const name = cmd.data.name;
      // Collect for the dashboard manifest BEFORE any skip, so disabled
      // commands can still be re-enabled from the UI.
      manifestSlash.push({
        name,
        description: cmd.data.description ?? "",
      });
      // Only a command disabled in EVERY scope (global + all guild
      // overrides) is skipped entirely; anything else stays registered
      // and is gated per guild at dispatch time.
      if (!commandEnabledAnywhere(name)) {
        log.info("commands", `Skipping disabled: /${name}`);
        continue;
      }
      const skipReason = capabilitySkips.get(name);
      if (skipReason) {
        log.info(
          "commands",
          `Skipping /${name}: ${skipReason} (see docs/admin/setup.md)`,
        );
        continue;
      }
      // data + execute were verified present above, so it's a complete command.
      commands.set(name, cmd as BotCommand);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("commands", `Failed to load ${file}: ${msg}`);
    }
  }

  // Dashboard manifest: the web process cannot discover commands itself.
  registerManifestCommands("slash", manifestSlash);
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
    const msg = err instanceof Error ? err.message : String(err);
    log.error("commands", `Failed to register: ${msg}`);
  }
}

// ── Main ──

void (async () => {
  await loadCommands();
  await registerGlobalCommands();

  // Attach commands to client for help command access
  client.commands = commands;

  client.once("clientReady", async () => {
    log.info("bot", `Ready as ${client.user!.tag}`);
    log.info("bot", `Servers: ${getServerIds().join(", ")}`);
    log.info("bot", `Guilds: ${client.guilds.cache.size}`);

    try {
      await initMinecraftCommands(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("init", `Failed to initialize MC commands: ${msg}`);
    }
  });

  // Invalidate the statusEmbed channel ref cache after every Discord
  // reconnect so stale TextChannel/VoiceChannel objects are not reused.
  client.on("shardResume", () => invalidateStatusChannelCache());

  client.on("interactionCreate", async (interaction) => {
    // ── Autocomplete ──
    if (interaction.isAutocomplete()) {
      const autocomplete = interaction;
      const focused = autocomplete.options.getFocused(true);

      // Server autocomplete
      if (focused.name === "server") {
        // In multi-guild deployments, only suggest servers this
        // guild may target — no cross-tenant server-ID disclosure.
        const { getAllowedServerIds } = await import(
          "./utils/guild/guildRouter.js"
        );
        const allowed = getAllowedServerIds(autocomplete.guild?.id ?? undefined);
        const ids = getServerIds().filter(
          (id) =>
            (!allowed || allowed.has(id)) &&
            id.startsWith(String(focused.value).toLowerCase()),
        );
        await autocomplete.respond(
          ids.slice(0, 25).map((id) => ({ name: id, value: id })),
        );
        return;
      }

      // Player name autocomplete
      if (["player", "player1", "player2"].includes(focused.name)) {
        try {
          const { getPlayerNames } = await import("@mcbot/core/utils/minecraft/playerUtils.js");
          const server = tryResolveServer(autocomplete);
          const names = server ? await getPlayerNames(server) : [];
          const filtered = names.filter((n) =>
            n.toLowerCase().startsWith(String(focused.value).toLowerCase()),
          );
          await autocomplete.respond(
            filtered.slice(0, 25).map((n) => ({ name: n, value: n })),
          );
        } catch {
          await autocomplete.respond([]);
        }
        return;
      }

      await autocomplete.respond([]);
      return;
    }

    // Whitelist-application buttons + modal use stable customIds so
    // they survive restarts (no collectors). Routed before the
    // slash-command path; a handled interaction ends here.
    if (interaction.isButton() || interaction.isModalSubmit()) {
      try {
        const { handleWhitelistApplicationInteraction } = await import(
          "./interactions/whitelistApplications.js"
        );
        if (await handleWhitelistApplicationInteraction(interaction)) return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("wlapp", `Interaction failed: ${msg}`);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const chatInteraction = interaction;
    const command = commands.get(chatInteraction.commandName);
    if (!command) return;

    // Effective per-command policy for THIS guild (guild override →
    // global block → defaults), resolved at dispatch time so config
    // reloads and dashboard edits apply without a restart. `adminOnly`
    // uses the same check as requireServerAdmin; built-in admin
    // commands additionally keep their own wrapper regardless.
    const policy = resolveCommandPolicy(chatInteraction.commandName, {
      guildId: chatInteraction.guild?.id,
    });
    if (!policy.enabled) {
      await chatInteraction.reply({
        content: t(
          "command.disabledHere",
          { command: chatInteraction.commandName },
          chatInteraction.guild?.id,
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (policy.adminOnly) {
      const allowed = isServerAdmin(
        chatInteraction.user.id,
        getMemberRoleIds(chatInteraction),
        chatInteraction.guild?.id,
      );
      if (!allowed) {
        await chatInteraction.reply({
          content: "You do not have permission to use this command.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      // Per-user rate limit: prevents RCON pool exhaustion from command spam
      if (!consumeToken(chatInteraction.user.id)) {
        const secs = cooldownSeconds(chatInteraction.user.id);
        await chatInteraction.reply({
          content: `Too many commands. Please wait ${secs}s.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await command.execute(chatInteraction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("command", `/${chatInteraction.commandName}: ${msg}`);
      const errorMsg: InteractionReplyOptions = {
        content: "❌ An error occurred.",
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (chatInteraction.replied || chatInteraction.deferred)
          await chatInteraction.followUp(errorMsg);
        else await chatInteraction.reply(errorMsg);
      } catch {
        /* expired */
      }
    }
  });

  await client.login(config.token);
})();

// ── Graceful shutdown ──────────────────────────────────────────────────────
// Flush the uptime tracker before the process exits so no polling data is lost.

async function shutdown(signal: string): Promise<void> {
  log.info(
    "bot",
    `Received ${signal} — flushing uptime history and shutting down`,
  );
  try {
    await flushUptimeHistory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("bot", `Failed to flush uptime history on shutdown: ${msg}`);
  }
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});
process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});
