import { Client, Collection, GatewayIntentBits } from "discord.js";
import { readdirSync } from "fs";
const config = require("./config.json");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandFiles = readdirSync("./commands").filter((file) =>
  file.endsWith(".js")
);
for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

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
