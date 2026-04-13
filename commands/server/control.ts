import { SlashCommandBuilder } from "discord.js";
import { spawn } from "child_process";
import { existsSync } from "fs";
import {
  createEmbed,
  createErrorEmbed,
  createSuccessEmbed,
} from "../../utils/embedUtils.js";
import { getServerInstance, getGuildServer } from "../../utils/server.js";
import type { ServerInstance } from "../../utils/server.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { suppressAlerts } from "../../logWatcher/watchers/downtimeMonitor.js";
import { log } from "../../utils/logger.js";
import {
  isSudoPermissionError,
  sudoHelpMessage,
} from "../../shell/execCommand.js";

/**
 * Script paths relative to the scripts directory.
 * Matches the minecraft-server-setup project layout:
 *   {scriptDir}/
 *     start.sh
 *     shutdown.sh
 *     smart_restart.sh
 *     backup/backup.sh
 *     misc/status.sh
 */
const SCRIPT_MAP: Record<string, string> = {
  start: "start.sh",
  stop: "shutdown.sh",
  restart: "smart_restart.sh",
  backup: "backup/backup.sh",
  status: "misc/status.sh",
};

/** Per-subcommand timeouts in ms */
const TIMEOUTS: Record<string, number> = {
  start: 30_000, // systemctl start
  stop: 60_000, // 25s wait + 5s countdown + save + systemctl stop
  restart: 60_000, // 25s wait + 5s countdown + save + systemctl restart
  backup: 300_000, // depends on world size
  status: 15_000, // read-only, fast
};

interface ScriptResult {
  output: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Runs a server script as the configured linux user via `sudo -u`.
 * The linux user is expected to have:
 *   - Ownership of the server files
 *   - Passwordless sudo for systemctl (via sudoers)
 *   - A running screen session for the server
 */
function runServerScript(
  server: ServerInstance,
  scriptRelPath: string,
  args: string[] = [],
  timeoutMs = 120_000,
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const cfg = server.config;
    const scriptDir = cfg.scriptDir;

    if (!scriptDir) {
      return reject(
        new Error(
          "No scriptDir configured for this server.\n" +
            "Set `scriptDir` in config.json or ensure the standard layout exists:\n" +
            "`{serverDir}/../scripts/{instanceName}/`",
        ),
      );
    }

    const scriptPath = `${scriptDir}/${scriptRelPath}`;

    if (!existsSync(scriptPath)) {
      return reject(new Error(`Script not found: ${scriptPath}`));
    }

    const linuxUser = cfg.linuxUser;

    const child = spawn(
      "sudo",
      ["-n", "-u", linuxUser, "bash", scriptPath, ...args],
      {
        cwd: scriptDir,
        env: { ...process.env, HOME: `/home/${linuxUser}` },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          `Script timed out after ${timeoutMs / 1000}s\n\nOutput:\n${stdout.slice(-500)}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (killed) return;
      clearTimeout(timer);

      const combined = stdout + "\n" + stderr;

      // ── Layer 2: script ran but systemctl sudo failed ──
      // The systemctl_cmd wrapper in the shell scripts emits [SUDO ERROR].
      if (/\[SUDO ERROR\]/i.test(combined)) {
        reject(new Error(sudoHelpMessage("systemctl", linuxUser)));
        return;
      }

      // ── Layer 1: the outer sudo -u failed (script never started) ──
      if (isSudoPermissionError(stderr)) {
        reject(new Error(sudoHelpMessage("user-switch", linuxUser)));
        return;
      }

      // Filter remaining sudo noise (harmless sudo info lines)
      stderr = stderr
        .split("\n")
        .filter((l) => !l.includes("[sudo]") && !l.includes("password for"))
        .join("\n")
        .trim();

      resolve({ output: stdout.trim(), stderr, exitCode: code });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start script: ${err.message}`));
    });
  });
}

export const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Server control commands")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start the Minecraft server")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("stop")
      .setDescription("Stop the server (30s countdown)")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("restart")
      .setDescription("Restart the server (30s countdown)")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("backup")
      .setDescription("Create a server backup")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      )
      .addBooleanOption((o) =>
        o
          .setName("archive")
          .setDescription("Create an archive backup instead of hourly"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Get detailed server status via script")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  );

const LABELS: Record<string, { verb: string; emoji: string; past: string }> = {
  start: { verb: "Starting", emoji: "🟢", past: "started" },
  stop: { verb: "Stopping", emoji: "🔴", past: "stopped" },
  restart: { verb: "Restarting", emoji: "🔄", past: "restarted" },
  backup: { verb: "Backing up", emoji: "💾", past: "backup complete" },
  status: { verb: "Checking", emoji: "ℹ️", past: "status retrieved" },
};

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const serverId = interaction.options.getString("server");
    const server = serverId
      ? getServerInstance(serverId)
      : getGuildServer(interaction.guild?.id);

    if (!server) throw new Error("Server not found.");

    const scriptName = SCRIPT_MAP[sub];
    if (!scriptName) throw new Error(`Unknown subcommand: ${sub}`);

    log.info("control", `${interaction.user.tag} → /${sub} on ${server.id}`);

    // Suppress downtime alerts for intentional stop/restart
    if (sub === "stop" || sub === "restart") {
      suppressAlerts(server.id);
    }

    // Status is read-only and fast — no progress embed needed
    if (sub === "status") {
      const result = await runServerScript(
        server,
        scriptName,
        [],
        TIMEOUTS[sub]!,
      );
      const embed = createEmbed({
        title: `Server Status — ${server.id}`,
        description: `\`\`\`\n${result.output || "No output"}\n\`\`\``,
      });
      return void (await interaction.editReply({ embeds: [embed] }));
    }

    // Mutating commands: show progress, then run
    const label = LABELS[sub]!;
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: `${label.emoji} ${label.verb} — ${server.id}`,
          description:
            sub === "start"
              ? "Executing start script..."
              : "This may take up to 40 seconds (countdown + save)...",
          color: 0xffaa00,
        }),
      ],
    });

    // Build args
    const args: string[] = [];
    if (sub === "backup" && interaction.options.getBoolean("archive")) {
      args.push("--archive");
    }

    const result = await runServerScript(
      server,
      scriptName,
      args,
      TIMEOUTS[sub]!,
    );

    if (result.exitCode !== 0) {
      const errMsg =
        result.stderr || result.output || `Exited with code ${result.exitCode}`;
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            `**${sub}** failed on **${server.id}**\n\`\`\`\n${errMsg.slice(0, 1000)}\n\`\`\``,
          ),
        ],
      });
      return;
    }

    const successEmbed = createSuccessEmbed(`**${server.id}** — ${label.past}`);

    if (result.output && result.output.length > 0 && sub !== "start") {
      const output =
        result.output.length > 1000
          ? result.output.slice(-1000) + "..."
          : result.output;
      successEmbed.setDescription(
        `**${server.id}** — ${label.past}\n\`\`\`\n${output}\n\`\`\``,
      );
    }

    await interaction.editReply({ embeds: [successEmbed] });
  }),
);
