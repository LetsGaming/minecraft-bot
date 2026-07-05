/**
 * Minimal localization layer.
 *
 * `t(key, vars, guildId?)` resolves a key in the effective locale,
 * falling back to English and finally to the key itself, then substitutes
 * {placeholders} from vars.
 *
 * Locale resolution order:
 *   1. `guilds.<guildId>.language` — per-guild override, when a guild
 *      context is known (explicit third argument, or the ambient context
 *      set by the command middleware / per-guild broadcast loops),
 *   2. the global `language` from config.json,
 *   3. "en".
 *
 * The ambient context uses AsyncLocalStorage: withErrorHandling enters it
 * once per slash command and the per-guild notification loops enter it per
 * guild, so the ~150 existing t() call sites localize per guild without
 * threading a guildId parameter through layers that must stay
 * Discord-agnostic (statUtils, stores). An explicit guildId argument
 * always wins over the ambient one. In-game (!command) strings and DMs
 * deliberately stay on the global language — a server instance can serve
 * several guilds, so there is no single correct guild to borrow a locale
 * from (see docs/dev/decisions.md).
 *
 * Deliberately tiny: no plural rules, no nested keys, no runtime loading —
 * locales are plain TS maps (src/common/locales/) so typos surface at
 * review time and the bundle stays dependency-free. `npm run i18n:check`
 * fails when en and de diverge on keys.
 */
import { AsyncLocalStorage } from "async_hooks";
import { loadConfig } from "../config.js";
import { en } from "../locales/en.js";
import { de } from "../locales/de.js";

const LOCALES: Record<string, Record<string, string>> = { en, de };

const guildLocaleContext = new AsyncLocalStorage<{
  guildId: string | undefined;
}>();

/**
 * Run `fn` with an ambient guild context that t() consults for the
 * per-guild language. Entered by the command middleware and by per-guild
 * watcher broadcast loops; nesting replaces the context for the inner run.
 */
export function runWithGuildLocale<T>(
  guildId: string | undefined,
  fn: () => T,
): T {
  return guildLocaleContext.run({ guildId }, fn);
}

/** Normalize any configured language string to a known locale, or null. */
function knownLocale(lang: unknown): "en" | "de" | null {
  return lang === "de" ? "de" : lang === "en" ? "en" : null;
}

/**
 * The effective locale for an optional guild context: the guild override
 * when set and valid, the global setting otherwise.
 */
export function resolveLanguage(guildId?: string): "en" | "de" {
  let global: "en" | "de" = "en";
  let guildLang: "en" | "de" | null = null;
  try {
    const cfg = loadConfig();
    global = cfg.language ?? "en";
    const gid = guildId ?? guildLocaleContext.getStore()?.guildId;
    if (gid) guildLang = knownLocale(cfg.guilds?.[gid]?.language);
  } catch {
    // config unavailable (early startup, some tests) — English fallback
  }
  return guildLang ?? global;
}

export function t(
  key: string,
  vars: Record<string, unknown> = {},
  guildId?: string,
): string {
  const lang = resolveLanguage(guildId);
  const template = LOCALES[lang]?.[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
