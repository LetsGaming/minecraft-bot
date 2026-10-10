/**
 * `.ini` and `.conf` files: `[section]` headers, `key = value` lines, `;` or
 * `#` comments.
 *
 * `.ini` is claimed by extension. `.conf` is shared with HOCON, nginx-style and
 * other block formats, so it is claimed only when every non-empty line is a
 * comment, a section header or a `key = value` line. Values are taken verbatim
 * to the end of the line (a `#` inside one is part of it); a value wrapped in
 * double quotes is edited inside its quotes.
 */
import type { ConfigFormat, ConfigNode, ConfigValueKind, ParsedConfig } from "./types.js";
import { ConfigEditError } from "./types.js";
import {
  CommentBlock,
  inferScalar,
  markDuplicates,
  numberLiteral,
  scanLines,
} from "./lines.js";

const SECTION = /^\s*\[([^\]]+)\]\s*$/;
const ENTRY = /^(\s*)([^\s=;#[][^=]*?)(\s*=\s*)(.*?)(\s*)$/;

function isComment(trimmed: string): boolean {
  return trimmed.startsWith(";") || trimmed.startsWith("#");
}

function detect(sample: string): boolean {
  let entries = 0;
  for (const { line } of scanLines(sample)) {
    const t = line.trim();
    if (t === "" || isComment(t) || SECTION.test(line)) continue;
    if (!ENTRY.test(line)) return false;
    entries++;
  }
  return entries > 0;
}

export const iniFormat: ConfigFormat = {
  id: "ini",
  extensions: [".ini"],
  detectExtensions: [".conf", ".cfg"],
  detect,

  parse(text: string): ParsedConfig {
    const nodes: ConfigNode[] = [];
    const comments = new CommentBlock();
    let section: string | null = null;

    for (const { line, start } of scanLines(text)) {
      const trimmed = line.trim();
      if (trimmed === "") {
        comments.reset();
        continue;
      }
      if (isComment(trimmed)) {
        comments.add(trimmed.replace(/^[;#]+\s?/, ""));
        continue;
      }
      const sec = SECTION.exec(line);
      if (sec) {
        section = sec[1]!.trim();
        comments.reset();
        continue;
      }
      const m = ENTRY.exec(line);
      if (!m) {
        comments.reset();
        continue;
      }
      const [, indent = "", rawKey = "", sep = "", value = ""] = m;
      const key = rawKey.trim();
      const valueStart = start + indent.length + rawKey.length + sep.length;

      const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
      const inner = quoted ? value.slice(1, -1) : value;
      const scalar = quoted ? { kind: "string" as const, value: inner, float: false } : inferScalar(value);

      nodes.push({
        path: section === null ? [key] : [section, key],
        key,
        kind: scalar.kind,
        value: scalar.value,
        comments: comments.take(),
        valueSpan: [valueStart, valueStart + value.length],
        ...(quoted ? { hint: "quoted" } : scalar.float ? { hint: "float" } : {}),
      });
    }
    return { nodes: markDuplicates(nodes) };
  },

  literal(value: unknown, kind: ConfigValueKind, node?: ConfigNode): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") return numberLiteral(value, node?.hint === "float");
    const text = String(value ?? "");
    if (/[\r\n]/.test(text)) throw new ConfigEditError("A value cannot contain a line break.");
    if (node?.hint === "quoted") {
      if (text.includes('"')) throw new ConfigEditError("A quoted value cannot contain a double quote.");
      return `"${text}"`;
    }
    return text;
  },
};
