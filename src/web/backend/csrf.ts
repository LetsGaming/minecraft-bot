/**
 * AUD-017: refuse cross-site writes to the API.
 *
 * The session cookie is SameSite=Lax, which stops other *sites* but not
 * another origin on the same site: a different port on the same LAN host,
 * or a sibling subdomain. A form there can POST `text/plain` with the
 * user's cookie, and several mutating routes take no body at all (restart,
 * rollback, restore).
 *
 * So a mutating /api request from a browser must say it came from this
 * origin: `Sec-Fetch-Site: same-origin` where the browser sends it, else an
 * `Origin` whose host is the one the request was addressed to (or the
 * configured public URL, behind a proxy that rewrites Host). A request with
 * neither header is not from a browser (curl, scripts, tests) and cannot
 * carry someone else's cookie by accident, so it passes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { publicBaseUrl } from "./auth/auth.js";
import { Forbidden } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function isCrossSiteWrite(req: FastifyRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  if (!req.url.startsWith("/api/")) return false;

  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site !== "same-origin";

  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  const from = hostOf(origin);
  if (from === null) return true; // "null" origin: sandboxed frame, file://
  const addressed = req.headers.host?.toLowerCase();
  return from !== addressed && from !== hostOf(publicBaseUrl());
}

export function registerCsrfGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    if (isCrossSiteWrite(req)) {
      throw new Forbidden("Cross-site request refused.");
    }
  });
}
