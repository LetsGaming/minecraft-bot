/**
 * Helpers shared by the line-oriented adapters.
 */
import {
  ConfigEditError,
  EDIT_ERRORS,
  pathId,
  type ConfigNode,
  type ConfigValueKind,
} from "./types.js";

export interface ScannedLine {
  /** The line without its newline or a trailing carriage return. */
  line: string;
  /** Offset of the first character of the line in the whole text. */
  start: number;
}

/** Split on `\n`, keeping each line's offset; a `\r` before it is dropped. */
export function scanLines(text: string): ScannedLine[] {
  const out: ScannedLine[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    out.push({ line: raw.replace(/\r$/, ""), start: offset });
    offset += raw.length + 1;
  }
  return out;
}

/**
 * Repeated keys are ambiguous to address, so every occurrence is made unique
 * (`key#1`, `key#2`) and read-only.
 */
export function markDuplicates(nodes: ConfigNode[]): ConfigNode[] {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(pathId(n.path), (counts.get(pathId(n.path)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return nodes.map((n) => {
    const id = pathId(n.path);
    if ((counts.get(id) ?? 0) < 2) return n;
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    const last = n.path[n.path.length - 1] ?? "";
    return { ...n, path: [...n.path.slice(0, -1), `${last}#${nth}`], readOnly: true };
  });
}

/**
 * Walk `text` from `from`, calling `visit` for every character that sits
 * outside a quoted string. `"..."` honours backslash escapes, `'...'` does
 * not; the quote characters themselves and everything between them are not
 * visited. `visit` returns true to stop; the result is the index it stopped
 * at, or -1 when the scan ran to the end.
 */
export function scanOutsideQuotes(
  text: string,
  visit: (ch: string, index: number) => boolean | void,
  from = 0,
): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (visit(ch, i) === true) {
      return i;
    }
  }
  return -1;
}

/** Collects the comment block directly above the next entry. */
export class CommentBlock {
  private lines: string[] = [];
  /**
   * Add one trimmed comment line. Leading `markers` characters (any of them,
   * repeated) and one following space are stripped.
   */
  addLine(trimmed: string, markers = "#"): void {
    let i = 0;
    while (i < trimmed.length && markers.includes(trimmed[i]!)) i++;
    if (/\s/.test(trimmed[i] ?? "")) i++;
    this.lines.push(trimmed.slice(i));
  }
  reset(): void {
    this.lines = [];
  }
  take(): string[] {
    const out = this.lines;
    this.lines = [];
    return out;
  }
}

export function inferScalar(
  raw: string,
): { kind: "boolean" | "number" | "string"; value: boolean | number | string; float: boolean } {
  if (raw === "true" || raw === "false") {
    return { kind: "boolean", value: raw === "true", float: false };
  }
  if (/^-?\d+$/.test(raw)) return { kind: "number", value: Number(raw), float: false };
  if (/^-?\d+\.\d+$/.test(raw)) return { kind: "number", value: Number(raw), float: true };
  return { kind: "string", value: raw, float: false };
}

/** `{ integer: true }` for a scalar written as a whole number, to spread into a node. */
export function integerFlag(scalar: {
  kind: string;
  float?: boolean;
}): { integer?: true } {
  return scalar.kind === "number" && !scalar.float ? { integer: true } : {};
}

/** Throws unless `n` can be written into a setting of this numeric shape. */
export function assertWritableNumber(n: unknown, integer: boolean): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ConfigEditError(EDIT_ERRORS.numberRequired);
  }
  if (integer && !Number.isInteger(n)) throw new ConfigEditError(EDIT_ERRORS.wholeNumber);
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
    throw new ConfigEditError(EDIT_ERRORS.integerTooLarge);
  }
}

export interface NumberShape {
  /** Keep a whole number looking like a float (`5` becomes `5.0`). */
  float?: boolean;
  /** Reject anything but a safe integer. */
  integer?: boolean;
}

export function numberLiteral(value: unknown, shape: NumberShape = {}): string {
  const n = typeof value === "number" ? value : Number(value);
  assertWritableNumber(n, shape.integer === true);
  return shape.float && Number.isInteger(n) ? `${n}.0` : String(n);
}

export interface ScalarOptions {
  /** Render a string value; defaults to the text itself. */
  text?: (text: string) => string;
  /** The adapter handles line breaks in `text` itself (escapes them or refuses). */
  lineBreaks?: "reject" | "handled";
  /** Kinds other than boolean, number and string are not editable. */
  rejectOther?: boolean;
}

/**
 * The boolean, number and string branches every single-value adapter shares.
 * Integer-ness comes from the node's parse-time `integer` flag and float-ness
 * from its `float` hint.
 */
export function scalarLiteral(
  value: unknown,
  kind: ConfigValueKind,
  node: ConfigNode | undefined,
  opts: ScalarOptions = {},
): string {
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "number") {
    return numberLiteral(value, {
      float: node?.hint === "float",
      integer: node?.integer === true,
    });
  }
  if (opts.rejectOther && kind !== "string") {
    throw new ConfigEditError(EDIT_ERRORS.unsafeLayout);
  }
  const text = String(value ?? "");
  if (opts.lineBreaks !== "handled" && /[\r\n]/.test(text)) {
    throw new ConfigEditError(EDIT_ERRORS.lineBreak);
  }
  return opts.text ? opts.text(text) : text;
}
