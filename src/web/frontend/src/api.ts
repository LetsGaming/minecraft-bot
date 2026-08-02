/**
 * Thin fetch helpers — every call carries the session cookie, 401
 * surfaces as `unauthorized` so App.vue can show the login screen.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      // Prefer a human message; fall back to a validation list, then the body.
      detail =
        body.error ??
        body.message ??
        body.detail ??
        JSON.stringify(body.errors ?? body);
    } catch {
      /* keep status */
    }
    throw new Error(detail);
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
  method: "POST" | "PUT",
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
