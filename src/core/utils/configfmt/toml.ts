/**
 * TOML adapter for Forge and NeoForge mod configs.
 *
 * A hand-written line scanner rather than a TOML library, and that is a
 * deliberate trade. A real parser gives you a correct object and throws the
 * layout away; what this editor needs is the layout. These files are also a
 * narrow dialect — flat `key = value` lines under `[section]` headers, one
 * value per line, written by a config library rather than by hand — so the
 * scanner stays small and the cases it cannot handle are detectable rather
 * than silently mangled.
 *
 * What it deliberately does not attempt: multi-line arrays, inline tables,
 * multi-line basic strings, and array-of-table headers. Those are marked
 * `readOnly` so the UI shows them and refuses to rewrite them, which is the
 * honest outcome — mangling a value you did not understand is worse than
 * declining to edit it.
 */
import type {
  ConfigFormat,
  ConfigNode,
  ConfigValueKind,
  ParsedConfig,
} from "./types.js";

/** `[section]` or `[section.sub]`, but not `[[array-of-table]]`. */
const SECTION_RE = /^\s*\[([^[\]]+)\]\s*$/;
/** `key = value`, capturing where the value starts. Bare or quoted keys. */
const ENTRY_RE = /^(\s*)("[^"]*"|'[^']*'|[A-Za-z0-9_\-.]+)(\s*=\s*)(.*)$/;

function unquoteKey(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Strip a trailing `# comment` that sits outside any quoted string. */
function splitTrailingComment(valueText: string): string {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < valueText.length; i++) {
    const ch = valueText[i];
    if (ch === "\\" && inDouble) {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "#" && !inDouble && !inSingle) return valueText.slice(0, i);
  }
  return valueText;
}

function parseScalar(text: string): { value: unknown; kind: ConfigValueKind } {
  const t = text.trim();
  if (t === "true" || t === "false") return { value: t === "true", kind: "boolean" };
  if (/^-?\d+$/.test(t)) return { value: Number(t), kind: "number" };
  if (/^-?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    return { value: Number(t), kind: "number" };
  }
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    const inner = t.slice(1, -1);
    // Only basic strings process escapes; literal strings are verbatim.
    return {
      value: t.startsWith('"') ? inner.replace(/\\(["\\ntr])/g, unescapeChar) : inner,
      kind: "string",
    };
  }
  return { value: t, kind: "unknown" };
}

function unescapeChar(_m: string, c: string): string {
  return c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c;
}

/** Single-line arrays only. Returns null when it spans lines or nests. */
function parseArray(
  text: string,
): { value: unknown[]; kind: ConfigValueKind } | null {
  const t = text.trim();
  if (!t.startsWith("[")) return null;
  if (!t.endsWith("]")) return null; // multi-line — caller marks read-only
  if (t.includes("[", 1) || t.includes("{")) return null; // nested

  const body = t.slice(1, -1).trim();
  if (body === "") return { value: [], kind: "stringList" };

  const parts: string[] = [];
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && inDouble) {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (!inDouble && !inSingle) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        parts.push(body.slice(start, i));
        start = i + 1;
      }
    }
  }
  parts.push(body.slice(start));

  const items = parts.map((p) => parseScalar(p));
  const allNumbers = items.every((i) => i.kind === "number");
  return {
    value: items.map((i) => i.value),
    kind: allNumbers ? "numberList" : "stringList",
  };
}

function escapeBasicString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export const tomlFormat: ConfigFormat = {
  id: "toml",
  extensions: [".toml"],

  parse(text: string): ParsedConfig {
    const nodes: ConfigNode[] = [];
    let section: string[] = [];
    let comments: string[] = [];
    let offset = 0;
    let warning: string | undefined;

    for (const rawLine of text.split("\n")) {
      const lineStart = offset;
      offset += rawLine.length + 1; // +1 for the newline we split on

      const line = rawLine.replace(/\r$/, "");
      const trimmed = line.trim();

      if (trimmed === "") {
        // A blank line ends a comment block: comments belong to the key they
        // sit directly above, not to whatever came earlier in the file.
        comments = [];
        continue;
      }
      if (trimmed.startsWith("#")) {
        comments.push(trimmed.replace(/^#+\s?/, ""));
        continue;
      }
      if (trimmed.startsWith("[[")) {
        // Array-of-table. Everything under it is reported but not editable.
        warning ??= "Contains [[array of table]] sections, which are read-only.";
        section = [];
        comments = [];
        continue;
      }

      const sectionMatch = SECTION_RE.exec(line);
      if (sectionMatch?.[1]) {
        section = sectionMatch[1].split(".").map((s) => unquoteKey(s.trim()));
        comments = [];
        continue;
      }

      const entry = ENTRY_RE.exec(line);
      if (!entry) {
        comments = [];
        continue;
      }

      const [, indent = "", rawKey = "", separator = ""] = entry;
      const valueStart = lineStart + indent.length + rawKey.length + separator.length;
      const rawValue = entry[4] ?? "";
      const valueText = splitTrailingComment(rawValue);
      const trailingTrimmed = valueText.replace(/\s+$/, "");

      const arr = parseArray(trailingTrimmed);
      const parsed = arr ?? parseScalar(trailingTrimmed);
      const looksArray = trailingTrimmed.startsWith("[");

      nodes.push({
        path: [...section, unquoteKey(rawKey)],
        key: unquoteKey(rawKey),
        kind: parsed.kind,
        value: parsed.value,
        comments: [...comments],
        valueSpan: [valueStart, valueStart + trailingTrimmed.length],
        // A bracket we could not parse means a multi-line or nested array.
        ...(looksArray && !arr ? { readOnly: true } : {}),
      });
      comments = [];
    }

    return warning ? { nodes, warning } : { nodes };
  },

  literal(value: unknown, kind: ConfigValueKind): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") return String(value);
    if (kind === "stringList" || kind === "numberList") {
      const items = Array.isArray(value) ? value : [];
      const rendered = items.map((v) =>
        typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : `"${escapeBasicString(String(v))}"`,
      );
      return `[${rendered.join(", ")}]`;
    }
    if (kind === "unknown") return String(value);
    return `"${escapeBasicString(String(value))}"`;
  },
};
