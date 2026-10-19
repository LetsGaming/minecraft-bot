/**
 * Autocomplete for slash commands.
 *
 * A command module may export `autocomplete` to answer its own options;
 * without one, the shared completers below answer the conventional option
 * names. The dispatcher in `index.ts` knows neither.
 */
import type { AutocompleteInteraction } from "discord.js";
import { getServerIds } from "@mcbot/core/config.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { getPlayerNames } from "@mcbot/core/utils/minecraft/playerUtils.js";
import type { AutocompleteHandler } from "@mcbot/core/types/index.js";
import { filterTargetableServerIds, tryResolveServer } from "./guild/guildRouter.js";
import { ALL_SERVERS_OPTION } from "./guild/serverOptions.js";

/** Discord shows at most this many choices. */
const MAX_CHOICES = 25;

export interface Choice {
  name: string;
  value: string;
}

/** Suggestions for one option, given the text typed so far (lowercased). */
export type OptionCompleter = (
  interaction: AutocompleteInteraction,
  typed: string,
) => Choice[] | Promise<Choice[]>;

/**
 * The servers the issuing guild may target (an operator sees all of them,
 * as in resolveServer). `includeAll` adds the "every server" choice that
 * overview commands accept.
 */
export function serverCompleter({ includeAll = false } = {}): OptionCompleter {
  return (interaction, typed) => {
    const ids = filterTargetableServerIds(interaction, getServerIds()).filter((id) =>
      id.startsWith(typed),
    );
    const choices = ids.map((id) => ({ name: id, value: id }));
    if (includeAll && ALL_SERVERS_OPTION.startsWith(typed)) {
      choices.unshift({
        name: t("autocomplete.allOverview", {}, interaction.guild?.id),
        value: ALL_SERVERS_OPTION,
      });
    }
    return choices;
  };
}

/** Known player names of the server the interaction resolves to. */
export const playerCompleter: OptionCompleter = async (interaction, typed) => {
  const server = tryResolveServer(interaction);
  const names = server ? await getPlayerNames(server) : [];
  return names
    .filter((name) => name.toLowerCase().startsWith(typed))
    .map((name) => ({ name, value: name }));
};

/**
 * An autocomplete handler that answers the options named in `completers`
 * and offers nothing for any other. A failing completer answers with no
 * choices: an expired interaction or an unreachable server must not surface
 * as an error.
 */
export function optionAutocomplete(
  completers: Readonly<Record<string, OptionCompleter>>,
): AutocompleteHandler {
  return async (interaction) => {
    const focused = interaction.options.getFocused(true);
    const completer = Object.hasOwn(completers, focused.name)
      ? completers[focused.name]
      : undefined;
    let choices: Choice[] = [];
    if (completer) {
      try {
        choices = await completer(interaction, String(focused.value).toLowerCase());
      } catch {
        choices = [];
      }
    }
    await interaction.respond(choices.slice(0, MAX_CHOICES)).catch(() => {});
  };
}

/** What commands without their own `autocomplete` get. */
export const defaultAutocomplete: AutocompleteHandler = optionAutocomplete({
  server: serverCompleter(),
  player: playerCompleter,
  player1: playerCompleter,
  player2: playerCompleter,
});

/** Answer an autocomplete interaction with the command's own handler or the default. */
export async function dispatchAutocomplete(
  interaction: AutocompleteInteraction,
  command: { autocomplete?: AutocompleteHandler } | undefined,
): Promise<void> {
  await (command?.autocomplete ?? defaultAutocomplete)(interaction);
}
