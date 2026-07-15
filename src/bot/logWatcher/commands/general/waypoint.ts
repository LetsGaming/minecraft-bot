/**
 * !waypoint — community waypoints, in-game side.
 *
 *   !waypoint <name>                  look up a waypoint
 *   !waypoint set <name> [category]   save your position (optional tag)
 *   !waypoint del <name>              delete a waypoint you created
 *
 * Uses the greedy-arg form of defineCommand so one command carries the
 * subcommand syntax. Position and dimension come from the canonical
 * ServerInstance helpers (RCON-authoritative with the screen log-poll
 * fallback), storage goes through waypointStore (atomic saveJson).
 *
 * Overwrite/delete are restricted to the original author — everyone can
 * read, nobody can stomp someone else's point. `!waypoints` (separate
 * command) lists everything.
 */
import { defineCommand } from "../../defineCommand.js";
import {
  loadWaypointStore,
  saveWaypointStore,
  getServerWaypoints,
  isValidWaypointName,
  isValidWaypointCategory,
  waypointCap,
} from "@mcbot/core/utils/stores/waypointStore.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";

async function msg(
  server: ServerInstance,
  username: string,
  text: string,
): Promise<void> {
  await server.sendCommand(`/msg ${username} ${text}`);
}

async function setWaypoint(
  username: string,
  name: string,
  server: ServerInstance,
  category?: string,
): Promise<void> {
  if (!isValidWaypointName(name)) {
    await msg(server, username, t("waypoint.invalidName"));
    return;
  }
  if (category !== undefined && !isValidWaypointCategory(category)) {
    await msg(server, username, t("waypoint.invalidCategory"));
    return;
  }

  const coords = await server.getPlayerCoords(username);
  if (!coords) {
    await msg(server, username, t("waypoint.noPosition"));
    return;
  }
  const dimension = await server.getPlayerDimension(username);

  const store = await loadWaypointStore();
  const waypoints = getServerWaypoints(store, server.id);
  const key = name.toLowerCase();
  const existing = waypoints[key];

  if (existing && existing.author.toLowerCase() !== username.toLowerCase()) {
    await msg(
      server,
      username,
      t("waypoint.taken", { name: existing.name, author: existing.author }),
    );
    return;
  }
  const cap = waypointCap();
  if (!existing && Object.keys(waypoints).length >= cap) {
    await msg(server, username, t("waypoint.limitReached", { max: cap }));
    return;
  }

  waypoints[key] = {
    name,
    dimension,
    x: Math.floor(coords.x),
    y: Math.floor(coords.y),
    z: Math.floor(coords.z),
    author: username,
    createdAt: Date.now(),
    ...(category ? { category: category.toLowerCase() } : {}),
  };
  await saveWaypointStore(store);

  const wp = waypoints[key];
  await server.sendCommand(
    `/tellraw ${username} ${JSON.stringify({
      text: t("waypoint.saved", { name, x: wp.x, y: wp.y, z: wp.z }),
      color: "green",
    })}`,
  );
}

async function deleteWaypoint(
  username: string,
  name: string,
  server: ServerInstance,
): Promise<void> {
  const store = await loadWaypointStore();
  const waypoints = getServerWaypoints(store, server.id);
  const key = name.toLowerCase();
  const existing = waypoints[key];

  if (!existing) {
    await msg(server, username, t("waypoint.notFound", { name }));
    return;
  }
  if (existing.author.toLowerCase() !== username.toLowerCase()) {
    await msg(
      server,
      username,
      t("waypoint.taken", { name: existing.name, author: existing.author }),
    );
    return;
  }

  delete waypoints[key];
  await saveWaypointStore(store);
  await msg(server, username, t("waypoint.deleted", { name: existing.name }));
}

async function lookupWaypoint(
  username: string,
  name: string,
  server: ServerInstance,
): Promise<void> {
  const store = await loadWaypointStore();
  const wp = getServerWaypoints(store, server.id)[name.toLowerCase()];

  if (!wp) {
    await msg(server, username, t("waypoint.notFound", { name }));
    return;
  }

  await server.sendCommand(
    `/tellraw ${username} ${JSON.stringify({
      text:
        t("waypoint.result", {
          name: wp.name,
          x: wp.x,
          y: wp.y,
          z: wp.z,
          dimension: wp.dimension,
          author: wp.author,
        }) + (wp.category ? ` [${wp.category}]` : ""),
      color: "gold",
    })}`,
  );
}

const cmd = defineCommand({
  name: "waypoint",
  aliases: ["wp"],
  description: "Look up a waypoint, or save one with: !waypoint set <name>",
  args: ["query..."],
  cooldown: 3,
  handler: async (username, { query }, _client, server) => {
    const parts = (query ?? "").trim().split(/\s+/).filter(Boolean);
    const [first, second] = parts;

    if (
      first?.toLowerCase() === "set" &&
      second &&
      (parts.length === 2 || parts.length === 3)
    ) {
      await setWaypoint(username, second, server, parts[2]);
      return;
    }
    if (first?.toLowerCase() === "del" && second && parts.length === 2) {
      await deleteWaypoint(username, second, server);
      return;
    }
    if (first && parts.length === 1) {
      await lookupWaypoint(username, first, server);
      return;
    }
    await msg(server, username, t("waypoint.usage"));
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
