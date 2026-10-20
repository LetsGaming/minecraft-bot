import { sameValue } from "./formIndex";

/**
 * Whether a top-level setting shows by default: saved in the document, edited
 * in this session, or carrying a problem. Everything else is "at default" and
 * sits behind the group's expander.
 */
export function isKeyActive(
  key: string,
  model: Record<string, unknown> | null | undefined,
  baseline: Record<string, unknown> | null | undefined,
  problemKeys: ReadonlySet<string>,
): boolean {
  const saved = baseline?.[key];
  if (saved !== undefined && saved !== null) return true;
  if (!sameValue(model?.[key], saved)) return true;
  return problemKeys.has(key);
}
