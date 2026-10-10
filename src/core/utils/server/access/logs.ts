/** Log tail and the SSE log stream. */

import { SseLineStream } from "../../sseLineStream.js";
import type { ServerConfig } from "../../../types/index.js";
import { apiGet } from "./apiClient.js";

/**
 * Return the last N lines of the server's latest.log.
 * Used as a fallback for seed/coord parsing and screen-mode getList.
 */
export async function tailLog(cfg: ServerConfig, lines = 10): Promise<string> {
  const { output } = await apiGet<{ output: string }>(
    cfg,
    `/logs/tail?lines=${lines}`,
  );
  return output;
}

/** Returns the SSE endpoint URL for a remote instance's log stream. */
export function logStreamUrl(cfg: ServerConfig): string {
  if (!cfg.apiUrl)
    throw new Error(`logStreamUrl called on local instance '${cfg.id}'`);
  return `${cfg.apiUrl.replace(/\/$/, "")}/instances/${cfg.id}/logs/stream`;
}

/** What a caller of openLogStream cares about. */
export interface LogStreamHandlers {
  /** One log line, already unwrapped from its SSE frame. */
  onLine: (line: string) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

/**
 * Open the wrapper's log stream for one instance.
 *
 * This is the only place that knows the wrapper sends `{"line": "..."}` in
 * each `data:` frame, and the only place that attaches the API key to a
 * stream. `SseLineStream` underneath is pure transport and knows neither;
 * the split is what lets the transport be tested without a wrapper and keeps
 * the wrapper's payload contract in the module that owns every other route.
 *
 * The returned stream is NOT started; call `.start()`. Callers own the
 * lifetime and must `.stop()` it.
 */
export function openLogStream(
  cfg: ServerConfig,
  handlers: LogStreamHandlers,
): SseLineStream {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  return new SseLineStream({
    url: logStreamUrl(cfg),
    headers,
    scope: cfg.id,
    onData: (payload) => {
      try {
        const { line } = JSON.parse(payload) as { line?: unknown };
        // A frame without a string line is a wrapper we don't understand, not
        // an empty log line: drop it rather than emitting "undefined".
        if (typeof line === "string") handlers.onLine(line);
      } catch {
        /* malformed frame; skip, the next one is independent */
      }
    },
    ...(handlers.onConnect ? { onConnect: handlers.onConnect } : {}),
    ...(handlers.onDisconnect ? { onDisconnect: handlers.onDisconnect } : {}),
  });
}
