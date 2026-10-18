/** The locales the bot's user-facing copy exists in. */
export const LANGUAGES = ["en", "de"] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}
