import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, getServerIds } from './config.js';
import { initServers } from './utils/server.js';
import { initMinecraftCommands } from './logWatcher/initMinecraftCommands.js';
import { log } from './utils/logger.js';
import type { BotCommand } from './types/index.js';

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
    else if (file.endsWith('.js') && file !== 'middleware.js') files.push(full);
  }
  return files;
}

async function loadCommands(): Promise<void> {
  const files = getCommandFiles(path.join(__dirname, 'commands'));
  for (const file of files) {
    try {
      const cmd = (await import(path.resolve(file))) as Partial<BotCommand>;
      if (!cmd.data || !cmd.execute) continue;
      const name = cmd.data.name;
      const enabled = config.commands?.[name]?.enabled ?? true;
      if (!enabled) {
        log.info('commands', `Skipping disabled: /${name}`);
        continue;
      }
      commands.set(name, cmd as BotCommand);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('commands', `Failed to load ${file}: ${msg}`);
    }
  }
}

async function registerGlobalCommands(): Promise<void> {
  const commandData = commands.map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    log.info('commands', 'Registering global slash commands...');
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commandData,
    });
    log.info('commands', `${commandData.length} slash commands registered.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('commands', `Failed to register: ${msg}`);
  }
}

// ── Main ──

(async () => {
  await loadCommands();
  await registerGlobalCommands();

  // Attach commands to client for help command access
  (client as unknown as { commands: Collection<string, BotCommand> }).commands = commands;

  client.once('ready', async () => {
    log.info('bot', `Ready as ${client.user!.tag}`);
    log.info('bot', `Servers: ${getServerIds().join(', ')}`);
    log.info('bot', `Guilds: ${client.guilds.cache.size}`);

    try {
      await initMinecraftCommands(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('init', `Failed to initialize MC commands: ${msg}`);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    // ── Autocomplete ──
    if (interaction.isAutocomplete()) {
      const autocomplete = interaction as AutocompleteInteraction;
      const focused = autocomplete.options.getFocused(true);

      // Server autocomplete
      if (focused.name === 'server') {
        const ids = getServerIds().filter((id) =>
          id.startsWith(String(focused.value).toLowerCase()),
        );
        await autocomplete.respond(
          ids.slice(0, 25).map((id) => ({ name: id, value: id })),
        );
        return;
      }

      // Player name autocomplete
      if (['player', 'player1', 'player2'].includes(focused.name)) {
        try {
          const { getPlayerNames } = await import('./utils/playerUtils.js');
          const names = await getPlayerNames();
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

    if (!interaction.isChatInputCommand()) return;

    const chatInteraction = interaction as ChatInputCommandInteraction;
    const command = commands.get(chatInteraction.commandName);
    if (!command) return;

    try {
      await command.execute(chatInteraction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('command', `/${chatInteraction.commandName}: ${msg}`);
      const errorMsg = {
        content: '❌ An error occurred.',
        flags: MessageFlags.Ephemeral as number,
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
