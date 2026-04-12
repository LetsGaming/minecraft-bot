import {
  Client, Collection, GatewayIntentBits, REST, Routes, MessageFlags,
} from "discord.js";
import { readdirSync, statSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getServerIds } from "./config.js";
import { initServers } from "./utils/server.js";
import { initMinecraftCommands } from "./logWatcher/initMinecraftCommands.js";
import { log } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

// Initialize all server instances
initServers(config.servers);

// Create client with intents for chat bridge
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
client.commands = new Collection();

// ── Load commands ──

function getCommandFiles(dir) {
  let files = [];
  for (const file of readdirSync(dir)) {
    const full = path.join(dir, file);
    if (statSync(full).isDirectory()) files = files.concat(getCommandFiles(full));
    else if (file.endsWith(".js") && file !== "middleware.js") files.push(full);
  }
  return files;
}

async function loadCommands() {
  const files = getCommandFiles(path.join(__dirname, "commands"));
  for (const file of files) {
    try {
      const cmd = await import(path.resolve(file));
      if (!cmd.data || !cmd.execute) continue;
      const enabled = config.commands?.[cmd.data.name]?.enabled ?? true;
      if (!enabled) { log.info("commands", `Skipping disabled: /${cmd.data.name}`); continue; }
      client.commands.set(cmd.data.name, cmd);
    } catch (err) {
      log.error("commands", `Failed to load ${file}: ${err.message}`);
    }
  }
}

async function registerGlobalCommands() {
  const commands = client.commands.map(cmd => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.token);
  try {
    log.info("commands", "Registering global slash commands...");
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    log.info("commands", `${commands.length} slash commands registered.`);
  } catch (err) {
    log.error("commands", `Failed to register: ${err.message}`);
  }
}

// ── Main ──

(async () => {
  await loadCommands();
  await registerGlobalCommands();

  client.once("ready", async () => {
    log.info("bot", `Ready as ${client.user.tag}`);
    log.info("bot", `Servers: ${getServerIds().join(", ")}`);
    log.info("bot", `Guilds: ${client.guilds.cache.size}`);

    try {
      await initMinecraftCommands(client);
    } catch (err) {
      log.error("init", `Failed to initialize MC commands: ${err.message}`);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    // ── Autocomplete ──
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);

      // Server autocomplete
      if (focused.name === "server") {
        const ids = getServerIds().filter(id => id.startsWith(focused.value.toLowerCase()));
        return interaction.respond(ids.slice(0, 25).map(id => ({ name: id, value: id })));
      }

      // Player name autocomplete
      if (["player", "player1", "player2"].includes(focused.name)) {
        try {
          const { getPlayerNames } = await import("./utils/playerUtils.js");
          const names = await getPlayerNames();
          const filtered = names.filter(n => n.toLowerCase().startsWith(focused.value.toLowerCase()));
          return interaction.respond(filtered.slice(0, 25).map(n => ({ name: n, value: n })));
        } catch { return interaction.respond([]); }
      }

      return interaction.respond([]);
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      log.error("command", `/${interaction.commandName}: ${err.message}`);
      const msg = { content: "❌ An error occurred.", flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch { /* expired */ }
    }
  });

  await client.login(config.token);
})();
