import { Client, Collection, GatewayIntentBits } from "discord.js";
import { readdirSync, statSync } from "fs";
import path from "path";
import config from "./config.json"

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

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
  const commandFiles = getCommandFiles("./commands");

  for (const file of commandFiles) {
    // Use absolute path for import
    const command = await import(path.resolve(file));
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(
        `Skipping file ${file} - missing 'data' or 'execute' export.`
      );
    }
  }
}

(async () => {
  await loadCommands();

  client.once("ready", () => {
    console.log(`Bot is ready as ${client.user.tag}`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "❌ Error executing command.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "❌ Error executing command.",
          ephemeral: true,
        });
      }
    }
  });

  client.login(config.token);
})();
