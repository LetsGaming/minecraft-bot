/**
 * Thin fetch helpers — every call carries the session cookie, 401
 * surfaces as `unauthorized` so App.vue can show the login screen.
 */
import { ApiErrorCode } from "@mcbot/schema";

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
  }
}

/**
 * A non-2xx answer from the dashboard backend. Callers branch on `status` and
 * `code` (see ApiErrorCode in @mcbot/schema), never on the message text.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** The optimistic-concurrency check failed: someone else saved first. */
export function isConflict(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.code === ApiErrorCode.Conflict || err.status === 409)
  );
}

/** The backend's per-problem validation list, when the failure carried one. */
export function validationErrors(err: unknown): string[] {
  if (!(err instanceof ApiError) || typeof err.body !== "object" || err.body === null) {
    return [];
  }
  const list = (err.body as { errors?: unknown }).errors;
  return Array.isArray(list) ? list.filter((e): e is string => typeof e === "string") : [];
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    let code: string | undefined;
    let parsed: unknown;
    try {
      const body = await res.json();
      parsed = body;
      // Prefer a human message; fall back to a validation list, then the body.
      detail =
        body.error ??
        body.message ??
        body.detail ??
        JSON.stringify(body.errors ?? body);
      if (typeof body.code === "string") code = body.code;
    } catch {
      /* keep status */
    }
    throw new ApiError(res.status, detail, code, parsed);
  }
  // Responses come from this app's own backend, whose payloads are the shared
  // contract types in @mcbot/schema (imported below). Asserting the caller's T
  // reflects that contract — the frontend and backend share one definition, so
  // a drift is a compile error there, not a silent mis-shape here.
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(path, { credentials: "same-origin" }).then((r) => handle<T>(r));
}

export function apiSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((r) => handle<T>(r));
}

// ── Shapes shared with the backend (@mcbot/schema — one definition,
// both sides import it, drift is impossible) ──
export type {
  BackupFileInfo,
  BackupFileIndex,
  ServerStatus,
  StatusResponse,
  AuditEntry,
  ConfigResponse,
  ConfigWriteRequest,
  ConfigWriteConflict,
} from "@mcbot/schema";

// Runtime values, not just types: the views switch on these, and comparing
// against string literals in each component is how the states drift apart.
// Re-exported as values, not just types: the views switch on these, and
// comparing against string literals in each component is how the set of
// states drifts apart. The `const` and the type share a name, so this one
// line carries both.
export { ServerState, RconState, WrapperState, HealthSource } from "@mcbot/schema";

// The capability contract, as values: the views decide what to render from
// the caller's grants, and comparing against string literals per component is
// exactly how the set would drift from the backend's.
export {
  GRANTABLE_CAPABILITIES,
  IRREVERSIBLE_CAPABILITIES,
  ALL_SERVERS,
} from "@mcbot/schema";
export type { Capability, GrantableCapability } from "@mcbot/schema";
// `export ... from` re-exports without binding locally, and MeResponse below
// uses the name — so it needs a real import as well.
import type { GrantableCapability, InstalledMods as BaseInstalledMods } from "@mcbot/schema";

// ── Dashboard-specific shapes (not in @mcbot/schema — web-only) ──
export interface MeResponse {
  uid: string;
  tag: string;
  sysadmin: boolean;
  guildCount: number;
  /**
   * What the caller may do, keyed by server id plus "*" for fleet-wide
   * grants. A sysadmin gets every capability on every server, so the views
   * need no separate branch for them.
   */
  capabilities: Record<string, GrantableCapability[]>;
}
export interface InviteResponse {
  url: string;
}

// ── Guided guild setup (phase 4) — mirror discordRest.ts on the server ──
export interface SetupGuild {
  id: string;
  name: string;
  icon: string | null;
  manageable: boolean;
}
export interface SetupChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parentId: string | null;
}
export interface SetupRole {
  id: string;
  name: string;
  color: number;
  position: number;
  assignable: boolean;
}

// ── Mods tab (install / update / remove + Modrinth browse) ──
export type ModEnvironment = "server" | "client" | "both" | "optional" | "unknown";

export type {
  InstalledMod,
  ModUpdateCheck,
  ModAddResult,
  ModRemoveResult,
  ModApplyResult,
  ModToggleResult,
  ModCompatJob,
  ModCompatMod,
  ModCompatStarted,
} from "@mcbot/schema";
export interface InstalledMods extends BaseInstalledMods {
  stale?: boolean;
  /** The wrapper can check another Minecraft version. */
  compat?: boolean;
}
export interface ModSearchHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  follows: number;
  iconUrl: string | null;
  categories: string[];
  gameVersions: string[];
  environment: ModEnvironment;
  pageUrl: string;
  installed: boolean;
}
export interface ModSearchResult {
  hits: ModSearchHit[];
  offset: number;
  limit: number;
  totalHits: number;
}
export interface ModVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  downloads: number;
  primaryFilename: string | null;
}
export interface ModProjectDetail {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  environment: ModEnvironment;
  iconUrl: string | null;
  downloads: number;
  followers: number;
  gameVersions: string[];
  loaders: string[];
  pageUrl: string;
  versions: ModVersion[];
  installed: boolean;
  installedVersionId: string | null;
}
