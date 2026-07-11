/**
 * Rate limiting for the dashboard HTTP surface, reusing the bot's token-bucket
 * limiter (core/utils/rateLimiter.ts) — the one shared utility, not a
 * per-route copy (backend-apis.md; SEC-02, 2026-07 audit).
 *
 * Scope — only the expensive/abusable surface is limited:
 *   /auth/*            keyed by client IP. No session exists yet at login, and
 *                      the OAuth callback fans out to three Discord calls per
 *                      hit, so unauthenticated login/callback traffic is capped.
 *   mutating /api/*    (POST/PUT/PATCH/DELETE) keyed by the session uid — a
 *                      logged-in user — falling back to IP when unauthenticated.
 *
 * Read-only GETs are left unlimited. Buckets self-prune. This is per-process:
 * the dashboard is a single instance bound to loopback behind a reverse proxy
 * (see docker-compose.yml), so an in-process limiter is the right scope;
 * trustProxy is on, so req.ip honors X-Forwarded-For from that proxy.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createRateLimiter,
  type RateLimiter,
} from "@mcbot/core/utils/rateLimiter.js";
import { sessionFromRequest } from "./auth.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function registerRateLimiting(app: FastifyInstance): void {
  // Limiters are created per server instance (not module-level) so their
  // lifecycle matches the server's — in production one buildServer() means one
  // set of buckets; in tests each instance starts fresh.
  //
  // Interactive login is rare per human; keep it generous but bounded so the
  // callback (three outbound Discord calls each) can't be hammered. Config
  // edits and server actions arrive in small human bursts, so a per-user write
  // budget well above normal use still stops scripted abuse.
  const authLimiter = createRateLimiter({ capacity: 10, windowMs: 60_000 });
  const apiWriteLimiter = createRateLimiter({ capacity: 30, windowMs: 60_000 });

  /** Pick the limiter + bucket key for a request, or null to leave it unlimited. */
  const limiterFor = (
    req: FastifyRequest,
  ): { limiter: RateLimiter; key: string } | null => {
    const path = req.url.split("?")[0] ?? "";
    if (path.startsWith("/auth/")) {
      return { limiter: authLimiter, key: `ip:${req.ip}` };
    }
    if (path.startsWith("/api/") && MUTATING_METHODS.has(req.method)) {
      const uid = sessionFromRequest(req)?.uid;
      return {
        limiter: apiWriteLimiter,
        key: uid ? `uid:${uid}` : `ip:${req.ip}`,
      };
    }
    return null;
  };

  // onRequest: reject before body parsing / any work is done.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const target = limiterFor(req);
    if (!target) return;
    if (target.limiter.consumeToken(target.key)) return;

    reply
      .header("retry-after", String(target.limiter.cooldownSeconds(target.key)))
      .code(429)
      .send({ error: "Too many requests — slow down and try again shortly." });
    return reply;
  });
}
