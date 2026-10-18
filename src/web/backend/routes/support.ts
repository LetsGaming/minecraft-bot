/**
 * Scaffolding shared by the host-scope routes: the server lookup, the one
 * "operation failed" message, the wrapper-call guard and the audited-action
 * helper. Authorization is separate and earlier (auth/capabilities.ts).
 */
import type { FastifyRequest } from "fastify";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { logFields } from "@mcbot/core/utils/logSafe.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { currentSession, type Session } from "../auth/auth.js";
import { BadGateway, BadRequest, HttpError, NotFound } from "../errors.js";
import { FILE_ID_RE } from "./schemas.js";

export type ConfiguredServer = NonNullable<ReturnType<typeof getServerInstance>>;

/**
 * The one client-facing text for an internal failure. These routes run in the
 * web process, so the detail is in the web logs (`docker compose logs web`),
 * never in the bot's.
 */
export const OPERATION_FAILED =
  "The operation failed unexpectedly. Check the dashboard (web) logs for details.";

export function serverNotFound(id: string): NotFound {
  return new NotFound(`No server named "${id}" is configured.`);
}

export function requireServer(id: string): ConfiguredServer {
  const server = getServerInstance(id);
  if (!server) throw serverNotFound(id);
  return server;
}

/** A file id as the wrapper's index produced it; anything else is refused before it is sent on. */
export function requireFileId(fileId: string, what: string): string {
  if (!FILE_ID_RE.test(fileId)) throw new BadRequest(`Invalid ${what} id.`);
  return fileId;
}

export interface WrapperCallOptions {
  /** Client-facing text for the 502; defaults to {@link OPERATION_FAILED}. */
  message?: string;
  /** Turn a known failure into its own typed error; return null to treat it as an outage. */
  translate?: (err: unknown) => HttpError | null;
}

/**
 * Run a call that reaches the wrapper (or another upstream). A typed
 * {@link HttpError} thrown inside passes through untouched; anything else is
 * logged with its detail and surfaces as one fixed 502, so a path or stderr
 * fragment never reaches the browser.
 */
export async function wrapperCall<T>(
  label: string,
  context: Record<string, unknown>,
  call: () => Promise<T>,
  options: WrapperCallOptions = {},
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const translated = options.translate?.(err);
    if (translated) throw translated;
    log.error("web", `${label} failed ${logFields({ ...context, detail: errMsg(err) })}`);
    throw new BadGateway(options.message ?? OPERATION_FAILED);
  }
}

export interface AuditEntry {
  action: string;
  server?: string;
  detail?: string;
}

/** Record one dashboard action against a known session. */
export async function auditAction(session: Session, entry: AuditEntry): Promise<void> {
  await recordAdminAction({
    action: `${entry.action} (dashboard)`,
    ...(entry.server === undefined ? {} : { server: entry.server }),
    by: session.tag,
    byId: session.uid,
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  });
}

/**
 * Record a dashboard action for the request's session and hand the session
 * back. Call it before the action runs: what was attempted is the fact people
 * ask about afterwards.
 */
export async function auditedAction(req: FastifyRequest, entry: AuditEntry): Promise<Session> {
  const session = currentSession(req);
  await auditAction(session, entry);
  return session;
}
