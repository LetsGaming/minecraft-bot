// ── Discord command types ─────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface BotCommand {
  data:
    | SlashCommandBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">
    | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * Extended Discord.js Client with a commands collection.
 * discord.js does not ship a typed `commands` property,
 * so we extend the base Client with our own.
 */
export interface BotClient extends Client {
  commands: Map<string, BotCommand>;
}

// ── In-game command system ────────────────────────────────────────────────────

export interface InGameCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  args?: string[];
  cooldown?: number;
  handler: (
    username: string,
    args: Record<string, string>,
    client: Client,
    server: import("../utils/server.js").ServerInstance,
  ) => Promise<void>;
}

export interface InGameCommandInfo {
  command: string;
  description: string;
}

export interface InGameCommandResult {
  init: () => void;
  COMMAND_INFO: InGameCommandInfo;
  handler: (
    username: string,
    args: Record<string, string>,
    client: Client,
    server: import("../utils/server.js").ServerInstance,
  ) => Promise<void>;
}
