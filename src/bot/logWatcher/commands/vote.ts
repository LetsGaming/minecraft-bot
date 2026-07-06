/**
 * !vote <number> — in-game side of cross-platform polls.
 *
 * Votes land in the same store as the Discord buttons; linked players
 * resolve to their Discord voter key (pollStore.voterKeyForMc) so one
 * person is one vote regardless of platform. Re-voting overwrites.
 */
import { defineCommand } from "../defineCommand.js";
import {
  loadPollStore,
  savePollStore,
  getOpenPollForServer,
  voterKeyForMc,
} from "@mcbot/core/utils/pollStore.js";
import { loadLinkedAccounts } from "@mcbot/core/utils/linkUtils.js";
import { t } from "@mcbot/core/utils/i18n.js";

const cmd = defineCommand({
  name: "vote",
  description: "Vote in the current poll: !vote <number>",
  args: ["option"],
  cooldown: 3,
  handler: async (username, { option }, _client, server) => {
    const store = await loadPollStore();
    const poll = getOpenPollForServer(store, server.id);

    if (!poll || Date.now() >= poll.endsAt) {
      await server.sendCommand(`/msg ${username} ${t("poll.noneInGame")}`);
      return;
    }

    const idx = Number.parseInt(option ?? "", 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) {
      await server.sendCommand(
        `/msg ${username} ${t("poll.badVote", { max: poll.options.length })}`,
      );
      return;
    }

    const linked = await loadLinkedAccounts().catch(
      () => ({}) as Record<string, string>,
    );
    poll.votes[voterKeyForMc(username, linked)] = idx;
    await savePollStore(store);

    await server.sendCommand(
      `/tellraw ${username} ${JSON.stringify({
        text: t("poll.voted", { option: poll.options[idx]! }),
        color: "green",
      })}`,
    );
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
