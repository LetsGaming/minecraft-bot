/**
 * !vote <number> — in-game side of cross-platform polls.
 *
 * Votes land in the same store as the Discord buttons; linked players
 * resolve to their Discord voter key (pollStore.voterKeyForMc) so one
 * person is one vote regardless of platform. Re-voting overwrites.
 */
import { defineCommand } from "../../defineCommand.js";
import {
  loadPollStore,
  updatePollStore,
  getPollById,
  getOpenPollForServer,
  voterKeyForMc,
} from "@mcbot/core/utils/stores/pollStore.js";
import { loadLinkedAccountsOrEmpty } from "@mcbot/core/utils/stores/linkUtils.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { tellraw, whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";

const cmd = defineCommand({
  name: "vote",
  description: "Vote in the current poll: !vote <number>",
  args: ["option"],
  cooldown: 3,
  handler: async (username, { option }, _client, server) => {
    const store = await loadPollStore();
    const poll = getOpenPollForServer(store, server.id);

    if (!poll || Date.now() >= poll.endsAt) {
      await whisper(server, username, t("poll.noneInGame"));
      return;
    }

    const idx = Number.parseInt(option ?? "", 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) {
      await whisper(server, username, t("poll.badVote", { max: poll.options.length }));
      return;
    }

    const linked = await loadLinkedAccountsOrEmpty();
    // The vote goes into the poll as stored now: the copy above is stale after the await.
    const counted = await updatePollStore((current) => {
      const live = getPollById(current, poll.id);
      if (!live || live.status !== "open") return false;
      live.votes[voterKeyForMc(username, linked)] = idx;
      return true;
    });
    if (!counted) {
      await whisper(server, username, t("poll.noneInGame"));
      return;
    }

    await tellraw(server, username, {
        text: t("poll.voted", { option: poll.options[idx]! }),
        color: "green",
      });
  },
});

export const { init, COMMAND_INFO, handler } = cmd;
