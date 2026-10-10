/**
 * TOML adapter for Forge and NeoForge mod configs.
 *
 * A hand-written line scanner rather than a TOML library, and that is a
 * deliberate trade. A real parser gives you a correct object and throws the
 * layout away; what this editor needs is the layout. These files are also a
 * narrow dialect: `key = value` lines under `[section]` headers, one value per
 * line, written by a config library rather than by hand. The scanner stays
 * small and the cases it cannot handle are detectable rather than silently
 * mangled.
 *
 * What it deliberately does not attempt: multi-line arrays, inline tables,
 * multi-line strings, and anything under an `[[array of tables]]` header.
 * Those nodes are `readOnly` (or skipped, for multi-line strings) so the UI
 * shows them and refuses to rewrite them, which is the honest outcome:
 * mangling a value you did not understand is worse than declining to edit it.
 */
import { ConfigEditError } from "./types.js";
import type {
  ConfigFormat,
  ConfigNode,
  ConfigValueKind,
  ParsedConfig,
} from "./types.js";
import { CommentBlock, markDuplicates, numberLiteral, scanLines } from "./lines.js";

const KEY_PART = String.raw`(?:"[^"]*"|'[^']*'|[A-Za-z0-9_\-]+)`;
/** `key = value` with a bare, quoted or dotted key, capturing where the value starts. */
const ENTRY_RE = new RegExp(
  String.raw`^(\s*)(${KEY_PART}(?:\s*\.\s*${KEY_PART})*)(\s*=\s*)(.*)$`,
);

function unquotePart(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return unescapeBasic(raw.slice(1, -1)) ?? raw.slice(1, -1);
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Split `a."b.c".d` into its parts, honouring quotes. */
export function splitKeyPath(raw: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ".") {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts.map((p) => unquotePart(p.trim()));
}

/**
 * The text between the brackets of a table header, or null when the line is
 * not a well-formed header. Quote-aware, so `["a]b".c]` is read correctly.
 */
function headerBody(trimmed: string, open: number): string | null {
  const close = "]".repeat(open);
  let quote: string | null = null;
  for (let i = open; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (trimmed.startsWith(close, i)) {
      const rest = trimmed.slice(i + open).trim();
      return rest === "" || rest.startsWith("#") ? trimmed.slice(open, i) : null;
    }
  }
  return null;
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

const SIMPLE_ESCAPES: Record<string, string> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/** Decode a basic string body, or null when it holds an invalid escape. */
function unescapeBasic(inner: string): string | null {
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = inner[++i];
    if (next === undefined) return null;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out += simple;
    } else if (next === "u" || next === "U") {
      const len = next === "u" ? 4 : 8;
      const hex = inner.slice(i + 1, i + 1 + len);
      if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) return null;
      const code = parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
      out += String.fromCodePoint(code);
      i += len;
    } else {
      return null;
    }
  }
  return out;
}

interface Scalar {
  value: unknown;
  kind: ConfigValueKind;
  float?: boolean;
}

function parseScalar(text: string): Scalar {
  const t = text.trim();
  if (t === "true" || t === "false") return { value: t === "true", kind: "boolean" };
  if (/^-?\d+$/.test(t)) return { value: Number(t), kind: "number" };
  if (/^-?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    return { value: Number(t), kind: "number", float: true };
  }
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"') && !t.startsWith('"""')) {
    const decoded = unescapeBasic(t.slice(1, -1));
    return decoded === null ? { value: t, kind: "unknown" } : { value: decoded, kind: "string" };
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'") && !t.startsWith("'''")) {
    return { value: t.slice(1, -1), kind: "string" };
  }
  return { value: t, kind: "unknown" };
}

/** Single-line arrays only. Returns null when it spans lines or nests. */
function parseArray(
  text: string,
): { value: unknown[]; kind: ConfigValueKind; float: boolean } | null {
  const t = text.trim();
  if (!t.startsWith("[")) return null;
  if (!t.endsWith("]")) return null;
  if (t.includes("[", 1) || t.includes("{")) return null;

  const body = t.slice(1, -1).trim();
  if (body === "") return { value: [], kind: "stringList", float: false };

  const parts: string[] = [];
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
    else if (ch === "," && !inDouble && !inSingle) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  // A trailing comma leaves one empty part.
  if (parts.length > 1 && parts[parts.length - 1]!.trim() === "") parts.pop();

  const items = parts.map((p) => parseScalar(p));
  if (items.some((i) => i.kind === "unknown")) return null;
  const allNumbers = items.every((i) => i.kind === "number");
  return {
    value: items.map((i) => i.value),
    kind: allNumbers ? "numberList" : "stringList",
    float: items.some((i) => i.float),
  };
}

function escapeBasicString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else out += ch;
  }
  return out;
}

/** Net count of opening minus closing brackets outside quoted strings. */
function bracketDelta(text: string): number {
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && inDouble) i++;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (!inDouble && !inSingle) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
    }
  }
  return depth;
}

/** The delimiter of a multi-line string that opens on this line and does not close on it. */
function multilineDelimiter(valueText: string): string | null {
  const t = valueText.trim();
  for (const delim of ['"""', "'''"]) {
    if (t.startsWith(delim) && !t.slice(3).includes(delim)) return delim;
  }
  return null;
}

export const tomlFormat: ConfigFormat = {
  id: "toml",
  extensions: [".toml"],

  parse(text: string): ParsedConfig {
    const nodes: ConfigNode[] = [];
    let section: string[] = [];
    let inArrayTable = false;
    let arrayHead: string[] | null = null;
    let arrayLabel = "";
    const arrayCounts = new Map<string, number>();
    const comments = new CommentBlock();
    let skipUntil: string | null = null;
    let openBrackets = 0;

    for (const { line, start: lineStart } of scanLines(text)) {
      if (openBrackets > 0) {
        openBrackets += bracketDelta(splitTrailingComment(line));
        continue;
      }
      if (skipUntil) {
        if (line.includes(skipUntil)) skipUntil = null;
        continue;
      }
      const trimmed = line.trim();

      if (trimmed === "") {
        // A blank line ends a comment block: comments belong to the key they
        // sit directly above, not to whatever came earlier in the file.
        comments.reset();
        continue;
      }
      if (trimmed.startsWith("#")) {
        comments.add(trimmed.replace(/^#+\s?/, ""));
        continue;
      }
      if (trimmed.startsWith("[[")) {
        const body = headerBody(trimmed, 2);
        comments.reset();
        if (body === null) continue;
        const head = splitKeyPath(body);
        const id = JSON.stringify(head);
        const n = (arrayCounts.get(id) ?? 0) + 1;
        arrayCounts.set(id, n);
        arrayHead = head;
        arrayLabel = `${head[head.length - 1]}[${n}]`;
        section = [...head.slice(0, -1), arrayLabel];
        inArrayTable = true;
        continue;
      }
      if (trimmed.startsWith("[")) {
        const body = headerBody(trimmed, 1);
        comments.reset();
        if (body === null) continue;
        const head = splitKeyPath(body);
        if (
          arrayHead &&
          head.length >= arrayHead.length &&
          arrayHead.every((seg, i) => seg === head[i])
        ) {
          section = [
            ...arrayHead.slice(0, -1),
            arrayLabel,
            ...head.slice(arrayHead.length),
          ];
          inArrayTable = true;
        } else {
          section = head;
          inArrayTable = false;
          arrayHead = null;
        }
        continue;
      }

      const entry = ENTRY_RE.exec(line);
      if (!entry) {
        comments.reset();
        continue;
      }

      const [, indent = "", rawKey = "", separator = ""] = entry;
      const valueStart = lineStart + indent.length + rawKey.length + separator.length;
      const rawValue = entry[4] ?? "";
      const valueText = splitTrailingComment(rawValue);
      const trailingTrimmed = valueText.replace(/\s+$/, "");

      const delim = multilineDelimiter(rawValue);
      if (delim) {
        skipUntil = delim;
        comments.reset();
        continue;
      }

      if (trailingTrimmed.startsWith("[") || trailingTrimmed.startsWith("{")) {
        openBrackets = Math.max(0, bracketDelta(trailingTrimmed));
      }

      const keyPath = splitKeyPath(rawKey);
      const arr = parseArray(trailingTrimmed);
      const parsed: Scalar = arr ?? parseScalar(trailingTrimmed);
      const looksArray = trailingTrimmed.startsWith("[");
      const float = arr ? arr.float : parsed.float === true;

      nodes.push({
        path: [...section, ...keyPath],
        key: keyPath[keyPath.length - 1] ?? "",
        kind: parsed.kind,
        value: parsed.value,
        comments: comments.take(),
        valueSpan: [valueStart, valueStart + trailingTrimmed.length],
        ...(float ? { hint: "float" } : {}),
        ...(inArrayTable || (looksArray && !arr) ? { readOnly: true } : {}),
      });
    }

    return { nodes: markDuplicates(nodes) };
  },

  literal(value: unknown, kind: ConfigValueKind, node?: ConfigNode): string {
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "number") return numberLiteral(value, node?.hint === "float");
    if (kind === "stringList" || kind === "numberList") {
      const items = Array.isArray(value) ? value : [];
      const float = node?.hint === "float";
      const rendered = items.map((v) =>
        typeof v === "number"
          ? numberLiteral(v, float)
          : typeof v === "boolean"
            ? String(v)
            : `"${escapeBasicString(String(v))}"`,
      );
      return `[${rendered.join(", ")}]`;
    }
    if (kind === "unknown") {
      throw new ConfigEditError("This value has a layout the editor cannot rewrite safely.");
    }
    return `"${escapeBasicString(String(value))}"`;
  },
};
