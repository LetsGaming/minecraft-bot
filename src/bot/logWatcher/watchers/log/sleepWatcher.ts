import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ILogWatcher } from "../../logWatcher.js";
import { wasAccepted } from "@mcbot/schema/commandOutcome.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { chatLineRegex } from "./chatLine.js";

// Matches in-game chat: [timestamp] [server thread/INFO]: <PlayerName> Liege wie
// Captures (1) the player name, (2) the raw message text. Anchored on the
// speaker (AUD-002): see chatLine.ts.
const SLEEP_TRIGGER_REGEX = chatLineRegex(String.raw`\s+(.*)`);

// ── Cooldown ──────────────────────────────────────────────────────────────────

/** Cooldown in milliseconds between sleep prompts (per server). */
const COOLDOWN_MS = 10_000; // 10 seconds

/**
 * Keyed by server identity string (server.id or similar).
 * Stores the timestamp of the last fired sleep prompt.
 */
const lastTriggerTime = new Map<string, number>();

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
  const outcome = await server.send(`/data get entity ${player} SleepTimer`);
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
// %TRIGGER% = name of the player who wrote the message
// Title = shown large in screen centre, Subtitle = smaller line below

interface TitlePair {
  title: string;
  subtitle: string;
  /** Minecraft color name for the title. Defaults to "white". */
  titleColor?: string;
  /** Minecraft color name for the subtitle. Defaults to "gray". */
  subtitleColor?: string;
}

const TITLES_LOWER: TitlePair[] = [
  {
    title: "schlafenszeit.",
    subtitle: "%TRIGGER% hat's gesagt. du weißt was zu tun ist.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "okay ciao.",
    subtitle: "log dich aus. das bett ist schon online.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "skill issue.",
    subtitle: "nicht schlafen wollen ist halt auch nen skill issue.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "bett. jetzt.",
    subtitle: "%TRIGGER% ist schon weg – nur du stehst noch rum.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "zzz...",
    subtitle: "der server läuft durch. du solltest das nicht.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "game over.",
    subtitle: "für heute reicht's. träumen ist das bessere dlc.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "low battery.",
    subtitle: "dein fokus ist auf 1%. ab an die ladestation.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "nachtschicht beendet.",
    subtitle: "%TRIGGER% hat feierabend gemacht. du jetzt auch.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "offline-modus.",
    subtitle: "deine augen brauchen ein update. dauert ca. 8 stunden.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "ende gelände.",
    subtitle: "wer jetzt noch wach ist, hat die kontrolle verloren.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "schicht ende.",
    subtitle: "niemand hat nach deiner meinung gefragt. bett.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "klappe zu.",
    subtitle: "%TRIGGER% hat den abend beendet. du bist noch da. warum.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "strom sparen.",
    subtitle: "du bist das teuerste gerät was hier noch läuft.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "letzte warnung.",
    subtitle: "nicht von %TRIGGER%. vom kalender.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
  {
    title: "morgen. früh.",
    subtitle: "du weißt selbst wie das endet. geh schlafen.",
    titleColor: "gray",
    subtitleColor: "dark_gray",
  },
];

const TITLES_NORMAL: TitlePair[] = [
  {
    title: "Schlafenszeit.",
    subtitle: "%TRIGGER% hat's angestossen. Jetzt weisst du Bescheid.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Log dich aus.",
    subtitle: "Das hier laeuft morgen noch. Du brauchst Schlaf.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Geh schlafen.",
    subtitle: "Kein Drama. Einfach Bett.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Okay, Ciao.",
    subtitle: "%TRIGGER% hat gesprochen. Das Bett wartet schon.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Touch Grass. Oder Kissen.",
    subtitle: "Schlafen ist kein Bug. Ist ein Feature.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Ruhemodus aktiviert.",
    subtitle: "Dein Körper braucht einen Neustart. Geh schlafen.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Morgen ist auch noch ein Tag.",
    subtitle: "%TRIGGER% hat den Lead übernommen und schläft schon.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Zeit für die Horizontale.",
    subtitle: "Sogar die beste Hardware braucht mal eine Pause.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Abflug ins Traumland.",
    subtitle: "Keine Ausreden mehr. Klappe zu, Augen zu.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "System-Check: Müde.",
    subtitle: "%TRIGGER% empfiehlt: Matratzenhorchdienst antreten.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Schicht vorbei.",
    subtitle: "Nicht verhandelbar. Morgen ist auch noch Minecraft.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Letzte Runde.",
    subtitle: "War's. %TRIGGER% hat das Licht ausgemacht.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Bett > Bildschirm.",
    subtitle: "Heute nicht. Komm morgen wieder.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Ausloggen.",
    subtitle: "Kein Grund mehr hier zu sein. Ernst gemeint.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
  {
    title: "Nacht.",
    subtitle:
      "%TRIGGER% schläft bereits. Du bist das Endgegner des Schlafplans.",
    titleColor: "white",
    subtitleColor: "yellow",
  },
];

const TITLES_ALLCAPS: TitlePair[] = [
  {
    title: "BRO. SCHLAFEN.",
    subtitle: "%TRIGGER% HAT'S GESAGT. WAS WILLST DU NOCH HÖREN.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "LOG DICH AUS!!!",
    subtitle: "DAS BETT WARTET. WIR WARTEN. ALLE WARTEN.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "SKILL ISSUE!!!",
    subtitle: "%TRIGGER% SCHLAEFT SCHON. NUR DU NICHT. CLASSIC.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "BRO???",
    subtitle: "DU SCHLAEFST NOCH NICHT?! WHAT IS WRONG WITH YOU.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "KEIN WIDERSPRUCH.",
    subtitle: "%TRIGGER% HAT GESPROCHEN. INS BETT. JETZT. WIRKLICH.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "ABFAHRT!!!",
    subtitle: "DER SCHLAFZUG VERLÄSST DEN BAHNHOF. LETZTER AUFRUF.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "REICHT JETZT!",
    subtitle: "DU SIEHST AUS WIE EIN ZOMBIE. GEH SCHLAFEN.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "BETT. SOFORT.",
    subtitle: "WENN %TRIGGER% GEHT, GEHST DU AUCH. DISZIPLIN!",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "NOTFALL-STOPP!",
    subtitle: "DEIN GEHIRN HAT SCHON LÄNGST DEN GEIST AUFGEGEBEN.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "GO TO SLEEP!!!",
    subtitle: "KEINE WEITEREN FRAGEN. KEINE WEITEREN KICKS. BETT.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "ERNSTHAFT???",
    subtitle: "%TRIGGER% LIEGT IM BETT. DU LIEST NOCH TITEL. BRUDER.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "AUSLOGGEN. JETZT.",
    subtitle: "NICHT IN 5 MINUTEN. JETZT. DIESER MOMENT. HIER.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "LICHT AUS!!!",
    subtitle: "WER JETZT NOCH SPIELT, ERKLÄRT SICH MORGEN SELBST.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "ICH SCHWÖRE...",
    subtitle: "%TRIGGER% UND ICH SIND FERTIG MIT DIR. SCHLAFEN.",
    titleColor: "red",
    subtitleColor: "gold",
  },
  {
    title: "KEINE CHANCE.",
    subtitle: "DU KOMMST HIER NICHT LEBEND RAUS. OHNE SCHLAF.",
    titleColor: "red",
    subtitleColor: "gold",
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

  const { title, subtitle, titleColor, subtitleColor } = pickRandom(pool);
  return {
    title: title.replace(/%TRIGGER%/g, trigger),
    subtitle: subtitle.replace(/%TRIGGER%/g, trigger),
    titleColor,
    subtitleColor,
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
  const outcome = await server.send("/time query daytime");
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
  // Target: all awake players except the one who triggered the message.
  // SleepTimer:0s  → not in bed / not sleeping
  const selector = `@a[nbt={SleepTimer:0s},name=!${triggerPlayer}]`;

  const titleJson = JSON.stringify({
    text: pair.title,
    color: pair.titleColor ?? "white",
  });
  const subtitleJson = JSON.stringify({
    text: pair.subtitle,
    color: pair.subtitleColor ?? "gray",
  });

  const title = await server.send(`/title ${selector} title ${titleJson}`);
  if (!wasAccepted(title)) return;
  await server.send(`/title ${selector} subtitle ${subtitleJson}`);
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

      // The name goes into `/data get entity` and a `name=!…` selector, so
      // it must be a real player name, not a selector or extra arguments.
      if (!isValidMcName(triggerPlayer)) return;

      // ── Cooldown check ──────────────────────────────────────────────────────
      const serverId = server.id;
      if (isOnCooldown(serverId)) {
        log.info(
          "sleepWatcher",
          `${triggerPlayer} triggered sleep prompt but cooldown is active – skipping.`,
        );
        return;
      }

      // ── Sleeping check ──────────────────────────────────────────────────────
      // Only fire the prompt if the triggering player is actually in bed.
      const triggerIsInBed = await isPlayerSleeping(server, triggerPlayer);
      if (triggerIsInBed !== true) {
        return;
      }

      log.info(
        "sleepWatcher",
        `${triggerPlayer} triggered sleep prompt (${capsMode})`,
      );

      if ((await isNight(server)) !== true) {
        return;
      }

      markTriggered(serverId);
      const pair = buildTitlePair(capsMode, triggerPlayer);

      await sendTitleToAwake(server, triggerPlayer, pair);
    },
  );
}
