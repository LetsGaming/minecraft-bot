/**
 * "What's wrong with this server" — one place, so OverviewView (the fleet
 * summary) and StatusView (the per-server card) read off the same logic
 * instead of each hand-rolling their own subset. Extracted verbatim from
 * OverviewView's `alerts()` computed, which used to be the only place this
 * existed — adding a new check meant deciding whether to also add it to
 * StatusView, and usually nobody did.
 */
import { ServerState, WrapperState, type ServerStatus } from "../api";
import { diskLabel, stateLabel } from "./format";

export interface Alert {
  level: "warn" | "danger";
  icon: string;
  text: string;
}

/** Everything wrong with one server, most severe first. Pure — no fetching. */
export function serverAlerts(s: ServerStatus): Alert[] {
  const out: Alert[] = [];

  // The wrapper is its own axis: it can be down while the server is
  // demonstrably fine, and that is worth saying on its own rather than being
  // folded into the server's state. Not an early return — a server can be
  // both unresponsive and missing its wrapper.
  if (s.wrapper === WrapperState.Unreachable && s.state !== ServerState.Unknown) {
    out.push({
      level: "warn",
      icon: "pi pi-link",
      text: `${s.id}: API wrapper unreachable — controls, logs and stats are down. The server itself is ${stateLabel(s.state).toLowerCase()}.`,
    });
  }

  // Three different incidents, three different alerts. Collapsed into one
  // "is offline" line, a wrapper restart and a lag spike both read as an
  // outage — and the actual outage looked no worse than either.
  if (s.state === ServerState.Offline) {
    out.push({ level: "danger", icon: "pi pi-times-circle", text: `${s.id} is offline.` });
    return out;
  }
  if (s.state === ServerState.Unknown) {
    out.push({
      level: "warn",
      icon: "pi pi-question-circle",
      text: `${s.id}: neither its API wrapper nor the server answered — state unknown.`,
    });
    return out;
  }
  if (s.state === ServerState.Unresponsive) {
    out.push({
      level: "warn",
      icon: "pi pi-clock",
      text: `${s.id} is running but not answering commands — starting up, or under heavy load.`,
    });
    return out;
  }

  if (s.tps !== null && s.tps < 15) {
    out.push({ level: "warn", icon: "pi pi-gauge", text: `${s.id} has low TPS (${s.tps.toFixed(1)}).` });
  }
  for (const disk of s.host?.disks ?? []) {
    if (disk.usedPercent >= 90) {
      out.push({
        level: "warn",
        icon: "pi pi-database",
        text: `${s.id} ${diskLabel(disk.path).toLowerCase()} is ${disk.usedPercent}% full.`,
      });
    }
  }
  return out;
}

/** Fleet view: the bot heartbeat plus every server's alerts. */
export function fleetAlerts(servers: ServerStatus[], botAlive: boolean): Alert[] {
  const heartbeat: Alert[] = botAlive
    ? []
    : [{ level: "danger", icon: "pi pi-times-circle", text: "Bot process heartbeat is stale — status may be outdated." }];
  return [...heartbeat, ...servers.flatMap(serverAlerts)];
}
