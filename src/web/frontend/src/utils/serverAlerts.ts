/**
 * "What's wrong with this server" in one place, so OverviewView (the fleet
 * summary) and StatusView (the per-server card) read off the same logic
 * instead of each hand-rolling their own subset.
 */
import { DEFAULT_TPS_ALERT_THRESHOLD, classifyDiskUsage } from "@mcbot/schema";
import { ServerState, WrapperState, type ServerStatus } from "../api";
import { t } from "../i18n";
import { diskLabel, stateLabel } from "./format";

export type AlertKind =
  | "wrapper"
  | "offline"
  | "unknown"
  | "unresponsive"
  | "lowTps"
  | "diskFull"
  | "botDown";

export interface Alert {
  kind: AlertKind;
  level: "warn" | "danger";
  text: string;
}

/** Everything wrong with one server, most severe first. Pure, no fetching. */
export function serverAlerts(s: ServerStatus): Alert[] {
  const out: Alert[] = [];

  // The wrapper is its own axis: it can be down while the server is
  // demonstrably fine. Not an early return: a server can be both
  // unresponsive and missing its wrapper.
  if (s.wrapper === WrapperState.Unreachable && s.state !== ServerState.Unknown) {
    out.push({
      kind: "wrapper",
      level: "warn",
      text: t("servers.alert.wrapper", { server: s.id, state: stateLabel(s.state).toLowerCase() }),
    });
  }

  // Three different incidents, three different alerts. Collapsed into one
  // "is offline" line, a wrapper restart and a lag spike both read as an
  // outage, and the actual outage looked no worse than either.
  if (s.state === ServerState.Offline) {
    out.push({ kind: "offline", level: "danger", text: t("servers.alert.offline", { server: s.id }) });
    return out;
  }
  if (s.state === ServerState.Unknown) {
    out.push({ kind: "unknown", level: "warn", text: t("servers.alert.unknown", { server: s.id }) });
    return out;
  }
  if (s.state === ServerState.Unresponsive) {
    out.push({
      kind: "unresponsive",
      level: "warn",
      text: t("servers.alert.unresponsive", { server: s.id }),
    });
    return out;
  }

  if (s.tps !== null && s.tps < DEFAULT_TPS_ALERT_THRESHOLD) {
    out.push({
      kind: "lowTps",
      level: "warn",
      text: t("servers.alert.lowTps", { server: s.id, tps: s.tps.toFixed(1) }),
    });
  }
  for (const disk of s.host?.disks ?? []) {
    if (classifyDiskUsage(disk.usedPercent) === "critical") {
      out.push({
        kind: "diskFull",
        level: "warn",
        text: t("servers.alert.diskFull", {
          server: s.id,
          disk: diskLabel(disk.path).toLowerCase(),
          percent: disk.usedPercent,
        }),
      });
    }
  }
  return out;
}

/** Fleet view: the bot heartbeat plus every server's alerts. */
export function fleetAlerts(servers: ServerStatus[], botAlive: boolean | null): Alert[] {
  const heartbeat: Alert[] =
    botAlive === false ? [{ kind: "botDown", level: "danger", text: t("overview.alert.botDown") }] : [];
  return [...heartbeat, ...servers.flatMap(serverAlerts)];
}
