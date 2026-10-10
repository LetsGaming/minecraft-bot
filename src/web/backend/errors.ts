/**
 * Typed HTTP failures for the dashboard (QUAL-10, 2026-07 audit).
 *
 * A route can `throw` one of these instead of hand-building
 * `reply.code(4xx).send({ error })`; the central error handler
 * (registerErrorHandler) maps each to its status and a consistent body. Their
 * messages are deliberate and client-safe — the handler surfaces them —
 * whereas any *other* thrown error is rendered as a generic 500 with the
 * detail logged, never leaked (backend-apis.md: "one error handler that maps
 * typed failures").
 */
import type { FastifyInstance } from "fastify";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { ApiErrorCode } from "@mcbot/schema";

export class HttpError extends Error {
  readonly statusCode: number;
  /** Extra fields merged into the response body (e.g. a validation list). */
  readonly extra: Record<string, unknown> | undefined;
  /** Stable machine-readable reason (e.g. ApiErrorCode.Conflict); clients branch on this, never on the message. */
  readonly code: string | undefined;

  constructor(
    statusCode: number,
    message: string,
    extra?: Record<string, unknown>,
    code?: string,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.extra = extra;
    this.code = code;
  }

  /** The response body: a consistent `{ error, code? }` plus any extra fields. */
  body(): Record<string, unknown> {
    return {
      error: this.message,
      ...(this.code === undefined ? {} : { code: this.code }),
      ...(this.extra ?? {}),
    };
  }
}

export class BadRequest extends HttpError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(400, message, extra, ApiErrorCode.BadRequest);
  }
}

export class Unauthorized extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, message, undefined, ApiErrorCode.Unauthorized);
  }
}

export class Forbidden extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message, undefined, ApiErrorCode.Forbidden);
  }
}

export class NotFound extends HttpError {
  constructor(message = "Not found") {
    super(404, message, undefined, ApiErrorCode.NotFound);
  }
}

export class Conflict extends HttpError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(409, message, extra, ApiErrorCode.Conflict);
  }
}

export class ValidationFailed extends HttpError {
  constructor(errors: string[]) {
    super(422, "Validation failed", { errors }, ApiErrorCode.ValidationFailed);
  }
}

export class TooManyRequests extends HttpError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(
      429,
      message,
      retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
      ApiErrorCode.RateLimited,
    );
  }
}

export class ServiceUnavailable extends HttpError {
  constructor(message: string) {
    super(503, message, undefined, ApiErrorCode.Unavailable);
  }
}

export class BadGateway extends HttpError {
  constructor(message = "Upstream error") {
    super(502, message, undefined, ApiErrorCode.BadGateway);
  }
}

/**
 * Register the one error handler that renders thrown failures (QUAL-10):
 *   - a typed HttpError renders at its status with a consistent body,
 *   - a framework client error (4xx, e.g. body parse) keeps its safe message,
 *   - anything else is an unexpected fault → generic 500, detail logged, never
 *     leaked to the client.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send(err.body());
    }
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      const message = errMsg(err);
      return reply.code(statusCode).send({ error: message });
    }
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error("web", `Unhandled error on ${req.method} ${req.url}: ${detail}`);
    return reply.code(500).send({ error: "Internal server error" });
  });
}
