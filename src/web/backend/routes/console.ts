/**
 * DSH-01/DSH-02, the dashboard console: a relayed log stream and a command
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
import { MS } from "@mcbot/schema";
import { stripControlChars } from "@mcbot/core/utils/sanitize.js";
import {
  DEFAULT_BLOCKED_COMMANDS,
  MAX_CONSOLE_COMMAND_LENGTH,
  isBlockedConsoleCommand,
} from "@mcbot/schema/consoleCommands.js";
import { currentSession } from "../auth/auth.js";
import { subscribe, type ConsoleEvent } from "../console/consoleHub.js";
import {
  registerStream,
  openStreamsForUser,
  MAX_STREAMS_PER_USER,
} from "../console/streamRegistry.js";
import { BadGateway, BadRequest, Forbidden, HttpError } from "../errors.js";
import { IdParams, ConsoleCommandBody } from "./schemas.js";
import { auditedAction, requireServer } from "./support.js";

const COMMAND_FAILED =
  "The command couldn't be delivered: the wrapper isn't answering. " +
  "Console commands run in the moment, so this one wasn't queued; try again once the server is reachable.";

const KEEP_ALIVE_INTERVAL_MS = 25 * MS.second;
const AUDIT_DETAIL_MAX = 200;

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
      const session = currentSession(req);
      if (openStreamsForUser(session.uid) >= MAX_STREAMS_PER_USER) {
        throw new HttpError(
          429,
          `You already have ${MAX_STREAMS_PER_USER} consoles open. Close one and try again.`,
        );
      }

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
      }, KEEP_ALIVE_INTERVAL_MS);

      let cleaned = false;
      const deregister = registerStream({
        serverId: server.config.id,
        session,
        close: (event) => {
          write(event);
          reply.raw.end();
          cleanup();
        },
      });
      function cleanup(): void {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        deregister();
        unsubscribe();
      }
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

      // The command is passed through as typed, so a legitimate `/tellraw`
      // payload keeps its quotes. Control characters must go: a newline would
      // turn one input into two commands, which is the whole injection risk
      // on this path.
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

      // Audited before it runs, and audited even if it then fails: what was
      // attempted is the interesting fact.
      await auditedAction(req, {
        action: "console",
        server: req.params.id,
        detail: command.slice(0, AUDIT_DETAIL_MAX),
      });

      const outcome = await server.send(command);
      if (outcome.kind === "unreachable") throw new BadGateway(COMMAND_FAILED);
      return {
        ok: true,
        kind: outcome.kind,
        output: outcome.kind === "delivered" ? outcome.output : "",
        sanitized,
      };
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

