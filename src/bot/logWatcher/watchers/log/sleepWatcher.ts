import { log } from "@mcbot/core/utils/logger.js";
import type { ILogWatcher } from "../../logWatcher.js";
import { wasAccepted } from "@mcbot/schema/commandOutcome.js";
import { MS } from "@mcbot/schema";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { consoleCommand } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { onServerRemoved } from "../../serverCleanup.js";
import { runDetached } from "../sendQueue.js";
import { chatLineRegex } from "./chatLine.js";

// Matches in-game chat: [timestamp] [server thread/INFO]: <PlayerName> Liege wie
// Captures (1) the player name, (2) the raw message text. Anchored on the
// speaker: see chatLine.ts.
const SLEEP_TRIGGER_REGEX = chatLineRegex(String.raw`\s+(.*)`);

// ── Cooldown ──────────────────────────────────────────────────────────────────

/** Cooldown in milliseconds between sleep prompts (per server). */
const COOLDOWN_MS = 10 * MS.second;

/** Timestamp of the last fired sleep prompt, per server id. */
const lastTriggerTime = new Map<string, number>();

/** Servers with a prompt check running, so a second trigger cannot overlap it. */
const inFlight = new Set<string>();

onServerRemoved((serverId) => {
  lastTriggerTime.delete(serverId);
  inFlight.delete(serverId);
});

function isOnCooldown(serverId: string): boolean {
  const last = lastTriggerTime.get(serverId);
  if (last === undefined) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function markTriggered(serverId: string): void {
  lastTriggerTime.set(serverId, Date.now());
}

// ── Sleeping check ────────────────────────────────────────────────────────────

/**
 * Whether the player is in bed (SleepTimer > 0). `null` means the server
 * could not be reached; a server with no reply channel, or a reply with no
 * timer in it, reads as not sleeping.
 */
async function isPlayerSleeping(
  server: ServerInstance,
  player: string,
): Promise<boolean | null> {
  const outcome = await server.send(
    consoleCommand("/data", { text: "get entity" }, { player }, { text: "SleepTimer" }),
  );
  if (outcome.kind === "unreachable") return null;
  if (outcome.kind === "sent") return false;
  return parseSleepTimer(outcome.output) > 0;
}

/**
 * Reads `... has the following entity data: 87s`. Anchored on the value after
 * the colon so digits followed by `s` inside a player name (`xX_99s_Xx`) are
 * not read as the timer.
 */
export function parseSleepTimer(output: string): number {
  const match = output.match(/:\s*(\d+)s\s*$/);
  return match ? parseInt(match[1]!, 10) : 0;
}

// ── Caps detection ────────────────────────────────────────────────────────────

type CapsMode = "lower" | "normal" | "allcaps";

function detectCaps(text: string): CapsMode {
  if (text === text.toUpperCase()) return "allcaps";
  if (text === text.toLowerCase()) return "lower";
  return "normal";
}

/** Returns the CapsMode when the message is exactly "liege wie", else null. */
function isSleepTrigger(message: string): CapsMode | null {
  if (message.trim().toLowerCase() !== "liege wie") return null;
  return detectCaps(message.trim());
}

// ── Message pools ─────────────────────────────────────────────────────────────
// The texts live in the locale tables as sleep.<mode>.<n>.title/subtitle with
// a {player} placeholder for the player who wrote the message.
// Title = shown large in screen centre, Subtitle = smaller line below.

interface TitlePair {
  title: string;
  subtitle: string;
  /** Minecraft color name for the title. */
  titleColor: string;
  /** Minecraft color name for the subtitle. */
  subtitleColor: string;
}

/** Number of titles per mode in the locale tables. */
const POOL_SIZE = 15;

const POOL_COLORS: Record<CapsMode, { title: string; subtitle: string }> = {
  lower: { title: "gray", subtitle: "dark_gray" },
  normal: { title: "white", subtitle: "yellow" },
  allcaps: { title: "red", subtitle: "gold" },
};

function buildTitlePair(capsMode: CapsMode, player: string): TitlePair {
  const n = 1 + Math.floor(Math.random() * POOL_SIZE);
  const key = `sleep.${capsMode}.${n}`;
  return {
    title: t(`${key}.title`, { player }),
    subtitle: t(`${key}.subtitle`, { player }),
    titleColor: POOL_COLORS[capsMode].title,
    subtitleColor: POOL_COLORS[capsMode].subtitle,
  };
}

// ── Night check ───────────────────────────────────────────────────────────────

// Beds can be used from tick 12542 to 23459 inclusive. The daytime counter
// wraps at 24000, so the window never crosses the wrap.
const NIGHT_START = 12542;
const NIGHT_END = 23459;

export function isNightTick(tick: number): boolean {
  return tick >= NIGHT_START && tick <= NIGHT_END;
}

/**
 * Whether the server is currently night time. `/time query daytime` returns
 * e.g. "The time is 13000". An unreadable answer (no reply channel, an empty
 * reply) reads as night so a server that cannot report the time does not
 * silently suppress every prompt; `null` means the server could not be
 * reached.
 */
async function isNight(server: ServerInstance): Promise<boolean | null> {
  const outcome = await server.send(consoleCommand("/time", { text: "query daytime" }));
  if (outcome.kind === "unreachable") return null;
  if (outcome.kind === "sent") return true;
  const match = outcome.output.match(/\d+/);
  if (!match) return true;
  const tick = parseInt(match[0], 10);
  return isNightTick(tick);
}

// ── Title sender ──────────────────────────────────────────────────────────────

/**
 * Sends a /title to every non-sleeping player via the NBT selector
 * `nbt={SleepTimer:0s}`, which matches players whose SleepTimer is 0
 * (i.e. awake). Excludes the trigger player with `name=!<trigger>`.
 */
async function sendTitleToAwake(
  server: ServerInstance,
  triggerPlayer: string,
  pair: TitlePair,
): Promise<void> {
  const target = `@a[nbt={SleepTimer:0s},name=!${triggerPlayer}]`;

  const titleJson = JSON.stringify({ text: pair.title, color: pair.titleColor });
  const subtitleJson = JSON.stringify({ text: pair.subtitle, color: pair.subtitleColor });

  const title = await server.send(
    consoleCommand("/title", { target }, { text: "title" }, { text: titleJson }),
  );
  if (!wasAccepted(title)) return;
  await server.send(
    consoleCommand("/title", { target }, { text: "subtitle" }, { text: subtitleJson }),
  );
}

// ── Watcher registration ──────────────────────────────────────────────────────

async function runSleepPrompt(
  server: ServerInstance,
  triggerPlayer: string,
  capsMode: CapsMode,
): Promise<void> {
  // Only fire the prompt if the triggering player is actually in bed.
  if ((await isPlayerSleeping(server, triggerPlayer)) !== true) return;

  log.info("sleepWatcher", `${triggerPlayer} triggered sleep prompt (${capsMode})`);

  if ((await isNight(server)) !== true) return;

  markTriggered(server.id);
  await sendTitleToAwake(server, triggerPlayer, buildTitlePair(capsMode, triggerPlayer));
}

export function registerSleepWatcher(logWatcher: ILogWatcher): void {
  // The handler only decides whether to start the check: the server round
  // trips run detached, because log handlers run one at a time and waiting
  // here would stall every other watcher for this server.
  logWatcher.register(SLEEP_TRIGGER_REGEX, (match, _client, server) => {
    const [, triggerPlayer, rawMessage] = match;
    if (!triggerPlayer || !rawMessage) return;

    const capsMode = isSleepTrigger(rawMessage);
    if (capsMode === null) return;

    // The name goes into `/data get entity` and a `name=!…` selector, so
    // it must be a real player name, not a selector or extra arguments.
    if (!isValidMcName(triggerPlayer)) return;

    const serverId = server.id;
    if (isOnCooldown(serverId) || inFlight.has(serverId)) {
      log.info(
        "sleepWatcher",
        `${triggerPlayer} triggered sleep prompt but cooldown is active, skipping.`,
      );
      return;
    }

    inFlight.add(serverId);
    void runDetached("sleepWatcher", "Sleep prompt failed", () =>
      runSleepPrompt(server, triggerPlayer, capsMode).finally(() => {
        inFlight.delete(serverId);
      }),
    );
  });
}
