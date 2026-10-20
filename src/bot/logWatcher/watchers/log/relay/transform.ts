import { stripControlChars } from "@mcbot/core/utils/sanitize.js";

/** Discord's message length limit. */
export const RELAY_MAX_LENGTH = 2000;

export interface RelayInput {
  content: string;
  /** Content types of the attached files; `null` when Discord gave none. */
  attachments: readonly (string | null | undefined)[];
  stickers: number;
  isReply: boolean;
}

const REWRITES: readonly (readonly [RegExp, string])[] = [
  [/<a?:(\w{1,64}):\d+>/g, ":$1:"],
  [/<@&\d+>/g, "@role"],
  [/<@!?\d+>/g, "@user"],
  [/<#\d+>/g, "#channel"],
  [/<t:-?\d+(?::[a-zA-Z])?>/g, "[time]"],
  [/https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\S+/gi, "[link]"],
  [/(?:https?:\/\/)?(?:www\.)?discord(?:app)?\.(?:gg|com\/invite)\/\S+/gi, "[invite]"],
  [/@(everyone|here)/gi, "$1"],
];

/**
 * The text that crosses to another Discord server. Mentions, emoji, Discord
 * links and invites become plain words, attachments and stickers become short
 * placeholders, a reply is marked but never quoted, and nothing is kept that
 * identifies the Discord account. Null when nothing is left to send.
 *
 * Role and user mentions are not resolved to names: a mentioned member never
 * agreed to appear in another community.
 */
export function transformRelayContent(input: RelayInput): string | null {
  let text = stripControlChars(input.content.replace(/\r?\n/g, " "));
  for (const [pattern, replacement] of REWRITES) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();

  const placeholders = [
    ...input.attachments.map((type) => (type?.startsWith("image/") ? "[image]" : "[file]")),
    ...Array.from({ length: input.stickers }, () => "[sticker]"),
  ];
  const parts = [text, ...placeholders].filter(Boolean);
  if (parts.length === 0) return null;

  const body = [input.isReply ? "(reply)" : "", ...parts].filter(Boolean).join(" ");
  return [...body].slice(0, RELAY_MAX_LENGTH).join("");
}
