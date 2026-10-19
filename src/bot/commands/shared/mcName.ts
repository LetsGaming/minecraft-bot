import type { ChatInputCommandInteraction } from "discord.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import {
  consoleCommand,
  ConsoleArgumentError,
  type ConsoleArg,
} from "@mcbot/core/utils/minecraft/serverMessages.js";

/** Trims and validates a Minecraft name; throws the user-facing error when it is not one. */
export function assertMcName(raw: string): string {
  const name = raw.trim();
  if (!isValidMcName(name)) {
    throw new Error(t("common.invalidUsername", { username: name }));
  }
  return name;
}

/** The required string option `option` as a validated Minecraft name. */
export function requireMcName(
  interaction: Pick<ChatInputCommandInteraction, "options">,
  option: string,
): string {
  return assertMcName(interaction.options.getString(option, true));
}

/** Builds a console command about `player`; an argument the console would refuse becomes the friendly invalid-name error. */
export function playerConsoleCommand(player: string, verb: string, ...args: ConsoleArg[]): string {
  try {
    return consoleCommand(verb, ...args);
  } catch (err) {
    if (err instanceof ConsoleArgumentError) {
      throw new Error(t("common.invalidUsername", { username: player }));
    }
    throw err;
  }
}
