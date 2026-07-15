import { defineCommand } from "../../defineCommand.js";
import { confirmLinkCode } from "@mcbot/core/utils/stores/linkUtils.js";
import { syncLinkedRole } from "../../../utils/guild/linkedRole.js";
import { log } from "@mcbot/core/utils/logger.js";

// Rate-limit per-player !link attempts to prevent brute-forcing codes.
// Tracks the timestamp of the last attempt per Minecraft username.
const linkAttempts = new Map<string, number>();
const LINK_ATTEMPT_COOLDOWN_MS = 3_000;

const cmd = defineCommand({
  name: "link",
  description: "Link your Minecraft account to Discord using a code",
  args: ["code"],
  handler: async (username, { code }, client) => {
    if (!code) return;

    // Rate-limit: reject if the same player tried within the cooldown window
    const lastAttempt = linkAttempts.get(username) ?? 0;
    if (Date.now() - lastAttempt < LINK_ATTEMPT_COOLDOWN_MS) return;
    linkAttempts.set(username, Date.now());

    // The whole validate + ownership-check + link + confirm sequence is
    // one SQLite transaction — the old module-level codes/linked mirror
    // (with its saving/pendingSave machinery and its staleness against
    // /link writes from the other flow) is gone.
    const result = await confirmLinkCode(code, username).catch(
      (err: unknown) => {
        log.error(
          "link",
          `Link store error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      },
    );
    if (!result || result.status === "unknown-code") return;

    const user = client.users.cache.get(result.discordId);

    if (result.status === "expired") {
      if (user)
        user.send(`❌ Link code **${code}** has expired.`).catch(() => {});
      return;
    }

    if (result.status === "name-taken") {
      log.warn(
        "link",
        `Rejected link of ${username}: already linked to another Discord account`,
      );
      if (user)
        user
          .send(
            `❌ **${username}** is already linked to a different Discord account. Ask an admin to unlink it first if this is your account.`,
          )
          .catch(() => {});
      return;
    }

    // Auto-role on link (guilds.<id>.linkedRole). syncLinkedRole never
    // throws — role failures are audited and must not fail the link.
    await syncLinkedRole(client, result.discordId, "add");
    if (user)
      user.send(`✅ Linked to Minecraft user **${username}**.`).catch(() => {});
  },
});

export const { init, COMMAND_INFO, handler } = cmd;

/**
 * Reset all in-memory state. Only for use in tests.
 */
export function _resetStateForTesting(): void {
  linkAttempts.clear();
}
