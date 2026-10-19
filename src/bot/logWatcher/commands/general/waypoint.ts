/**
 * !waypoint, community waypoints, in-game side.
 *
 *   !waypoint <name>                  look up a waypoint
 *   !waypoint set <name> [category]   save your position (optional tag)
 *   !waypoint del <name>              delete a waypoint you created
 *
 * Uses the greedy-arg form of defineCommand so one command carries the
 * subcommand syntax. Position and dimension come from the canonical
 * ServerInstance helpers, storage goes through waypointStore.
 *
 * Overwrite is restricted to the original author, everyone can read,
 * nobody can stomp someone else's point. Delete allows the author *or* a
 * server admin: a waypoint outlives its creator leaving the server, and
 * with author-only deletion the only way to remove one was to edit the
 * store by hand. Admin here is the same check `adminOnly` commands use:
 * the player's linked Discord account against the global admin list.
 * `!waypoints` (separate command) lists everything.
 */
import { defineCommand } from "../../defineCommand.js";
import {
  loadWaypointStore,
  updateWaypointStore,
  type Waypoint,
  getServerWaypoints,
  isValidWaypointName,
  isValidWaypointCategory,
  waypointCap,
} from "@mcbot/core/utils/stores/waypointStore.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { isLinkedPlayerAdmin } from "../../../utils/guild/permissions.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { queryFailureText } from "../../queryMessages.js";
import { tellraw, whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";

async function msg(
  server: ServerInstance,
  username: string,
  text: string,
): Promise<void> {
  await whisper(server, username, text);
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

  const position = await server.getPlayerCoords(username);
  if (!position.ok) {
    await msg(server, username, queryFailureText(position.reason, "waypoint.noPosition"));
    return;
  }
  const coords = position.value;
  const dimensionResult = await server.getPlayerDimension(username);
  if (!dimensionResult.ok) {
    await msg(
      server,
      username,
      queryFailureText(dimensionResult.reason, "query.noDimension"),
    );
    return;
  }
  const dimension = dimensionResult.value;

  const key = name.toLowerCase();
  const cap = waypointCap();
  const wp: Waypoint = {
    name,
    dimension,
    x: Math.floor(coords.x),
    y: Math.floor(coords.y),
    z: Math.floor(coords.z),
    author: username,
    createdAt: Date.now(),
    ...(category ? { category: category.toLowerCase() } : {}),
  };
  // Checked and written in one transaction.
  const result = await updateWaypointStore((store) => {
    const waypoints = getServerWaypoints(store, server.id);
    const existing = waypoints[key];
    if (existing && existing.author.toLowerCase() !== username.toLowerCase()) {
      return { kind: "taken", existing } as const;
    }
    if (!existing && Object.keys(waypoints).length >= cap) {
      return { kind: "full" } as const;
    }
    waypoints[key] = wp;
    return { kind: "saved" } as const;
  });

  if (result.kind === "taken") {
    await msg(
      server,
      username,
      t("waypoint.taken", { name: result.existing.name, author: result.existing.author }),
    );
    return;
  }
  if (result.kind === "full") {
    await msg(server, username, t("waypoint.limitReached", { max: cap }));
    return;
  }

  await tellraw(server, username, {
    text: t("waypoint.saved", { name, x: wp.x, y: wp.y, z: wp.z }),
    color: "green",
  });
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
  const isAuthor = existing.author.toLowerCase() === username.toLowerCase();
  if (!isAuthor && !(await isLinkedPlayerAdmin(username))) {
    await msg(
      server,
      username,
      t("waypoint.taken", { name: existing.name, author: existing.author }),
    );
    return;
  }

  // Removed in a transaction against the current store: the admin check above awaited.
  await updateWaypointStore((current) => {
    delete getServerWaypoints(current, server.id)[key];
  });
  await msg(
    server,
    username,
    isAuthor
      ? t("waypoint.deleted", { name: existing.name })
      : t("waypoint.deletedByAdmin", {
          name: existing.name,
          author: existing.author,
        }),
  );
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

  await tellraw(server, username, {
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
  });
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
