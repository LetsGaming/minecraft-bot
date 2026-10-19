// ── Discord command types ─────────────────────────────────────────────────────

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { ServerInstance } from "../utils/server/server.js";

/** Answers a command's autocomplete options. */
export type AutocompleteHandler = (interaction: AutocompleteInteraction) => Promise<void>;

export interface BotCommand {
  data:
    | SlashCommandBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">
    | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  /** Overrides the shared autocomplete for this command's options. */
  autocomplete?: AutocompleteHandler;
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
    args: Record<string, string | undefined>,
    client: Client,
    server: ServerInstance,
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
    args: Record<string, string | undefined>,
    client: Client,
    server: ServerInstance,
  ) => Promise<void>;
}
