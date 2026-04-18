import { type Client } from "discord.js";
import { log } from "../../utils/logger.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { ServerInstance } from "../../utils/server.js";

// Matches in-game chat: [timestamp] [server thread/INFO]: <PlayerName> Liege wie
// Captures (1) the player name, (2) the raw message text
const SLEEP_TRIGGER_REGEX = /\[.+?\].*: <(?:\[AFK\]\s*)?([^>]+)>\s+(.*)/;

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
// %TRIGGER% = name of the player who wrote the message
// Title = shown large in screen centre, Subtitle = smaller line below

interface TitlePair {
  title: string;
  subtitle: string;
}

const TITLES_LOWER: TitlePair[] = [
  {
    title: "schlafenszeit.",
    subtitle: "%TRIGGER% hat's gesagt. du weißt was zu tun ist.",
  },
  {
    title: "okay ciao.",
    subtitle: "log dich aus. das bett ist schon online.",
  },
  {
    title: "skill issue.",
    subtitle: "nicht schlafen wollen ist halt auch nen skill issue.",
  },
  {
    title: "bett. jetzt.",
    subtitle: "%TRIGGER% ist schon weg – nur du stehst noch rum.",
  },
  {
    title: "zzz...",
    subtitle: "der server läuft durch. du solltest das nicht.",
  },
];

const TITLES_NORMAL: TitlePair[] = [
  {
    title: "Schlafenszeit.",
    subtitle: "%TRIGGER% hat's angestoßen. Jetzt weißt du Bescheid.",
  },
  {
    title: "Log dich aus.",
    subtitle: "Das hier läuft morgen noch. Du brauchst Schlaf.",
  },
  {
    title: "Geh schlafen.",
    subtitle: "Kein Drama. Einfach Bett.",
  },
  {
    title: "Okay, Ciao.",
    subtitle: "%TRIGGER% hat gesprochen. Das Bett wartet schon.",
  },
  {
    title: "Touch Grass. Oder Kissen.",
    subtitle: "Schlafen ist kein Bug. Ist ein Feature.",
  },
];

const TITLES_ALLCAPS: TitlePair[] = [
  {
    title: "BRO. SCHLAFEN.",
    subtitle: "%TRIGGER% HAT'S GESAGT. WAS WILLST DU NOCH HÖREN.",
  },
  {
    title: "LOG DICH AUS!!!",
    subtitle: "DAS BETT WARTET. WIR WARTEN. ALLE WARTEN.",
  },
  {
    title: "SKILL ISSUE!!!",
    subtitle: "%TRIGGER% SCHLÄFT SCHON. NUR DU NICHT. CLASSIC.",
  },
  {
    title: "BRO???",
    subtitle: "DU SCHLÄFST NOCH NICHT?! WHAT IS WRONG WITH YOU.",
  },
  {
    title: "KEIN WIDERSPRUCH.",
    subtitle: "%TRIGGER% HAT GESPROCHEN. INS BETT. JETZT. WIRKLICH.",
  },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function buildTitlePair(capsMode: CapsMode, trigger: string): TitlePair {
  const pool =
    capsMode === "allcaps"
      ? TITLES_ALLCAPS
      : capsMode === "lower"
        ? TITLES_LOWER
        : TITLES_NORMAL;

  const { title, subtitle } = pickRandom(pool);
  return {
    title: title.replace(/%TRIGGER%/g, trigger),
    subtitle: subtitle.replace(/%TRIGGER%/g, trigger),
  };
}

// ── Title sender ──────────────────────────────────────────────────────────────

/**
 * Sends a /title to every non-sleeping player via the NBT selector
 * `nbt={SleepTimer:0s}`, which matches players whose SleepTimer is 0
 * (i.e. awake). Excludes the trigger player with `name=!<trigger>`.
 *
 * Falls back to targeting all online players (`@a`) if the server
 * does not support NBT selectors (e.g. Bedrock / Paper with NBT disabled).
 */
async function sendTitleToAwake(
  server: ServerInstance,
  triggerPlayer: string,
  pair: TitlePair,
): Promise<void> {
  // Target: all awake players except the one who triggered the message.
  // SleepTimer:0s  → not in bed / not sleeping
  const selector = `@a[nbt={SleepTimer:0s},name=!${triggerPlayer}]`;

  const titleJson = JSON.stringify({ text: pair.title });
  const subtitleJson = JSON.stringify({ text: pair.subtitle });

  await server.sendCommand(`/title ${selector} title ${titleJson}`);
  await server.sendCommand(`/title ${selector} subtitle ${subtitleJson}`);
}

// ── Watcher registration ──────────────────────────────────────────────────────

export function registerSleepWatcher(logWatcher: ILogWatcher): void {
  logWatcher.register(
    SLEEP_TRIGGER_REGEX,
    async (match, _client: Client, server: ServerInstance) => {
      const [, triggerPlayer, rawMessage] = match;
      if (!triggerPlayer || !rawMessage) return;

      const capsMode = isSleepTrigger(rawMessage);
      if (capsMode === null) return;

      log.info(
        "sleepWatcher",
        `${triggerPlayer} triggered sleep prompt (${capsMode})`,
      );

      const pair = buildTitlePair(capsMode, triggerPlayer);

      try {
        await sendTitleToAwake(server, triggerPlayer, pair);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("sleepWatcher", `Failed to send title: ${msg}`);
      }
    },
  );
}
