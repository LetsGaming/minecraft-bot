/**
 * Structural config validation, against the generated JSON Schema.
 *
 * The repo had two descriptions of the same shape: `config.schema.json`,
 * generated from `RawBotConfig`, and ~700 lines of hand-written `typeof`
 * checks in configValidation.ts. They drifted — the hand copy missed
 * whole blocks — and each gap had to be found by a user hitting it.
 * Types, requiredness and bounds now come from the schema; only the
 * checks a JSON Schema genuinely cannot express stay hand-written
 * (see configValidation.ts).
 *
 * The schema is read from disk once and compiled once. That is I/O, so
 * it lives here rather than in configValidation.ts, which stays a pure
 * function of its argument — the schema is a constant of the program,
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

export interface SchemaCheckResult {
  /** Blocking problems, already formatted as "  - path: message". */
  errors: string[];
  /**
   * Unknown properties. A warning, not an error: a config written for a
   * newer version, or carrying an editor's `$schema` key, must still
   * boot. The hand-written validator ignored unknown keys entirely, so
   * warning about them is already stricter than before.
   */
  warnings: string[];
  /**
   * True when the schema file could not be read or compiled. Callers
   * fall back to the semantic checks alone rather than refusing to
   * start — a missing generated artifact is a packaging fault, and
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
    // allErrors: report every problem in one pass — an operator fixing a
    // config wants the whole list, not one error per restart.
    const ajv = new Ajv({ allErrors: true, strict: false });
    compiled = ajv.compile(schema);
    return compiled;
  } catch {
    compileFailed = true;
    return null;
  }
}

/** "/guilds/123/notifications/events/0" → "guilds.123.notifications.events[0]" */
export function formatInstancePath(instancePath: string): string {
  if (instancePath === "") return "config root";
  return instancePath
    .split("/")
    .filter(Boolean)
    .reduce((acc, segment) => {
      // A numeric segment is an array index; everything else is a key.
      // (Object keys here are server/guild IDs, which are numeric strings
      // for guilds — so only index into what the path says is an array.)
      const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      return acc === "" ? decoded : `${acc}.${decoded}`;
    }, "");
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
  // schema about them — `$schema` is written by the setup wizard for
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
      errors: [`  - config: schema check failed (${errMsg(err)})`],
      warnings: [],
      unavailable: false,
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const err of validate.errors ?? []) {
    // A failing branch of anyOf/oneOf reports both the branch errors and
    // the union error; the union line alone is noise without them.
    if (err.keyword === "anyOf" || err.keyword === "oneOf") continue;
    const line = formatError(err);
    if (err.keyword === "additionalProperties") warnings.push(line);
    else errors.push(line);
  }

  // Ajv can report the same spot twice (e.g. type + enum on one field).
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    unavailable: false,
  };
}
