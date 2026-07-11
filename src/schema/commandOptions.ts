/**
 * Per-command configurable options.
 *
 * A command override (commands.<name>.options) can carry command-specific
 * settings — e.g. /map's web URL. This registry declares which commands expose
 * which options, and their type/label, so the dashboard's Commands tab can
 * render a proper input for each instead of a free-form JSON blob. It's the
 * one source of truth for both the bot (reading a value) and the UI (editing
 * it); adding a new command option is a single entry here.
 */

export interface CommandOptionSpec {
  /** The key under commands.<name>.options. */
  key: string;
  type: "string" | "number" | "boolean";
  /** Human label shown in the dashboard. */
  label: string;
  /** Optional input placeholder / one-line help. */
  placeholder?: string;
  help?: string;
}

export const COMMAND_OPTIONS: Record<string, CommandOptionSpec[]> = {
  map: [
    {
      key: "url",
      type: "string",
      label: "Map URL",
      placeholder: "https://map.example.com",
      help: "The web map link the /map command replies with.",
    },
  ],
};

/** The option specs for a command (empty if it has none). */
export function commandOptionSpecs(command: string): CommandOptionSpec[] {
  return COMMAND_OPTIONS[command] ?? [];
}
