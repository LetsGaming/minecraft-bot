import { UI_LOCALE } from "../i18n";

const plain = new Intl.NumberFormat(UI_LOCALE);
const compact = new Intl.NumberFormat(UI_LOCALE, { notation: "compact", maximumFractionDigits: 1 });

/** Every number the dashboard prints follows the interface language, not the browser's. */
export function formatNumber(value: number): string {
  return plain.format(value);
}

export function formatCompact(value: number): string {
  return compact.format(value);
}
