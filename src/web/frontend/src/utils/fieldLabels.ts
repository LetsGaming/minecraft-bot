/**
 * Make field labels tell two fields apart.
 *
 * A mod config file routinely names several settings the same thing at
 * different depths: `enabled`, `overworld.enabled` and `nether.enabled` all
 * derive the label "Enabled". The editor stacked them vertically with an
 * 11px grey key path as the only difference, so the form read
 * "Enabled / Enabled / Enabled" and the toggle you wanted was whichever one
 * you counted to correctly.
 *
 * Only colliding labels are touched. A label that is already unique in its
 * file stays exactly as the parser derived it, because prefixing everything
 * would trade one kind of noise for another.
 */

/** The shape this needs; anything with a label and a path qualifies. */
export interface LabelledField {
  label: string;
  path: string[];
}

const titleCase = (segment: string): string =>
  segment
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

/**
 * Return a display label per field, qualified by the nearest distinguishing
 * parent segment where the bare label repeats: `Overworld: Enabled`.
 *
 * A top-level field keeps the bare label even when a nested one collides
 * with it, since "the one at the root" is what an unqualified name means.
 */
export function disambiguateLabels<T extends LabelledField>(
  fields: readonly T[],
): (T & { displayLabel: string })[] {
  const counts = new Map<string, number>();
  for (const field of fields) {
    counts.set(field.label, (counts.get(field.label) ?? 0) + 1);
  }
  return fields.map((field) => {
    const collides = (counts.get(field.label) ?? 0) > 1;
    const parent = field.path.length > 1 ? field.path[field.path.length - 2] : undefined;
    return {
      ...field,
      displayLabel:
        collides && parent ? `${titleCase(parent)}: ${field.label}` : field.label,
    };
  });
}
