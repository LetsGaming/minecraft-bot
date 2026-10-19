import { defineCommand } from "../../defineCommand.js";
import { confirmLinkCode } from "@mcbot/core/utils/stores/linkStore.js";
import { syncLinkedRole } from "../../../utils/guild/linkedRole.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";

const cmd = defineCommand({
  name: "link",
  description: "Link your Minecraft account to Discord using a code",
  args: ["code"],
  // Also the brute-force limit for guessing codes.
  cooldown: 3,
  handler: async (username, { code }, client, server) => {
    if (!code) return;

    // Validate, check ownership, link and confirm in one SQLite transaction.
    const result = await confirmLinkCode(code, username).catch(
      (err: unknown) => {
        log.error(
          "link",
          `Link store error: ${errMsg(err)}`,
        );
        return null;
      },
    );
    if (!result || result.status === "unknown-code") return;

    if (result.status === "already-used") {
      log.warn("link", `Rejected reuse of a link code by ${username}`);
      await whisper(server, username, t("link.codeUsed"));
      return;
    }

    // Fetched rather than read from the cache, which is empty for a user the
    // bot has not seen since it started.
    const user = await client.users.fetch(result.discordId).catch(() => null);
    const dm = (text: string): void => {
      user?.send(text).catch(() => {});
    };

    if (result.status === "expired") {
      dm(t("ingame.link.expired", { code }));
      return;
    }

    if (result.status === "name-taken") {
      log.warn(
        "link",
        `Rejected link of ${username}: already linked to another Discord account`,
      );
      dm(t("ingame.link.nameTaken", { username }));
      return;
    }

    // syncLinkedRole never throws: role failures are audited and must not
    // fail the link.
    await syncLinkedRole(client, result.discordId, "add");
    dm(t("ingame.link.linked", { username }));
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
