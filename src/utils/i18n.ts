/**
 * Minimal localization layer.
 *
 * `t(key, vars)` resolves a key in the configured locale
 * (config.language, "en" | "de"), falling back to English and finally to
 * the key itself, then substitutes {placeholders} from vars.
 *
 * Deliberately tiny: no plural rules, no nested keys, no runtime loading —
 * locales are plain TS maps (src/locales/) so typos surface at review time
 * and the bundle stays dependency-free. New user-visible strings should go
 * through t(); existing literals migrate key-by-key as commands are
 * touched (see docs/dev/architecture.md).
 */
import { loadConfig } from "../config.js";
import { en } from "../locales/en.js";
import { de } from "../locales/de.js";

const LOCALES: Record<string, Record<string, string>> = { en, de };

export function t(key: string, vars: Record<string, unknown> = {}): string {
  const lang = loadConfig().language ?? "en";
  const template = LOCALES[lang]?.[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
