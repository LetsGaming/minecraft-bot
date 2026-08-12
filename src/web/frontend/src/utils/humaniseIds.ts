/**
 * Swap Discord snowflakes in free text for the names they refer to.
 *
 * The audit log and config history describe what happened in prose the server
 * assembles: `guild config write (1414963283685019781)`. Accurate, and
 * unreadable at a glance. Three of those rows in a table and the only way to
 * tell which guild each touched is to compare the last four digits.
 *
 * Only IDs that resolve are replaced. An unknown snowflake stays exactly as it
 * was, because substituting a placeholder would delete the one identifier the
 * line carried without supplying a real name in return.
 *
 * Pure and framework-free, so it can be unit-tested without mounting anything.
 */

/** Snowflakes are 17 to 20 digits. Narrow enough not to eat timestamps. */
const SNOWFLAKE = /\b\d{17,20}\b/g;

export function humaniseIds(
  text: string,
  resolve: (id: string) => string | undefined,
): string {
  if (!text) return text;
  return text.replace(SNOWFLAKE, (id) => resolve(id) ?? id);
}
