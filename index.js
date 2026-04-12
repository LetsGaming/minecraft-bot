import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
} from "discord.js";
import { readdirSync, statSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initMinecraftCommands } from "./logWatcher/initMinecraftCommands.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config
const config = JSON.parse(readFileSync(path.resolve(__dirname, "config.json"), "utf-8"));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// ── Load commands ──

function getCommandFiles(dir) {
  let files = [];
  for (const file of readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      files = files.concat(getCommandFiles(fullPath));
    } else if (file.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function loadCommands() {
  const commandFiles = getCommandFiles(path.join(__dirname, "commands"));

  for (const file of commandFiles) {
    const command = await import(path.resolve(file));

    if (!command.data || !command.execute) {
      console.warn(`Skipping ${file} — missing data or execute.`);
      continue;
    }

    const enabled = config.commands?.[command.data.name]?.enabled ?? true;
    if (!enabled) {
      console.log(`⏭ Skipping disabled slash command: ${command.data.name}`);
      continue;
    }

    client.commands.set(command.data.name, command);
  }
}

async function registerGlobalCommands() {
  const commands = client.commands.map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.token);

  try {
    console.log("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`✅ ${commands.length} slash commands registered.\n`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}

// ── Main ──

(async () => {
  await loadCommands();
  await registerGlobalCommands();

  client.once("ready", async () => {
    console.log(`Bot ready as ${client.user.tag}\n`);

    try {
      await initMinecraftCommands(client);
    } catch (err) {
      console.error("❌ Failed to initialize in-game commands:", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    // ── Autocomplete handler for player names ──
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (["player", "player1", "player2"].includes(focused.name)) {
        try {
          const { getPlayerNames } = await import("./utils/playerUtils.js");
          const names = await getPlayerNames();
          const filtered = names
            .filter(n => n.toLowerCase().startsWith(focused.value.toLowerCase()))
            .slice(0, 25);
          await interaction.respond(filtered.map(n => ({ name: n, value: n })));
        } catch {
          await interaction.respond([]);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const errorMsg = {
        content: "❌ There was an error executing this command.",
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg);
      } else {
        await interaction.reply(errorMsg);
      }
    }
  });

  await client.login(config.token);
})();
