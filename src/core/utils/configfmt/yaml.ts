/**
 * Conservative YAML adapter for plugin configs (`config.yml`).
 *
 * Not a YAML parser. It reads block mappings line by line and exposes only
 * scalar values it can rewrite in place: numbers, booleans and plain, single or
 * double quoted strings, each written back in the style it had. Comments,
 * indentation and every line it does not understand survive byte for byte.
 *
 * Deliberately not shown: sequences and everything inside them, block scalars
 * (`|`, `>`), anchors, aliases and tags, flow collections, multi-line quoted
 * scalars, and YAML 1.1 words such as `yes`, `no`, `on`, `off` and `null`
 * (those are listed read-only). Repeated keys are listed read-only.
 */
import type { ConfigFormat, ConfigNode, ConfigValueKind, ParsedConfig } from "./types.js";
import { ConfigEditError } from "./types.js";
import {
  CommentBlock,
  inferScalar,
  integerFlag,
  markDuplicates,
  scalarLiteral,
  scanLines,
} from "./lines.js";

const KEY_LINE = /^( *)("[^"]*"|'[^']*'|[A-Za-z0-9_][A-Za-z0-9_.\- /]*?)[ ]*:(?:[ ]+(.*))?$/;
const RESERVED_WORDS = new Set(["yes", "no", "on", "off", "y", "n", "null", "~", "true", "false"]);

function unquoteKey(raw: string): string {
  return raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
}

type ParsedValue = Pick<
  ConfigNode,
  "kind" | "value" | "valueSpan" | "hint" | "readOnly" | "integer"
>;

/** Parse the text after `key: `; null when the line has no value this adapter exposes. */
function parseValue(rest: string, offset: number): ParsedValue | null {
  const lead = rest.length - rest.trimStart().length;
  const body = rest.slice(lead);
  const at = offset + lead;
  if (body === "" || body.startsWith("#")) return null;

  const first = body[0]!;
  if (first === '"') {
    let i = 1;
    while (i < body.length && body[i] !== '"') i += body[i] === "\\" ? 2 : 1;
    if (i >= body.length) return null;
    const after = body.slice(i + 1).trim();
    if (after !== "" && !after.startsWith("#")) return null;
    const inner = body.slice(1, i);
    let value: string;
    try {
      value = JSON.parse(`"${inner}"`) as string;
    } catch {
      return { kind: "unknown", value: inner, valueSpan: [at, at + i + 1], readOnly: true };
    }
    return { kind: "string", value, valueSpan: [at, at + i + 1], hint: "double" };
  }
  if (first === "'") {
    let i = 1;
    while (i < body.length) {
      if (body[i] === "'") {
        if (body[i + 1] === "'") i += 2;
        else break;
      } else i++;
    }
    if (i >= body.length) return null;
    const after = body.slice(i + 1).trim();
    if (after !== "" && !after.startsWith("#")) return null;
    return {
      kind: "string",
      value: body.slice(1, i).replace(/''/g, "'"),
      valueSpan: [at, at + i + 1],
      hint: "single",
    };
  }
  if ("|>&*!{[%@`".includes(first)) return null;

  const hash = body.search(/\s#/);
  const plain = (hash === -1 ? body : body.slice(0, hash)).trimEnd();
  if (plain === "" || /:(\s|$)/.test(plain)) return null;
  const span: [number, number] = [at, at + plain.length];
  if (RESERVED_WORDS.has(plain.toLowerCase()) && plain !== "true" && plain !== "false") {
    return { kind: "unknown", value: plain, valueSpan: span, readOnly: true };
  }
  if (/^0\d/.test(plain)) return { kind: "unknown", value: plain, valueSpan: span, readOnly: true };
  const scalar = inferScalar(plain);
  return {
    kind: scalar.kind,
    value: scalar.value,
    valueSpan: span,
    hint: scalar.kind === "string" ? "plain" : scalar.float ? "float" : undefined,
    ...integerFlag(scalar),
  };
}

function safePlain(text: string): boolean {
  return (
    /^[A-Za-z0-9_][A-Za-z0-9_ ./\-]*$/.test(text) &&
    !text.endsWith(" ") &&
    !RESERVED_WORDS.has(text.toLowerCase()) &&
    inferScalar(text).kind === "string" &&
    !/^[0-9]/.test(text)
  );
}

export const yamlFormat: ConfigFormat = {
  id: "yaml",
  extensions: [".yml", ".yaml"],

  parse(text: string): ParsedConfig {
    const nodes: ConfigNode[] = [];
    const comments = new CommentBlock();
    const stack: { indent: number; key: string }[] = [];
    let skipIndent: number | null = null;
    let blockIndent: number | null = null;
    let continuation: { indent: number; node: ConfigNode } | null = null;

    for (const { line, start } of scanLines(text)) {
      const trimmed = line.trim();
      const indent = line.length - line.trimStart().length;

      if (blockIndent !== null) {
        if (trimmed === "" || indent > blockIndent) continue;
        blockIndent = null;
      }
      // A scalar continued on deeper-indented lines folds into one value.
      // Only its first line is visible here, so an edit would change just that
      // line and leave the continuation folded onto the new text: the node is
      // read-only, and the continuation lines are not keys.
      if (continuation) {
        if (trimmed === "") continue;
        if (indent > continuation.indent && !trimmed.startsWith("#")) {
          continuation.node.readOnly = true;
          continue;
        }
        continuation = null;
      }
      if (trimmed === "") {
        comments.reset();
        continue;
      }
      if (trimmed.startsWith("#")) {
        comments.addLine(trimmed);
        continue;
      }
      if (trimmed === "---" || trimmed === "...") {
        stack.length = 0;
        skipIndent = null;
        comments.reset();
        continue;
      }
      if (line.startsWith("\t") || /^ *\t/.test(line)) continue;

      if (skipIndent !== null) {
        if (indent > skipIndent || (indent === skipIndent && trimmed.startsWith("-"))) continue;
        skipIndent = null;
      }
      if (trimmed.startsWith("- ") || trimmed === "-") {
        skipIndent = indent;
        comments.reset();
        continue;
      }

      const m = KEY_LINE.exec(line);
      if (!m) {
        comments.reset();
        continue;
      }
      const key = unquoteKey(m[2]!);
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const path = [...stack.map((s) => s.key), key];

      const rest = m[3] ?? "";
      if (rest.trim() === "" || rest.trim().startsWith("#")) {
        stack.push({ indent, key });
        comments.reset();
        continue;
      }
      if (/^[|>]/.test(rest.trim())) {
        blockIndent = indent;
        comments.reset();
        continue;
      }

      const restStart = start + line.length - rest.length;
      const value = parseValue(rest, restStart);
      if (value) {
        const node: ConfigNode = {
          path,
          key,
          kind: value.kind,
          value: value.value,
          comments: comments.take(),
          valueSpan: value.valueSpan,
          ...(value.hint ? { hint: value.hint } : {}),
          ...(value.integer ? { integer: true } : {}),
          ...(value.readOnly ? { readOnly: true } : {}),
        };
        nodes.push(node);
        continuation = { indent, node };
      } else {
        comments.reset();
        // An unclosed quote, a flow collection or an anchor continues on the
        // deeper-indented lines below; none of them are keys.
        if (/^\s*[[{&*!"']/.test(rest)) skipIndent = indent;
      }
    }
    return { nodes: markDuplicates(nodes) };
  },

  literal(value: unknown, kind: ConfigValueKind, node?: ConfigNode): string {
    return scalarLiteral(value, kind, node, {
      rejectOther: true,
      lineBreaks: "handled",
      text: (text) => {
        if (node?.hint === "single") {
          if (/[\r\n]/.test(text)) {
            throw new ConfigEditError("A single-quoted value cannot contain a line break.");
          }
          return `'${text.replace(/'/g, "''")}'`;
        }
        if (node?.hint === "plain" && safePlain(text)) return text;
        return JSON.stringify(text);
      },
    });
  },
};
