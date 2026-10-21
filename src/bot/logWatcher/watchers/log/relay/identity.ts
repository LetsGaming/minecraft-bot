import { createHmac } from "node:crypto";
import { stripControlChars } from "@mcbot/core/utils/sanitize.js";
import { getLinkedAccount } from "@mcbot/core/utils/stores/linkStore.js";
import { relayGroupSecret } from "@mcbot/core/utils/stores/relaySecretStore.js";

/** Discord's webhook username limit. */
const USERNAME_MAX = 80;
const LABEL_MAX = 24;
/** Fixed length, so the real name's length does not leak. */
const MASK = "***";
const TAG_LENGTH = 4;
const TRAILING_BRACKETS = /\s*[[(][^\])]*[\])]\s*$/u;
const LEADING_BRACKETS = /^\s*[[(][^\])]*[\])]\s*/u;
/** What a name may start with: a letter, a digit or an emoji, never a bracket or other punctuation. */
const NAME_START = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/**
 * `S***`: the first letter, digit or emoji of a display name and a fixed
 * mask. Works on code points so emoji and non-Latin names are not cut in half,
 * strips control and format characters first, and drops leading and trailing
 * `[..]` or `(..)` groups so a tag such as `[AK] Steve` or a suffix cannot
 * stand in for the name or imitate a source label. A name that is nothing but
 * a bracketed group uses the first letter inside it.
 */
export function censorName(displayName: string): string {
  const original = stripControlChars(displayName).trim();
  let name = original;
  for (let previous = ""; previous !== name; ) {
    previous = name;
    name = name.replace(TRAILING_BRACKETS, "").replace(LEADING_BRACKETS, "").trim();
  }
  const source = [...(name || original)];
  const first = source.find((ch) => NAME_START.test(ch)) ?? source[0] ?? "?";
  return `${first}${MASK}`;
}

/** Four hex characters from an HMAC over the user id; stable, and meaningless outside the group. */
export function relayTag(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, TAG_LENGTH);
}

export interface RelaySpeaker {
  name: string;
  /** True when `name` is the speaker's linked Minecraft name, so their head can stand in for an avatar. */
  linked: boolean;
}

/**
 * Who a speaker is in a relay group: the Minecraft name when they linked an
 * account, otherwise a censored display name and a stable tag. Never contains
 * the Discord id.
 */
export async function relaySpeaker(userId: string, displayName: string, group: string): Promise<RelaySpeaker> {
  const linked = await getLinkedAccount(userId);
  if (linked) return { name: linked, linked: true };
  return { name: `${censorName(displayName)}#${relayTag(userId, relayGroupSecret(group))}`, linked: false };
}

/** A guild's label as shown after the name: no control characters or brackets, at most 24 characters. */
export function cleanLabel(label: string): string {
  const cleaned = [...stripControlChars(label).replace(/[[\]()]/g, "").trim()].slice(0, LABEL_MAX).join("");
  return cleaned || "?";
}

/** `<name> [<label>]`, cut to Discord's 80 characters by shortening the name, never the label. */
export function webhookUsername(name: string, label: string): string {
  const suffix = ` [${cleanLabel(label)}]`;
  const room = Math.max(1, USERNAME_MAX - [...suffix].length);
  return `${[...name].slice(0, room).join("")}${suffix}`;
}
