import path from "path";
import { fileURLToPath } from "url";
import { defineCommand } from "../../defineCommand.js";
import { getCommandFiles, importCommandModule } from "../../../utils/commands/loadCommandFiles.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import type { InGameCommandInfo } from "@mcbot/core/types/index.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";

const commandsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

interface ListedCommand {
  name: string;
  info: InGameCommandInfo;
}

let listed: Promise<ListedCommand[]> | null = null;

async function loadAllCommandInfo(): Promise<ListedCommand[]> {
  const commands: ListedCommand[] = [];
  for (const file of getCommandFiles(commandsDir)) {
    const name = path.basename(file).replace(/\.[cm]?[jt]s$/, "");
    if (name === "commands") continue;
    try {
      const mod = (await importCommandModule(file)) as {
        COMMAND_INFO?: InGameCommandInfo;
      };
      if (mod.COMMAND_INFO) commands.push({ name, info: mod.COMMAND_INFO });
    } catch {
      /* a command that fails to load is skipped, as at startup */
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

const cmd = defineCommand({
  name: "commands",
  aliases: ["help", "cmds", "commandlist"],
  description: "List all available in-game commands",
  cooldown: 5,
  handler: async (username, _args, _client, server) => {
    listed ??= loadAllCommandInfo();
    const commands = (await listed).filter(
      (c) => resolveCommandPolicy(c.name, { serverId: server.id }).enabled,
    );
    await whisper(server, username, t("ingame.commands.header"));
    for (const c of commands) {
      await whisper(server, username, t("ingame.commands.entry", { command: c.info.command, description: c.info.description }));
    }
  },
});

export const { init, COMMAND_INFO } = cmd;
