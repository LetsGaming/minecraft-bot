/**
 * DSH-01/DSH-02 — the dashboard console: a relayed log stream and a command
 * input. Registered inside the capability-gated host scope (see server.ts).
 *
 * These are the two halves of what the server manager's WebSocket terminal
 * did, rebuilt on what the wrapper already serves. No new wrapper endpoint was
 * needed: `/logs/stream` and `/command` have both existed since 3.x.
 *
 * SSE rather than a WebSocket, and that choice removes code rather than adding
 * it. A browser cannot set headers on a WebSocket handshake, so the old
 * implementation needed a whole one-time-ticket endpoint and store to avoid
 * putting its JWT in a URL where access logs would keep it. EventSource sends
 * cookies on a same-origin request, so the session cookie authenticates the
 * stream and the ticket machinery is simply gone.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { loadConfig } from "@mcbot/core/config.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { sendCommand } from "@mcbot/core/utils/server/serverAccess.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { stripControlChars } from "@mcbot/core/utils/sanitize.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import {
  DEFAULT_BLOCKED_COMMANDS,
  MAX_CONSOLE_COMMAND_LENGTH,
  isBlockedConsoleCommand,
} from "@mcbot/schema/consoleCommands.js";
import { sessionFromRequest } from "../auth/auth.js";
import { subscribe, type ConsoleEvent } from "../console/consoleHub.js";
import { BadRequest, Forbidden, NotFound, HttpError } from "../errors.js";
import { IdParams, ConsoleCommandBody } from "./schemas.js";

/** Same contract as servers.ts: an internal failure says nothing specific. */
const COMMAND_FAILED =
  "The command couldn't be delivered — the wrapper isn't answering. " +
  "Console commands run in the moment, so this one wasn't queued; try again once the server is reachable.";

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

/** The operator's deny-list, or the defaults when none is configured. */
function denyList(): readonly string[] {
  const configured = loadConfig().webui?.console?.blockedCommands;
  return configured && configured.length > 0
    ? configured
    : DEFAULT_BLOCKED_COMMANDS;
}

export function registerConsoleRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/console/stream",
    {
      schema: { params: IdParams },
      // Reading the console is reading the log, so it needs no capability
      // beyond server:read. Sending is the privileged half, below.
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req, reply) => {
      const server = requireServer(req.params.id);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Without this a buffering reverse proxy holds frames until it has a
        // chunk's worth, which turns a live console into a stuttering one.
        "X-Accel-Buffering": "no",
      });

      const write = (event: ConsoleEvent): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      const unsubscribe = subscribe(server.config, write);

      // Comment frames keep proxies and load balancers from timing the
      // connection out on a quiet server. They are not events and the client
      // never sees them.
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(": keep-alive\n\n");
      }, 25_000);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.raw.on("close", cleanup);
      reply.raw.on("error", cleanup);

      // Hand the socket to the hub: returning would end the response.
      return reply;
    },
  );

  api.post(
    "/api/servers/:id/command",
    {
      schema: { params: IdParams, body: ConsoleCommandBody },
      config: { capability: "server:console", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const raw = req.body.command;

      // stripControlChars, not sanitizeForConsole: that helper is for
      // interpolating a name and message INTO a command (`/say [x] y`) and
      // escapes double quotes, which would corrupt a legitimate `/tellraw`
      // payload here. What must go either way is control characters — a
      // newline would turn one input into two commands, which is the whole
      // injection risk on this path.
      const command = stripControlChars(raw)
        .trim()
        .slice(0, MAX_CONSOLE_COMMAND_LENGTH);
      const sanitized = command !== raw.trim();
      if (!command) throw new BadRequest("Command is empty.");

      // Enforced here, not only in the UI: a deny-list that lives in the
      // browser is a suggestion.
      if (isBlockedConsoleCommand(command, denyList())) {
        throw new Forbidden(
          `That command is blocked on this dashboard. Use the server controls instead.`,
        );
      }

      const session = sessionFromRequest(req)!;
      // Audited before it runs, and audited even if it then fails: what was
      // attempted is the interesting fact.
      await recordAdminAction({
        action: "console (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: command.slice(0, 200),
      });

      try {
        const result = await sendCommand(server.config, command);
        return { ok: true, output: result ?? "", sanitized };
      } catch (err) {
        log.error(
          "web",
          `Console command on ${req.params.id} failed: ${errMsg(err)}`,
        );
        throw new HttpError(502, COMMAND_FAILED);
      }
    },
  );

  api.get(
    "/api/servers/:id/console/policy",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      requireServer(req.params.id);
      // The UI greys blocked commands out before sending. It reads the same
      // list the enforcement uses, so the two cannot disagree.
      return {
        blockedCommands: [...denyList()],
        maxLength: MAX_CONSOLE_COMMAND_LENGTH,
      };
    },
  );
}

