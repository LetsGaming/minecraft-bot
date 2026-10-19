/**
 * Minimal localization layer.
 *
 * `t(key, vars, guildId?)` resolves a key in the effective locale,
 * falling back to English and finally to the key itself, then substitutes
 * {placeholders} from vars.
 *
 * Locale resolution order:
 *   1. `guilds.<guildId>.language`, per-guild override, when a guild
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
 * deliberately stay on the global language, a server instance can serve
 * several guilds, so there is no single correct guild to borrow a locale
 * from (see docs/dev/decisions.md).
 *
 * Plurals use `{count|one form|other form}` inside a template, resolved
 * through `Intl.PluralRules` for the effective language; `#` in a form is
 * replaced by the number.
 *
 * Deliberately tiny: no nested keys, no runtime loading. Locales are plain
 * TS maps (src/core/locales/) so typos surface at
 * review time and the bundle stays dependency-free. `npm run i18n:check`
 * fails when en and de diverge on keys.
 */
import { AsyncLocalStorage } from "async_hooks";
import { tryLoadConfig } from "./config/configAccess.js";
import { en } from "../locales/en.js";
import { de } from "../locales/de.js";
import { isLanguage, type Language } from "@mcbot/schema/language.js";

const DEFAULT_LANGUAGE: Language = "en";

const LOCALES: Record<Language, Record<string, string>> = { en, de };

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

/**
 * The effective locale for an optional guild context: the guild override
 * when set and valid, the global setting otherwise.
 */
export function resolveLanguage(guildId?: string): Language {
  // Config unavailable (early startup, some tests): English.
  const loaded = tryLoadConfig({ onError: "open" });
  if (!loaded.ok) return DEFAULT_LANGUAGE;
  const cfg = loaded.config;
  const gid = guildId ?? guildLocaleContext.getStore()?.guildId;
  const guildLang = gid ? cfg.guilds?.[gid]?.language : undefined;
  if (isLanguage(guildLang)) return guildLang;
  return isLanguage(cfg.language) ? cfg.language : DEFAULT_LANGUAGE;
}

/**
 * A number in the effective language's convention ("1,234" or "1.234").
 * `fixed` sets an exact number of decimals.
 */
export function formatNumber(
  value: number,
  options: { fixed?: number } = {},
  guildId?: string,
): string {
  return value.toLocaleString(
    resolveLanguage(guildId),
    options.fixed === undefined
      ? undefined
      : { minimumFractionDigits: options.fixed, maximumFractionDigits: options.fixed },
  );
}

export function t(
  key: string,
  vars: Record<string, unknown> = {},
  guildId?: string,
): string {
  const lang = resolveLanguage(guildId);
  const template = LOCALES[lang]?.[key] ?? en[key] ?? key;
  return template
    .replace(PLURAL_PATTERN, (match, name: string, one: string, other: string) => {
      if (!(name in vars)) return match;
      const count = Number(vars[name]);
      const form = pluralCategory(count, lang) === "one" ? one : other;
      return form.replace(/#/g, String(vars[name]));
    })
    .replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
}

const PLURAL_PATTERN = /\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g;

const pluralRules = new Map<string, Intl.PluralRules>();

/** The CLDR plural category of `count` in `lang` ("one", "other", ...). */
export function pluralCategory(count: number, lang: Language): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(count);
}

