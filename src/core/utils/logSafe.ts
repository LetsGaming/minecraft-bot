/**
 * Making untrusted text (wrapper responses, slugs, user input) safe to put in
 * a log line. Dependency-free so any layer can use it.
 */

const LOG_VALUE_MAX = 500;

/** Code point ranges that can end a line, move a cursor, or reorder text. */
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], // C0 controls, including CR, LF and ESC
  [0x7f, 0x9f], // DEL and the C1 controls, including NEL
  [0x200b, 0x200f], // zero-width characters and directional marks
  [0x2028, 0x2029], // line and paragraph separators
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // byte order mark
];

const NAMED_ESCAPES: Record<number, string> = { 10: "\\n", 13: "\\r", 9: "\\t" };

function isUnsafe(code: number): boolean {
  return UNSAFE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * Every line-breaking, control, escape-sequence-introducing and bidi
 * character becomes a visible escape, and the length is capped. Ordinary
 * text, spaces included, is unchanged.
 */
export function logSafe(value: unknown, max = LOG_VALUE_MAX): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  let out = "";
  for (const ch of text) {
    if (out.length >= max) return out + "...";
    const code = ch.codePointAt(0)!;
    out += isUnsafe(code)
      ? (NAMED_ESCAPES[code] ?? "\\u" + code.toString(16).padStart(4, "0"))
      : ch;
  }
  return out;
}

const PLAIN_FIELD_VALUE = /^[\w.:/@+-]*$/;

/**
 * Fixed-name `key=value` pairs. A value that is not plain (spaces, `=`,
 * quotes, anything neutralised) is JSON-quoted, so untrusted text can never
 * open a second pair.
 */
export function logFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      const safe = logSafe(value);
      return `${key}=${PLAIN_FIELD_VALUE.test(safe) ? safe : JSON.stringify(safe)}`;
    })
    .join(" ");
}
