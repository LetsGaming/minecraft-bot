import path from "path";
import { fileURLToPath } from "url";
import { defineCommand } from "../../defineCommand.js";
import { getCommandFiles } from "../../../utils/commands/loadCommandFiles.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import type { InGameCommandInfo } from "@mcbot/core/types/index.js";
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
      const mod = (await import(path.resolve(file))) as {
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
    await whisper(server, username, `Available commands:`);
    for (const c of commands) {
      await whisper(server, username, ` ${c.info.command} - ${c.info.description}`);
    }
  },
});

export const { init, COMMAND_INFO } = cmd;
