import { GLOSSARY, type GlossaryKey } from "@mcbot/schema/glossary.js";
import { STATUS_TABLE, type StatusRole } from "@mcbot/schema/status.js";
import { en, type EnglishKey } from "./locales/en";

/**
 * The dashboard's translation seam. English only for now: a second language
 * adds a table with the same keys and a way to pick it.
 */
type PluralBase<K> = K extends `${infer Base}.other` ? Base : never;

export type MessageKey = EnglishKey | PluralBase<EnglishKey> | GlossaryKey;

export type MessageVars = Record<string, string | number>;

/**
 * A `t` over one flat table. `{name}` placeholders are filled from `vars`;
 * a numeric `count` picks the `<key>.<plural category>` variant when the
 * table has one.
 */
export function createTranslator(table: Readonly<Record<string, string>>, locale: string) {
  const plurals = new Intl.PluralRules(locale);

  function pick(key: string, vars: MessageVars | undefined): string {
    const count = vars?.count;
    if (typeof count === "number") {
      const variant = table[`${key}.${plurals.select(count)}`] ?? table[`${key}.other`];
      if (variant !== undefined) return variant;
    }
    return table[key] ?? key;
  }

  return (key: string, vars?: MessageVars): string => {
    const text = pick(key, vars);
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in vars ? String(vars[name]) : whole,
    );
  };
}

const translate = createTranslator(
  {
    ...Object.fromEntries(Object.entries(GLOSSARY).map(([key, entry]) => [key, entry.en])),
    ...en,
  },
  "en",
);

export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(key, vars);
}

/** The human label of a status role, as the bot's embeds name it too. */
export function statusLabel(role: StatusRole): string {
  return t(STATUS_TABLE[role].labelKey as GlossaryKey);
}
