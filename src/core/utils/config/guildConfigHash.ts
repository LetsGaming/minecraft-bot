import { createHash } from "crypto";
import { stableStringify } from "./stableStringify.js";

/**
 * Concurrency token for one guild's config block: a digest of the block's
 * content alone, independent of key order and of every other part of
 * config.json. Editing guild A therefore never conflicts with a save to guild
 * B or to a server entry.
 */
export function guildConfigHash(block: unknown): string {
  return createHash("sha256")
    .update(stableStringify(block ?? {}))
    .digest("hex");
}
