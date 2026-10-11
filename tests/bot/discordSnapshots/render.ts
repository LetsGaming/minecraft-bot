/**
 * Turns what the bot hands to discord.js into plain JSON for the Discord
 * snapshot fixtures under tests/fixtures/discord-snapshots/. Colours become
 * hex strings and button styles their names, so a fixture reads like the
 * mockup it is compared with (docs/dev/discord-replies.md).
 */
import path from "node:path";
import { ButtonStyle, MessageFlags } from "discord.js";

export const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/discord-snapshots");

/** Fixed clock for every snapshot: 2026-10-10 14:36 UTC. */
export const NOW = Date.UTC(2026, 9, 10, 14, 36, 0);

export const LANGUAGES = ["en", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Guild ids whose configured language is the suffix. */
export const GUILD: Record<Language, string> = { en: "g-en", de: "g-de" };

/** The config every snapshot file mocks `loadConfig` with. */
export const SNAPSHOT_CONFIG = {
  language: "en",
  adminUsers: ["admin-1"],
  guilds: {
    "g-en": { language: "en" },
    "g-de": { language: "de" },
  },
};

interface Jsonable {
  toJSON(): unknown;
}

function json(value: unknown): Record<string, unknown> {
  const raw =
    value && typeof (value as Jsonable).toJSON === "function"
      ? (value as Jsonable).toJSON()
      : value;
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
}

function hex(color: unknown): string | undefined {
  return typeof color === "number" ? `#${color.toString(16).padStart(6, "0")}` : undefined;
}

export function renderEmbed(embed: unknown): Record<string, unknown> {
  const e = json(embed);
  const out: Record<string, unknown> = {};
  if (e.color !== undefined) out.color = hex(e.color);
  for (const key of ["author", "title", "description", "fields", "footer", "thumbnail"]) {
    if (e[key] !== undefined) out[key] = e[key];
  }
  if (e.timestamp !== undefined) out.timestamp = e.timestamp;
  return out;
}

export function renderRow(row: unknown): Array<Record<string, unknown>> {
  const r = json(row) as { components?: Array<Record<string, unknown>> };
  return (r.components ?? []).map((c) => ({
    label: c.label,
    style: ButtonStyle[c.style as number],
    disabled: c.disabled === true,
    ...(c.custom_id !== undefined ? { customId: c.custom_id } : {}),
  }));
}

/** One message as sent: where it went, who sees it, and what it shows. */
export function renderMessage(via: string, payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as {
    content?: string;
    embeds?: unknown[];
    components?: unknown[];
    flags?: number;
    allowedMentions?: unknown;
  };
  const out: Record<string, unknown> = { via };
  if (p.flags !== undefined) {
    out.ephemeral = (p.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
  }
  if (p.content !== undefined) out.content = p.content;
  if (p.allowedMentions !== undefined) out.allowedMentions = p.allowedMentions;
  if (p.embeds) out.embeds = p.embeds.map(renderEmbed);
  if (p.components) out.components = p.components.map(renderRow);
  return out;
}

export function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, `${name}.json`);
}

export function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * A slash command interaction that records every reply call in order.
 * `admin` decides whether the invoker is in `SNAPSHOT_CONFIG.adminUsers`.
 */
export function recordingInteraction(
  language: Language,
  {
    commandName = "status",
    subcommand = null,
    admin = true,
  }: { commandName?: string; subcommand?: string | null; admin?: boolean } = {},
) {
  const sent: Array<Record<string, unknown>> = [];
  const interaction = {
    id: "interaction-1",
    commandName,
    user: {
      id: admin ? "admin-1" : "player-1",
      tag: admin ? "domenic" : "nils_builds",
      username: admin ? "domenic" : "nils_builds",
      displayName: admin ? "domenic" : "nils_builds",
    },
    member: null,
    guild: { id: GUILD[language] },
    guildId: GUILD[language],
    channelId: "channel-1",
    deferred: false,
    replied: false,
    ephemeral: false as boolean | null,
    client: { ws: { ping: 42 } },
    isChatInputCommand: () => true,
    isButton: () => false,
    options: {
      getString: () => null,
      getInteger: () => null,
      getBoolean: () => null,
      getUser: () => null,
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => null,
    },
    async deferReply(opts?: { flags?: number }) {
      interaction.deferred = true;
      interaction.ephemeral = ((opts?.flags ?? 0) & MessageFlags.Ephemeral) !== 0;
      sent.push({ via: "deferReply", ephemeral: interaction.ephemeral });
    },
    async reply(payload: unknown) {
      interaction.replied = true;
      sent.push(renderMessage("reply", payload));
      return { id: "reply-1" };
    },
    async editReply(payload: unknown) {
      sent.push(renderMessage("editReply", payload));
      return { id: "reply-1", createMessageComponentCollector: () => ({ on: () => undefined }) };
    },
    async followUp(payload: unknown) {
      sent.push(renderMessage("followUp", payload));
      return { id: "followup-1" };
    },
    async deleteReply() {
      sent.push({ via: "deleteReply" });
    },
  };
  return { interaction, sent };
}
