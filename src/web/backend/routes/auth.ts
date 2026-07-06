/**
 * Discord OAuth2 login flow + the session probe — the only routes that
 * live OUTSIDE the requireAdminSession gate (they are how you get a
 * session in the first place). The crypto and cookie mechanics stay in
 * ../auth.ts; this module is just the route wiring. Split out of
 * server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import type { FastifyInstance } from "fastify";
import {
  buildAuthorizeUrl,
  verifyState,
  exchangeCode,
  webAdminIds,
  sessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
} from "../auth.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/auth/login", async (_req, reply) => {
    const { url } = buildAuthorizeUrl();
    return reply.redirect(url);
  });

  app.get("/auth/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !verifyState(state)) {
      return reply.code(400).send("Invalid OAuth state — try logging in again.");
    }
    const user = await exchangeCode(code);
    if (!user) return reply.code(502).send("Discord OAuth exchange failed.");
    if (!webAdminIds().has(user.id)) {
      return reply
        .code(403)
        .send(
          "This Discord account is not in any adminUsers list. " +
            "Role-based admin entries work in Discord only — the dashboard needs your user ID listed.",
        );
    }
    setSessionCookie(reply, user);
    return reply.redirect("/");
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const session = sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { uid: session.uid, tag: session.tag };
  });
}
