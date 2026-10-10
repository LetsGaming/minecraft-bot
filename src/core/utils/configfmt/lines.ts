/**
 * Helpers shared by the line-oriented adapters.
 */
import { ConfigEditError, pathId, type ConfigNode } from "./types.js";

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

/** Collects the `#` comment block directly above the next entry. */
export class CommentBlock {
  private lines: string[] = [];
  add(line: string): void {
    this.lines.push(line);
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

export function numberLiteral(value: unknown, float: boolean): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ConfigEditError("A number is required.");
  return float && Number.isInteger(n) ? `${n}.0` : String(n);
}
