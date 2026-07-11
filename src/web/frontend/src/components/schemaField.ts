/**
 * Pure schema helpers for the config form's field renderer (SchemaField.vue).
 *
 * Kept dependency-free (no Vue) so the decisions that drive the UI — which
 * control a schema node maps to, and resolving `$ref`s against the schema's
 * definitions — are unit-tested directly. The generated schema uses `$ref`
 * both at the root (topRef) and for item/definition nodes (e.g. an events
 * array whose items reference NotificationEvent), so resolving refs is what
 * lets the form show real fields instead of falling back to raw JSON
 * (QUAL-08, 2026-07 audit).
 */

export interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  items?: unknown;
  $ref?: string;
}

export type Definitions = Record<string, unknown> | undefined;

/** The controls the form can render. Everything else falls back to JSON. */
export type FieldKind =
  | "boolean"
  | "enum"
  | "string"
  | "number"
  | "object"
  | "multiselect" // array of a fixed enum (e.g. notification events)
  | "chips" // array of free-form strings (e.g. adminUsers, allowedServers)
  | "json";

/** Follow `#/definitions/*` refs to the concrete node (cycle-guarded). */
export function derefNode(node: unknown, defs: Definitions): JsonSchemaNode {
  let n = (node ?? {}) as JsonSchemaNode;
  let guard = 0;
  while (n && typeof n.$ref === "string" && guard++ < 20) {
    const key = /^#\/definitions\/(.+)$/.exec(n.$ref)?.[1];
    n = (key && defs && defs[key] ? defs[key] : {}) as JsonSchemaNode;
  }
  return n;
}

function firstType(node: JsonSchemaNode): string | undefined {
  return Array.isArray(node.type) ? node.type[0] : node.type;
}

/** Which control to render for a (already-dereferenced) schema node. */
export function classifyField(node: JsonSchemaNode, defs: Definitions): FieldKind {
  if ((node.enum?.length ?? 0) > 0) return "enum";
  const type = firstType(node);
  if (type === "boolean") return "boolean";
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "object" && node.properties) return "object";
  if (type === "array") {
    const items = derefNode(node.items, defs);
    if ((items.enum?.length ?? 0) > 0) return "multiselect";
    if (firstType(items) === "string") return "chips";
  }
  return "json";
}

/** Options for a fixed-enum array field's multiselect. */
export function arrayEnumOptions(
  node: JsonSchemaNode,
  defs: Definitions,
): { value: unknown; label: string }[] {
  const items = derefNode(node.items, defs);
  return (items.enum ?? []).map((v) => ({ value: v, label: String(v) }));
}
