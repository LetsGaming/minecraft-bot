/**
 * The parts that are the same for every format: choosing an adapter, applying
 * edits by splicing, and turning a mod author's comments into a form schema.
 */
import { propertiesFormat, jsonFormat } from "./formats.js";
import { tomlFormat } from "./toml.js";
import { forgeCfgFormat } from "./forgeCfg.js";
import { iniFormat } from "./ini.js";
import { yamlFormat } from "./yaml.js";
import { colonTextFormat } from "./colonText.js";
import { assertWritableNumber } from "./lines.js";
import {
  ConfigEditError,
  pathId,
  type ConfigEdit,
  type ConfigFormat,
  type ConfigNode,
  type ConfigValueKind,
  type ParsedConfig,
} from "./types.js";

export * from "./types.js";
export { propertiesFormat, jsonFormat, tomlFormat, forgeCfgFormat, iniFormat, yamlFormat, colonTextFormat };

/** Order matters: where several adapters may claim an extension, the first detector to accept wins. */
const FORMATS: ConfigFormat[] = [
  tomlFormat,
  jsonFormat,
  propertiesFormat,
  yamlFormat,
  forgeCfgFormat,
  iniFormat,
  colonTextFormat,
];

/**
 * The adapter for a filename, or null when nothing claims it.
 *
 * Extensions that many unrelated formats share (`.txt`, `.cfg`, `.conf`) are
 * claimed only when an adapter's detector accepts the text, so without a
 * `sample` they resolve to null.
 */
export function formatFor(fileName: string, sample?: string): ConfigFormat | null {
  const lower = fileName.toLowerCase();
  for (const fmt of FORMATS) {
    if (fmt.extensions.some((ext) => lower.endsWith(ext))) return fmt;
  }
  if (sample !== undefined) {
    for (const fmt of FORMATS) {
      if (
        fmt.detect &&
        fmt.detectExtensions?.some((ext) => lower.endsWith(ext)) &&
        fmt.detect(sample, fileName)
      ) {
        return fmt;
      }
    }
  }
  return null;
}

export function parseConfig(fileName: string, text: string): ParsedConfig {
  const fmt = formatFor(fileName, text);
  if (!fmt) return { nodes: [], warning: `Unsupported file type: ${fileName}` };
  return fmt.parse(text);
}

const samePath = (a: string[], b: string[]): boolean => pathId(a) === pathId(b);

const dotted = (path: string[]): string => (path.length === 0 ? "(root)" : path.join("."));

/** Structural equality, enough for the scalars and flat lists configs hold. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  return false;
}

/**
 * Apply edits by replacing value spans, leaving everything else byte-identical.
 *
 * Descending order is not a detail: splicing shifts every offset after the
 * edit, so applying front-to-back would corrupt the second edit onward. Going
 * back-to-front means each span is still valid when it is used.
 *
 * The result is re-parsed before being returned. If the reparse fails, or the
 * set of keys changed, the write is refused entirely rather than handing back
 * a file that is subtly wrong, a mangled config is worse than a rejected one,
 * because the server will happily start with it and behave strangely.
 */
export function applyConfigEdits(
  fileName: string,
  text: string,
  edits: ConfigEdit[],
): string {
  if (edits.length === 0) return text;

  const fmt = formatFor(fileName, text);
  if (!fmt) throw new ConfigEditError(`Unsupported file type: ${fileName}`);

  const before = fmt.parse(text);

  // Unchanged values are skipped, not rewritten. Re-emitting a value through
  // the format's literal() is not always byte-identical to what was there.
  // JSON.stringify normalises array spacing, for one, so writing back a value
  // nobody touched would reformat lines for no reason. A save should change
  // the settings that changed and nothing else, which also keeps the file's
  // diff readable for whoever looks at it next.
  const changed = edits.filter((edit) => {
    const node = before.nodes.find((n) => samePath(n.path, edit.path));
    return !node || !sameValue(node.value, edit.value);
  });
  if (changed.length === 0) return text;

  const resolved = changed.map((edit) => {
    const node = before.nodes.find((n) => samePath(n.path, edit.path));
    if (!node) {
      throw new ConfigEditError(`No such setting: ${dotted(edit.path)}`);
    }
    if (node.readOnly) {
      throw new ConfigEditError(
        `${dotted(edit.path)} uses a layout this editor cannot rewrite safely.`,
      );
    }
    checkValueKind(node, edit.value);
    return { node, value: edit.value };
  });

  let out = text;
  for (const { node, value } of [...resolved].sort(
    (a, b) => b.node.valueSpan[0] - a.node.valueSpan[0],
  )) {
    const literal = fmt.literal(value, node.kind, node);
    out = out.slice(0, node.valueSpan[0]) + literal + out.slice(node.valueSpan[1]);
  }

  const after = fmt.parse(out);
  if (after.nodes.length !== before.nodes.length) {
    throw new ConfigEditError(
      "The edit changed the structure of the file, refusing to write.",
    );
  }
  for (const [i, node] of after.nodes.entries()) {
    if (!samePath(node.path, before.nodes[i]!.path)) {
      throw new ConfigEditError(
        "The edit reordered or renamed settings, refusing to write.",
      );
    }
  }
  // AUD-025: what the file says now must be what was asked for. A literal
  // writer that coerced a value (the string "false" written as `true`, a
  // non-list emptying a list) would otherwise save something else silently.
  for (const { node, value } of resolved) {
    const now = after.nodes.find((n) => samePath(n.path, node.path));
    if (!now || !sameValue(now.value, value)) {
      throw new ConfigEditError(
        `${dotted(node.path)} would not be saved as entered, refusing to write.`,
      );
    }
  }
  return out;
}

/**
 * AUD-025: the value has to be of the setting's kind. The literal writers
 * trust their input, so a wrong type (a client bug or a hand-made request)
 * was spliced in as something else.
 */
function checkValueKind(node: ConfigNode, value: unknown): void {
  const ok = (() => {
    switch (node.kind) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "stringList":
        return Array.isArray(value) && value.every((v) => typeof v === "string");
      case "numberList":
        return (
          Array.isArray(value) &&
          value.every((v) => typeof v === "number" && Number.isFinite(v))
        );
      default:
        return (
          typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))
        );
    }
  })();
  if (!ok) {
    throw new ConfigEditError(
      `${dotted(node.path)} expects a ${KIND_NAMES[node.kind]}.`,
    );
  }
  const numbers =
    node.kind === "number" ? [value] : node.kind === "numberList" ? (value as unknown[]) : [];
  for (const n of numbers) assertWritableNumber(n, node.integer === true);
}

const KIND_NAMES: Record<ConfigValueKind, string> = {
  string: "text value",
  number: "number",
  boolean: "true or false value",
  stringList: "list of text values",
  numberList: "list of numbers",
  unknown: "single value",
};

// ── Schema derivation ────────────────────────────────────────────────────────

/** What the UI needs to render one setting as a real control. */
export interface ConfigFieldSchema {
  path: string[];
  label: string;
  kind: ConfigValueKind;
  value: unknown;
  description?: string;
  /** From `Allowed Values:`, render a select rather than a text box. */
  options?: string[];
  /** From `Range: a ~ b`. */
  min?: number;
  max?: number;
  default?: string;
  readOnly?: boolean;
}

/**
 * Turn a key name into something a person can read.
 *
 * The fallback for files that document nothing, Fabric JSON, mostly. It is
 * a guess and it looks like one, which is better than showing `maxSpawnCount`
 * to someone who has never seen camelCase.
 */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Read the directives Forge and NeoForge write above every key.
 *
 * This is the trick that makes the editor worth building rather than being a
 * glorified text box: those files already contain their own schema, in the
 * comments, and nobody has to hand-write one per mod.
 *
 *     #Range: 1 ~ 64
 *     #Allowed Values: PEACEFUL, EASY, NORMAL, HARD
 *     #Default: NORMAL
 */
export function schemaFromNode(node: ConfigNode): ConfigFieldSchema {
  const field: ConfigFieldSchema = {
    path: node.path,
    label: humanizeKey(node.key),
    kind: node.kind,
    value: node.value,
    ...(node.readOnly ? { readOnly: true } : {}),
  };

  const description: string[] = [];
  for (const line of node.comments) {
    const range = /^Range:\s*(-?[\d.]+)\s*~\s*(-?[\d.]+)/i.exec(line);
    if (range?.[1] !== undefined && range[2] !== undefined) {
      field.min = Number(range[1]);
      field.max = Number(range[2]);
      continue;
    }
    const allowed = /^Allowed Values:\s*(.+)$/i.exec(line);
    if (allowed?.[1]) {
      field.options = allowed[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    const def = /^Default:\s*(.+)$/i.exec(line);
    if (def?.[1]) {
      field.default = def[1].trim();
      continue;
    }
    description.push(line);
  }

  if (description.length > 0) field.description = description.join(" ");
  return field;
}

/** The whole file as form fields, in file order. */
export function schemaFromConfig(parsed: ParsedConfig): ConfigFieldSchema[] {
  return parsed.nodes.map(schemaFromNode);
}
