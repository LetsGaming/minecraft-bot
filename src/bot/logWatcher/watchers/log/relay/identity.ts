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

/**
 * `S***`: the first code point of a display name and a fixed mask. Works on
 * code points so emoji and non-Latin names are not cut in half, strips control
 * and format characters first, and drops trailing `[..]` or `(..)` so a name
 * cannot imitate a source label.
 */
export function censorName(displayName: string): string {
  let name = stripControlChars(displayName).trim();
  for (let previous = ""; previous !== name; ) {
    previous = name;
    name = name.replace(TRAILING_BRACKETS, "").trim();
  }
  const first = [...name][0] ?? "?";
  return `${first}${MASK}`;
}

/** Four hex characters from an HMAC over the user id; stable, and meaningless outside the group. */
export function relayTag(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, TAG_LENGTH);
}

/**
 * The name a speaker goes by in a relay group: the Minecraft name when they
 * linked an account, otherwise a censored display name and a stable tag. Never
 * contains the Discord id.
 */
export async function relayName(userId: string, displayName: string, group: string): Promise<string> {
  const linked = await getLinkedAccount(userId);
  if (linked) return linked;
  return `${censorName(displayName)}#${relayTag(userId, relayGroupSecret(group))}`;
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
