/**
 * Rate limiting for the dashboard HTTP surface, reusing the bot's token-bucket
 * limiter (core/utils/rateLimiter.ts) the one shared utility, not a
 * per-route copy (backend-apis.md; SEC-02, 2026-07 audit).
 *
 * Scope, only the expensive/abusable surface is limited:
 *   /auth/*            keyed by client IP. No session exists yet at login, and
 *                      the OAuth callback fans out to three Discord calls per
 *                      hit, so unauthenticated login/callback traffic is capped.
 *   mutating /api/*    (POST/PUT/PATCH/DELETE) keyed by the session uid, a
 *                      logged-in user, falling back to IP when unauthenticated.
 *
 * Read-only GETs are left unlimited. Buckets self-prune. This is per-process:
 * the dashboard is a single instance bound to loopback behind a reverse proxy
 * (see docker-compose.yml), so an in-process limiter is the right scope;
 * req.ip honors X-Forwarded-For only for the proxies named in webui.trustProxy.
 */
import { MS } from "@mcbot/schema";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createRateLimiter,
  type RateLimiter,
} from "@mcbot/core/utils/rateLimiter.js";
import { sessionFromRequest } from "./auth/auth.js";

const MAX_BUCKETS = 5_000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function registerRateLimiting(app: FastifyInstance): void {
  // Limiters are created per server instance (not module-level) so their
  // lifecycle matches the server's, in production one buildServer() means one
  // set of buckets; in tests each instance starts fresh.
  //
  // Interactive login is rare per human; keep it generous but bounded so the
  // callback (three outbound Discord calls each) can't be hammered. Config
  // edits and server actions arrive in small human bursts, so a per-user write
  // budget well above normal use still stops scripted abuse.
  const authLimiter = createRateLimiter({ capacity: 10, windowMs: MS.minute, maxBuckets: MAX_BUCKETS });
  const apiWriteLimiter = createRateLimiter({ capacity: 30, windowMs: MS.minute, maxBuckets: MAX_BUCKETS });
  // Coarse per-address ceiling in front of the per-user buckets: many identities
  // from one source, or one identity replayed from many sources, cannot multiply
  // the budget past it. Several times the per-user limit so a shared proxy
  // address still serves a handful of real users.
  const ipCeilingLimiter = createRateLimiter({ capacity: 150, windowMs: MS.minute, maxBuckets: MAX_BUCKETS });

  interface Target {
    /** Checked first; every request from one address draws from it. */
    ceiling?: { limiter: RateLimiter; key: string };
    limiter: RateLimiter;
    key: string;
  }

  /**
   * Pick the buckets for a request, or null to leave it unlimited. Only a
   * verified session (valid signature, unexpired, current epoch) selects a
   * per-user bucket; anything else, forged or rotated cookies included, falls
   * back to the address. Pre-auth routes are always keyed by address.
   */
  const targetFor = (req: FastifyRequest): Target | null => {
    const path = req.url.split("?")[0] ?? "";
    if (path.startsWith("/auth/")) {
      return { limiter: authLimiter, key: `ip:${req.ip}` };
    }
    if (path.startsWith("/api/") && MUTATING_METHODS.has(req.method)) {
      const uid = sessionFromRequest(req)?.uid;
      if (!uid) return { limiter: apiWriteLimiter, key: `ip:${req.ip}` };
      return {
        ceiling: { limiter: ipCeilingLimiter, key: `ip:${req.ip}` },
        limiter: apiWriteLimiter,
        key: `uid:${uid}`,
      };
    }
    return null;
  };

  // onRequest: reject before body parsing / any work is done.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const target = targetFor(req);
    if (!target) return;
    // The narrower limiter decides first; the shared address ceiling only
    // counts requests it admitted, so one user's rejected flood cannot drain
    // the budget of everyone else behind the same address.
    const denied = !target.limiter.consumeToken(target.key, req.ip)
      ? target
      : target.ceiling && !target.ceiling.limiter.consumeToken(target.ceiling.key, req.ip)
        ? target.ceiling
        : null;
    if (!denied) return;

    reply
      .header("retry-after", String(denied.limiter.cooldownSeconds(denied.key, req.ip)))
      .code(429)
      .send({ error: "Too many requests — slow down and try again shortly." });
    return reply;
  });
}
