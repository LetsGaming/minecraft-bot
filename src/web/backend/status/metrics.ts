/**
 * Unauthenticated probes: /healthz for load balancers and /metrics for
 * Prometheus. Split out of server.ts in the QUAL-01 refactor (2026-07
 * audit) — the exposition format lives here and nowhere else.
 */
import type { FastifyInstance } from "fastify";
import { getAllInstances } from "@mcbot/core/utils/server/server.js";
import {
  readRuntimeHeartbeat,
  heartbeatIsFresh,
} from "@mcbot/core/utils/server/runtimeHeartbeat.js";
import { collectStatus } from "./status.js";
import { ServerState } from "@mcbot/schema/serverState.js";
import { secretEquals } from "../auth/auth.js";

export function registerProbeRoutes(app: FastifyInstance): void {
  app.get("/healthz", async () => {
    const beat = await readRuntimeHeartbeat();
    return { web: "ok", bot: heartbeatIsFresh(beat) ? "ok" : "stale" };
  });

  app.get("/metrics", async (req, reply) => {
    // Optional bearer gate: player names and infrastructure state should
    // not be world-readable by default once the port is exposed. Unset
    // token = open (backwards compatible for loopback-only setups).
    const token = process.env.WEBUI_METRICS_TOKEN;
    if (token) {
      const auth = req.headers.authorization ?? "";
      if (!secretEquals(auth, `Bearer ${token}`)) {
        return reply.code(401).send({
          error:
            "This endpoint requires a valid bearer token (WEBUI_METRICS_TOKEN).",
        });
      }
    }
    const lines: string[] = [];
    const push = (name: string, help: string, type: string): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };

    const beat = await readRuntimeHeartbeat();
    push("mcbot_bot_up", "1 when the bot heartbeat is fresh", "gauge");
    lines.push(`mcbot_bot_up ${heartbeatIsFresh(beat) ? 1 : 0}`);

    // Three gauges rather than one, because they fail independently and you
    // want to alert on them differently: a wrapper outage is an ops problem,
    // an unresponsive server is a performance problem, and a stopped server
    // is neither. Collapsed into one "online" gauge they all paged as the
    // same incident.
    push(
      "mcbot_wrapper_up",
      "1 when the server's API wrapper answered — 0 means the server state below is unknown, not that it is down",
      "gauge",
    );
    push("mcbot_server_up", "1 when the Minecraft server process is running", "gauge");
    push("mcbot_server_online", "1 when the server is answering commands", "gauge");
    push("mcbot_players_online", "Players currently online", "gauge");
    push("mcbot_server_tps", "1-minute TPS (absent when unsupported)", "gauge");
    // Parallel: a scrape must not pay serial RCON round-trips per server.
    const statuses = await Promise.all(
      getAllInstances().map((inst) =>
        collectStatus(inst.id)
          .catch(() => null)
          .then((status) => ({ id: inst.id, status })),
      ),
    );
    for (const { id, status } of statuses) {
      const label = `{server="${id}"}`;
      const known = !!status && status.state !== ServerState.Unknown;
      lines.push(`mcbot_wrapper_up${label} ${known ? 1 : 0}`);
      // Absent, not zero, when the wrapper did not answer: a gauge of 0 is a
      // claim that the server is down, and we did not establish that. Absent
      // series break alert rules loudly, which is the correct outcome.
      if (known) {
        lines.push(
          `mcbot_server_up${label} ${status.state === ServerState.Offline ? 0 : 1}`,
        );
      }
      lines.push(`mcbot_server_online${label} ${status?.online ? 1 : 0}`);
      lines.push(`mcbot_players_online${label} ${status?.players.online ?? 0}`);
      if (status?.tps !== null && status?.tps !== undefined) {
        lines.push(`mcbot_server_tps${label} ${status.tps}`);
      }
    }

    return reply
      .header("content-type", "text/plain; version=0.0.4")
      .send(lines.join("\n") + "\n");
  });
}
