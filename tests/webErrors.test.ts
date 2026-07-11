/**
 * QUAL-10 / QUAL-11 — the central error handler and the typed Discord error.
 *
 * The handler is exercised on a bare Fastify instance with routes that throw,
 * so each branch (typed HttpError, framework 4xx, unexpected fault) is pinned
 * independently of the full server assembly.
 */
import { describe, it, expect } from "vitest";

import Fastify, { type FastifyInstance } from "fastify";
import {
  registerErrorHandler,
  HttpError,
  Conflict,
  ValidationFailed,
  Forbidden,
} from "../src/web/backend/errors.js";
import { DiscordApiError } from "../src/web/backend/discordRest.js";

function appThatThrows(err: unknown): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.get("/boom", async () => {
    throw err;
  });
  return app;
}

describe("registerErrorHandler (QUAL-10)", () => {
  it("renders a typed HttpError at its status with a consistent body", async () => {
    const res = await appThatThrows(
      new Conflict("stale", { currentHash: "h1" }),
    ).inject({ url: "/boom" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "stale", currentHash: "h1" });
  });

  it("keeps the extra fields of a validation failure", async () => {
    const res = await appThatThrows(new ValidationFailed(["a", "b"])).inject({
      url: "/boom",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "Validation failed", errors: ["a", "b"] });
  });

  it("surfaces a client-safe message for a bare HttpError", async () => {
    const res = await appThatThrows(new Forbidden("You don't manage that guild.")).inject(
      { url: "/boom" },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("You don't manage that guild.");
  });

  it("does NOT leak an unexpected error's message (generic 500)", async () => {
    const res = await appThatThrows(
      new Error("EACCES: /srv/secret/path/config.json"),
    ).inject({ url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal server error" });
    expect(res.body).not.toContain("secret");
  });

  it("honors a framework client error's status and message", async () => {
    const res = await appThatThrows(
      Object.assign(new Error("Bad body"), { statusCode: 400 }),
    ).inject({ url: "/boom" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Bad body" });
  });

  it("HttpError.body merges extra over the error field", () => {
    expect(new HttpError(418, "teapot", { foo: 1 }).body()).toEqual({
      error: "teapot",
      foo: 1,
    });
  });
});

describe("DiscordApiError (QUAL-11)", () => {
  it("carries a typed reason + upstream status instead of an error string", () => {
    const rate = new DiscordApiError("slow down", "rate-limit", 429, 5);
    expect(rate.reason).toBe("rate-limit");
    expect(rate.status).toBe(429);
    expect(rate.retryAfterSeconds).toBe(5);

    const http = new DiscordApiError("nope", "http", 403);
    expect(http.reason).toBe("http");
    expect(http.status).toBe(403);

    const noToken = new DiscordApiError("no token", "no-token");
    expect(noToken.reason).toBe("no-token");
    expect(noToken.status).toBeNull();
  });
});
