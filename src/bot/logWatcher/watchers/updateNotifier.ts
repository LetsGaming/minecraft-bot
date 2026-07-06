/**
 * Update notifier — a daily GitHub releases check.
 *
 * Compares the newest release tag of the upstream repo with the running
 * version (package.json), logs when a newer one exists, and optionally
 * DMs the operator-level admins once per discovered version. Enabled by
 * default; `updateNotifier: { enabled: false }` opts out, `dmAdmins`
 * controls the DM half. The last version notified about is persisted so
 * restarts don't re-ping anyone.
 */
import fs from "fs";
import { type Client } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import path from "path";
import { getRootDir } from "@mcbot/core/utils/utils.js";
import { kvGet, kvSet } from "@mcbot/core/db/kv.js";
import { versionAtLeast } from "@mcbot/core/utils/serverAccess.js";
import { log } from "@mcbot/core/utils/logger.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 60_000;
const RELEASES_URL =
  "https://api.github.com/repos/LetsGaming/minecraft-bot/releases/latest";

interface NotifierState {
  lastNotifiedVersion?: string;
}

/** The running bot version, read from package.json next to the data dir. */
export function currentVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(getRootDir(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Latest release tag ("v3.6.0" → "3.6.0"), or null when unreachable. */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    const tag = body.tag_name?.trim();
    return tag ? tag.replace(/^v/i, "") : null;
  } catch {
    return null;
  }
}

async function notifyAdmins(client: Client, latest: string): Promise<void> {
  const admins = loadConfig().adminUsers ?? [];
  for (const id of admins) {
    // Role-based entries can't receive DMs; user IDs are snowflakes.
    if (!/^\d{17,20}$/.test(id)) continue;
    try {
      const user = await client.users.fetch(id);
      await user.send(
        `📦 minecraft-bot ${latest} is available (you run ${currentVersion()}). ` +
          `Release notes: https://github.com/LetsGaming/minecraft-bot/releases`,
      );
    } catch {
      // closed DMs or unknown user — a missed nudge is not an error
    }
  }
}

async function runCheck(client: Client): Promise<void> {
  const cfg = loadConfig().updateNotifier;
  if (cfg?.enabled === false) return;

  const latest = await fetchLatestVersion();
  if (!latest) return;

  const running = currentVersion();
  if (versionAtLeast(running, latest)) return; // up to date (or ahead)

  log.info(
    "update",
    `A newer release is available: ${latest} (running ${running}) — ` +
      `https://github.com/LetsGaming/minecraft-bot/releases`,
  );

  if (cfg?.dmAdmins !== true) return;

  const state = kvGet<NotifierState>("updateNotifier") ?? {};
  if (state.lastNotifiedVersion === latest) return; // already pinged for this one

  await notifyAdmins(client, latest);
  try {
    kvSet("updateNotifier", { lastNotifiedVersion: latest });
  } catch {
    /* re-notifying after a failed save beats losing the nudge */
  }
}

export function startUpdateNotifier(
  client: Client,
): ReturnType<typeof setInterval> | null {
  try {
    if (loadConfig().updateNotifier?.enabled === false) {
      log.info("update", "Update notifier disabled in config");
      return null;
    }
  } catch {
    /* config unavailable — run with defaults */
  }

  const tick = (): void => {
    runCheck(client).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("update", `Release check failed: ${msg}`);
    });
  };

  setTimeout(tick, INITIAL_DELAY_MS);
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  log.info("update", "Update notifier active (daily release check)");
  return timer;
}
