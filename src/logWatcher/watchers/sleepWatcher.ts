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
  { title: "okay ciao.", subtitle: "log dich aus. das bett ist schon online." },
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
  {
    title: "game over.",
    subtitle: "für heute reicht's. träumen ist das bessere dlc.",
  },
  {
    title: "low battery.",
    subtitle: "dein fokus ist auf 1%. ab an die ladestation.",
  },
  {
    title: "nachtschicht beendet.",
    subtitle: "%TRIGGER% hat feierabend gemacht. du jetzt auch.",
  },
  {
    title: "offline-modus.",
    subtitle: "deine augen brauchen ein update. dauert ca. 8 stunden.",
  },
  {
    title: "ende gelände.",
    subtitle: "wer jetzt noch wach ist, hat die kontrolle verloren.",
  },
];

const TITLES_NORMAL: TitlePair[] = [
  {
    title: "Schlafenszeit.",
    subtitle: "%TRIGGER% hat's angestossen. Jetzt weisst du Bescheid.",
  },
  {
    title: "Log dich aus.",
    subtitle: "Das hier laeuft morgen noch. Du brauchst Schlaf.",
  },
  { title: "Geh schlafen.", subtitle: "Kein Drama. Einfach Bett." },
  {
    title: "Okay, Ciao.",
    subtitle: "%TRIGGER% hat gesprochen. Das Bett wartet schon.",
  },
  {
    title: "Touch Grass. Oder Kissen.",
    subtitle: "Schlafen ist kein Bug. Ist ein Feature.",
  },
  {
    title: "Ruhemodus aktiviert.",
    subtitle: "Dein Körper braucht einen Neustart. Geh schlafen.",
  },
  {
    title: "Morgen ist auch noch ein Tag.",
    subtitle: "%TRIGGER% hat den Lead übernommen und schläft schon.",
  },
  {
    title: "Zeit für die Horizontale.",
    subtitle: "Sogar die beste Hardware braucht mal eine Pause.",
  },
  {
    title: "Abflug ins Traumland.",
    subtitle: "Keine Ausreden mehr. Klappe zu, Augen zu.",
  },
  {
    title: "System-Check: Müde.",
    subtitle: "%TRIGGER% empfiehlt: Matratzenhorchdienst antreten.",
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
    subtitle: "%TRIGGER% SCHLAEFT SCHON. NUR DU NICHT. CLASSIC.",
  },
  {
    title: "BRO???",
    subtitle: "DU SCHLAEFST NOCH NICHT?! WHAT IS WRONG WITH YOU.",
  },
  {
    title: "KEIN WIDERSPRUCH.",
    subtitle: "%TRIGGER% HAT GESPROCHEN. INS BETT. JETZT. WIRKLICH.",
  },
  {
    title: "ABFAHRT!!!",
    subtitle: "DER SCHLAFZUG VERLÄSST DEN BAHNHOF. LETZTER AUFRUF.",
  },
  {
    title: "REICHT JETZT!",
    subtitle: "DU SIEHST AUS WIE EIN ZOMBIE. GEH SCHLAFEN.",
  },
  {
    title: "BETT. SOFORT.",
    subtitle: "WENN %TRIGGER% GEHT, GEHST DU AUCH. DISZIPLIN!",
  },
  {
    title: "NOTFALL-STOPP!",
    subtitle: "DEIN GEHIRN HAT SCHON LÄNGST DEN GEIST AUFGEGEBEN.",
  },
  {
    title: "GO TO SLEEP!!!",
    subtitle: "KEINE WEITEREN FRAGEN. KEINE WEITEREN KICKS. BETT.",
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

// ── Night check ───────────────────────────────────────────────────────────────

// Minecraft daytime ticks: 0 = 6:00, 6000 = 12:00, 12542 = sunset, 23459 = sunrise
const NIGHT_START = 12542;
const NIGHT_END = 23459;

/**
 * Returns true if the server is currently night time.
 * `/time query daytime` returns e.g. "The time is 13000"
 * Falls back to true (allow) when the output is unreadable (screen fallback,
 * broken RCON) so a bad connection doesn't silently suppress all prompts.
 */
async function isNight(server: ServerInstance): Promise<boolean> {
  try {
    const output = await server.sendCommand("/time query daytime");
    if (!output) return true; // screen fallback – can't read output, allow
    const match = output.match(/\d+/);
    if (!match) return true;
    const tick = parseInt(match[0], 10);
    // Night wraps around midnight: ticks >= NIGHT_START OR <= NIGHT_END
    return tick >= NIGHT_START || tick <= NIGHT_END;
  } catch {
    return true;
  }
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

      if (!(await isNight(server))) {
        log.info("sleepWatcher", "Daytime – skipping sleep prompt.");
        return;
      }

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
