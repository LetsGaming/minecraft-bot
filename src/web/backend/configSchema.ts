/**
 * Read the generated config JSON schema.
 *
 * Uses getRootDir() (walks up to the workspaces package.json) rather than
 * counting "../" from import.meta.url: the number of levels differs between
 * the source tree (src/web/backend/routes/*.ts) and the compiled/Docker tree
 * (src/web/dist/backend/routes/*.js), so "../" counting resolves correctly in
 * vitest but points one level too shallow in the built image. getRootDir is
 * the same in both — the schema sits at the project root (Dockerfile COPY).
 */
import fs from "fs";
import path from "path";
import { getRootDir } from "@mcbot/core/utils/utils.js";

export interface RawJsonSchema {
  definitions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The parsed config schema, or null if it hasn't been generated. */
export function readConfigSchema(): RawJsonSchema | null {
  try {
    const schemaPath = path.join(getRootDir(), "config.schema.json");
    return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as RawJsonSchema;
  } catch {
    return null;
  }
}
