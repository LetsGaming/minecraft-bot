/**
 * Required-configuration check + setup page for the dashboard.
 *
 * The dashboard reads two secrets from the environment that it cannot run
 * without — WEBUI_SESSION_SECRET (signs the login cookie) and
 * WEBUI_CLIENT_SECRET (the Discord OAuth2 secret used at the callback). These
 * used to be read lazily, so a missing one surfaced as an opaque 500 on the
 * first request (the server-side log had the reason, but the operator just saw
 * a broken page). Instead we check them up front and, if any are missing, log
 * loudly and serve a clear setup page telling the operator exactly what to set
 * — rather than booting into a broken state (2026-07 follow-up).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { log } from "@mcbot/core/utils/logger.js";

export interface MissingSetting {
  name: string;
  reason: string;
  example: string;
}

/** The env the dashboard cannot function without. Both are env-only secrets. */
export function missingWebEnv(): MissingSetting[] {
  const missing: MissingSetting[] = [];

  const session = process.env.WEBUI_SESSION_SECRET;
  if (!session || session.length < 16) {
    missing.push({
      name: "WEBUI_SESSION_SECRET",
      reason: session
        ? "is set but shorter than the required 16 characters"
        : "is not set — it signs the dashboard login session cookie",
      example: "WEBUI_SESSION_SECRET=$(openssl rand -hex 32)",
    });
  }

  if (!process.env.WEBUI_CLIENT_SECRET) {
    missing.push({
      name: "WEBUI_CLIENT_SECRET",
      reason:
        "is not set — the Discord application's OAuth2 secret, needed to complete login",
      example: "WEBUI_CLIENT_SECRET=your-discord-oauth2-client-secret",
    });
  }

  return missing;
}

function logMissing(missing: MissingSetting[]): void {
  const line = "─".repeat(66);
  log.error("web", line);
  log.error(
    "web",
    "Dashboard is missing required configuration — it cannot be used until",
  );
  log.error("web", "this is set. Serving a setup page in the meantime:");
  for (const m of missing) log.error("web", `  • ${m.name} ${m.reason}`);
  log.error("web", "Add the above to your .env, then restart:");
  log.error("web", "  docker compose --profile web up -d");
  log.error("web", "See .env.example for the full list.");
  log.error("web", line);
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/** A self-contained (no external assets) HTML setup page. */
export function renderSetupPage(missing: MissingSetting[]): string {
  const items = missing
    .map((m) => `      <li><code>${esc(m.name)}</code> — ${esc(m.reason)}</li>`)
    .join("\n");
  const env = missing.map((m) => esc(m.example)).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard setup required</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#15171a; color:#e6e8eb;
    font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:640px; margin:2rem; padding:2rem 2.25rem;
    background:#1e2126; border:1px solid #2c3138; border-radius:12px; }
  h1 { margin:0 0 .5rem; font-size:1.4rem; }
  p { color:#aeb4bc; }
  ul { padding-left:1.2rem; } li { margin:.35rem 0; }
  code { background:#0e1013; padding:.1rem .4rem; border-radius:5px; color:#7cc7ff;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  pre { background:#0e1013; padding:1rem; border-radius:8px; overflow:auto;
    border:1px solid #2c3138; color:#c8ffce; }
  .muted { font-size:.9rem; color:#7a828c; }
</style></head>
<body><div class="card">
  <h1>⚙️ Dashboard setup required</h1>
  <p>The dashboard is running, but these required settings are missing:</p>
    <ul>
${items}
    </ul>
  <p>Add them to your <code>.env</code>:</p>
  <pre>${env}</pre>
  <p>Then recreate the container (no rebuild needed):</p>
  <pre>docker compose --profile web up -d</pre>
  <p class="muted">Behind a reverse proxy? Also set your public URL so Discord
  login redirects back correctly — <code>WEBUI_PUBLIC_URL=https://your.domain</code>
  — and add <code>&lt;that URL&gt;/auth/callback</code> to your Discord app's
  OAuth2 redirect URIs.</p>
</div></body></html>`;
}

/**
 * If required config is missing, log it and short-circuit every request with a
 * setup page (HTML for browsers, JSON for API calls) so the operator sees what
 * to fix instead of an opaque 500. /healthz is exempt so the container's health
 * probe still passes and it stays up long enough to show the page. Registers
 * nothing (zero overhead) when everything is set.
 */
export function registerSetupGuard(app: FastifyInstance): boolean {
  const missing = missingWebEnv();
  if (missing.length === 0) return false;

  logMissing(missing);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if ((req.url.split("?")[0] ?? "") === "/healthz") return;

    if ((req.headers.accept ?? "").includes("text/html")) {
      reply
        .code(503)
        .type("text/html; charset=utf-8")
        .send(renderSetupPage(missing));
    } else {
      reply.code(503).send({
        error: "Dashboard not configured",
        missing: missing.map((m) => m.name),
      });
    }
    return reply;
  });
  return true;
}
