/**
 * !waypoints — list this server's community waypoints in chat.
 *
 * Chat is a narrow pipe, so the in-game list is capped; the Discord
 * `/waypoints` command renders the full paginated set.
 */
import { defineCommand } from "../defineCommand.js";
import {
  loadWaypointStore,
  getServerWaypoints,
} from "../../../common/utils/waypointStore.js";
import { t } from "../../../common/utils/i18n.js";

const MAX_CHAT_LINES = 15;

const cmd = defineCommand({
  name: "waypoints",
  aliases: ["wps"],
  description:
    "List community waypoints on this server (optionally: !waypoints <category>)",
  args: ["category?"],
  cooldown: 10,
  handler: async (username, { category: rawCategory }, _client, server) => {
    const category = rawCategory?.trim().toLowerCase() || undefined;
    const store = await loadWaypointStore();
    const waypoints = Object.values(getServerWaypoints(store, server.id))
      .filter((wp) => !category || wp.category === category)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (waypoints.length === 0) {
      await server.sendCommand(
        `/msg ${username} ${
          category
            ? t("waypoint.noneInCategory", { category })
            : t("waypoint.noneInGame")
        }`,
      );
      return;
    }

    await server.sendCommand(
      `/msg ${username} ${t("waypoint.listHeader", { count: waypoints.length })}`,
    );
    for (const wp of waypoints.slice(0, MAX_CHAT_LINES)) {
      await server.sendCommand(
        `/msg ${username}  ${wp.name}: ${wp.x} / ${wp.y} / ${wp.z} (${wp.dimension})`,
      );
    }
    if (waypoints.length > MAX_CHAT_LINES) {
      await server.sendCommand(
        `/msg ${username} ${t("waypoint.listMore", {
          more: waypoints.length - MAX_CHAT_LINES,
        })}`,
      );
    }
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
