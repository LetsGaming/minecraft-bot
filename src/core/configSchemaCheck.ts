/**
 * Structural config validation, against the generated JSON Schema.
 *
 * The repo had two descriptions of the same shape: `config.schema.json`,
 * generated from `RawBotConfig`, and ~700 lines of hand-written `typeof`
 * checks in configValidation.ts. They drifted, the hand copy missed
 * whole blocks, and each gap had to be found by a user hitting it.
 * Types, requiredness and bounds now come from the schema; only the
 * checks a JSON Schema genuinely cannot express stay hand-written
 * (see configValidation.ts).
 *
 * The schema is read from disk once and compiled once. That is I/O, so
 * it lives here rather than in configValidation.ts, which stays a pure
 * function of its argument, the schema is a constant of the program,
 * not an input.
 */
import fs from "fs";
import path from "path";
// Named import, not default: ajv is CJS, and under Node16 resolution its
// default export lands as the module namespace rather than the class.
import {
  Ajv,
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from "ajv";
import { getRootDir } from "./utils/paths.js";
import { errMsg } from "./utils/error.js";

/** One schema violation: where, which rule, and the rendered line. */
export interface SchemaIssue {
  /** Instance path segments, e.g. ["guilds", "123", "notifications", "events", "0"]. */
  path: string[];
  /** The Ajv keyword that failed (`type`, `enum`, `additionalProperties`, ...). */
  keyword: string;
  params: Record<string, unknown>;
  /** The "  - path: message" line this project prints. */
  line: string;
}

export interface SchemaCheckResult {
  /** Blocking problems. */
  errors: SchemaIssue[];
  /**
   * Unknown properties. A warning, not an error: a config written for a
   * newer version, or carrying an editor's `$schema` key, must still
   * boot. The hand-written validator ignored unknown keys entirely, so
   * warning about them is already stricter than before.
   */
  warnings: SchemaIssue[];
  /**
   * True when the schema file could not be read or compiled. Callers
   * fall back to the semantic checks alone rather than refusing to
   * start, a missing generated artifact is a packaging fault, and
   * bricking the bot over it would be the worse failure.
   */
  unavailable: boolean;
}

/** Keys tools add to a config file that are not part of the config. */
const TOOL_KEYS = new Set(["$schema"]);

let compiled: ValidateFunction | null = null;
let compileFailed = false;

/** Exposed for tests, which swap the schema on disk. */
export function _resetSchemaCacheForTesting(): void {
  compiled = null;
  compileFailed = false;
}

function getValidator(): ValidateFunction | null {
  if (compiled) return compiled;
  if (compileFailed) return null;
  try {
    const schemaPath = path.join(getRootDir(), "config.schema.json");
    // The file is this project's own build artifact (scripts/generate-schema
    // .mjs), not user input; Ajv rejects it loudly if it is not a schema.
    const schema = JSON.parse(
      fs.readFileSync(schemaPath, "utf-8"),
    ) as AnySchemaObject;
    // allErrors: report every problem in one pass, an operator fixing a
    // config wants the whole list, not one error per restart.
    const ajv = new Ajv({ allErrors: true, strict: false });
    compiled = ajv.compile(schema);
    return compiled;
  } catch {
    compileFailed = true;
    return null;
  }
}

/** "/guilds/123/events/0" → ["guilds", "123", "events", "0"] (JSON-Pointer escapes decoded). */
function instancePathSegments(instancePath: string): string[] {
  return instancePath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * "/guilds/123/notifications/events/0" → "guilds.123.notifications.events.0".
 * Array indexes and object keys render alike: guild IDs are numeric
 * strings, so the path alone cannot tell them apart.
 */
export function formatInstancePath(instancePath: string): string {
  if (instancePath === "") return "config root";
  return instancePathSegments(instancePath).join(".");
}

/** One Ajv error → the "  - path: message" line this project prints. */
function formatError(err: ErrorObject): string {
  const where = formatInstancePath(err.instancePath);

  switch (err.keyword) {
    case "required": {
      const missing = (err.params as { missingProperty: string })
        .missingProperty;
      const prefix = where === "config root" ? "" : `${where}.`;
      return `  - ${prefix}${missing}: required`;
    }
    case "additionalProperties": {
      const extra = (err.params as { additionalProperty: string })
        .additionalProperty;
      const prefix = where === "config root" ? "" : `${where}.`;
      return `  - ${prefix}${extra}: unknown option (ignored)`;
    }
    case "type":
      return `  - ${where}: must be ${(err.params as { type: string }).type}`;
    case "enum": {
      const allowed = (err.params as { allowedValues: unknown[] }).allowedValues;
      return `  - ${where}: must be one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}`;
    }
    case "minimum":
    case "exclusiveMinimum":
    case "maximum":
    case "exclusiveMaximum": {
      const limit = (err.params as { limit: number }).limit;
      const comparison = (err.params as { comparison: string }).comparison;
      return `  - ${where}: must be ${comparison} ${limit}`;
    }
    case "pattern":
      return `  - ${where}: must match ${(err.params as { pattern: string }).pattern}`;
    default:
      return `  - ${where}: ${err.message ?? "is invalid"}`;
  }
}

/**
 * Check a candidate against the generated schema.
 *
 * Anything not an object short-circuits: Ajv would report it, but the
 * root-shape message this project already prints is the clearer one.
 */
export function checkAgainstSchema(candidate: unknown): SchemaCheckResult {
  const validate = getValidator();
  if (!validate) {
    return { errors: [], warnings: [], unavailable: true };
  }

  // Strip tool-only keys before validating, rather than teaching the
  // schema about them, `$schema` is written by the setup wizard for
  // editor autocompletion and is not part of the config contract.
  const subject =
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? Object.fromEntries(
          Object.entries(candidate as Record<string, unknown>).filter(
            ([key]) => !TOOL_KEYS.has(key),
          ),
        )
      : candidate;

  try {
    if (validate(subject)) {
      return { errors: [], warnings: [], unavailable: false };
    }
  } catch (err) {
    return {
      errors: [
        {
          path: [],
          keyword: "exception",
          params: {},
          line: `  - config: schema check failed (${errMsg(err)})`,
        },
      ],
      warnings: [],
      unavailable: false,
    };
  }

  const all = validate.errors ?? [];
  const errors: SchemaIssue[] = [];
  const warnings: SchemaIssue[] = [];
  const seen = new Set<string>();
  const consumed = new Set<ErrorObject>();

  // Ajv lists a union's branch errors before the union error, so unions are
  // summarized first to know which branch errors to drop.
  const unionIssues = all
    .filter(isUnion)
    .map((u) => summarizeUnion(u, all, consumed))
    .filter((i): i is SchemaIssue => i !== null);
  const plain = all
    .filter((e) => !isUnion(e) && !consumed.has(e))
    .map((e) => toIssue(e, formatError(e)));

  for (const issue of [...plain, ...unionIssues]) {
    // Ajv can report the same spot twice (e.g. type + enum on one field).
    const dedupeKey = `${issue.keyword}\u0000${issue.line}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    (issue.keyword === "additionalProperties" ? warnings : errors).push(issue);
  }

  return { errors, warnings, unavailable: false };
}

function isUnion(err: ErrorObject): boolean {
  return err.keyword === "anyOf" || err.keyword === "oneOf";
}

function toIssue(err: ErrorObject, line: string): SchemaIssue {
  const path = instancePathSegments(err.instancePath);
  const params = err.params as Record<string, unknown>;
  if (typeof params["missingProperty"] === "string") path.push(params["missingProperty"]);
  if (typeof params["additionalProperty"] === "string") path.push(params["additionalProperty"]);
  return { path, keyword: err.keyword, params, line };
}

/**
 * A failing anyOf/oneOf reports the union itself plus every branch's own
 * failure, which for a field like `string | string[]` reads as two
 * contradictory "must be" lines. When every branch failed on the type alone,
 * collapse them into one line; otherwise return null so the branch errors
 * (which say something specific) are reported on their own.
 */
function summarizeUnion(
  union: ErrorObject,
  all: ErrorObject[],
  consumed: Set<ErrorObject>,
): SchemaIssue | null {
  const prefix = `${union.schemaPath}/`;
  const branches = all.filter((e) => e !== union && e.schemaPath.startsWith(prefix));
  const onlyTypeFailures =
    branches.length > 0 &&
    branches.every((e) => e.keyword === "type" && e.instancePath === union.instancePath);
  if (!onlyTypeFailures) return null;
  const types = [
    ...new Set(
      branches.flatMap((e) => [(e.params as { type: string | string[] }).type].flat()),
    ),
  ];
  for (const b of branches) consumed.add(b);
  const where = formatInstancePath(union.instancePath);
  return toIssue(union, `  - ${where}: must be ${types.join(" or ")}`);
}
