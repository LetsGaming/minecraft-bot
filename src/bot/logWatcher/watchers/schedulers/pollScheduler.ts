/**
 * Poll lifecycle — close timers, Discord button collectors, and the
 * both-directions result announcement.
 *
 * State lives in pollStore; this module owns the runtime side:
 *
 *  - armPoll: one setTimeout per open poll fires the close at endsAt.
 *  - attachCollector: a message-component collector records button votes
 *    (customId "poll:<id>:<index>").
 *  - closePoll: flips the poll to closed, removes the buttons, posts the
 *    result embed in the channel, and tellraws the result to the bound
 *    server.
 *
 * startPollScheduler runs at bot init and re-arms every open poll from
 * the store — a restart mid-poll loses no votes and still closes on
 * time (or immediately, when endsAt passed while the bot was down).
 */
import {
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type Message,
} from "discord.js";
import {
  pollServerIds,
  loadPollStore,
  savePollStore,
  getPollById,
  tallyPoll,
  voterKeyForDiscord,
  type Poll,
} from "@mcbot/core/utils/stores/pollStore.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // setTimeout cap; poll durations are far below

const closeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Exposed for tests. */
export function _resetStateForTesting(): void {
  for (const timer of closeTimers.values()) clearTimeout(timer);
  closeTimers.clear();
}

/** Re-arm timers and collectors for every open poll (bot startup). */
export function startPollScheduler(client: Client): void {
  void (async () => {
    try {
      const store = await loadPollStore();
      const open = store.polls.filter((p) => p.status === "open");
      for (const poll of open) {
        armPoll(client, poll);
        try {
          await attachCollector(client, poll);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(
            "polls",
            `Could not re-attach collector for poll ${poll.id}: ${msg}`,
          );
        }
      }
      if (open.length > 0) {
        log.info("polls", `Resumed ${open.length} open poll(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("polls", `Failed to resume polls: ${msg}`);
    }
  })();
}

export function armPoll(client: Client, poll: Poll): void {
  const existing = closeTimers.get(poll.id);
  if (existing) clearTimeout(existing);

  const delay = Math.min(Math.max(0, poll.endsAt - Date.now()), MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    void closePoll(client, poll.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("polls", `Failed to close poll ${poll.id}: ${msg}`);
    });
  }, delay);
  closeTimers.set(poll.id, timer);
}

/** Fetch the poll message and attach the vote collector (startup path). */
async function attachCollector(client: Client, poll: Poll): Promise<void> {
  const channel = await client.channels.fetch(poll.channelId);
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(poll.messageId);
  attachCollectorToMessage(poll.id, message, poll.endsAt);
}

/** Attach the button-vote collector to an already-known message. */
export function attachCollectorToMessage(
  pollId: string,
  message: Message,
  endsAt: number,
): void {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: Math.min(Math.max(endsAt - Date.now(), 1_000), MAX_TIMEOUT_MS),
    filter: (i) => i.customId.startsWith(`poll:${pollId}:`),
  });

  collector.on("collect", async (interaction: ButtonInteraction) => {
    try {
      const idx = Number(interaction.customId.split(":")[2]);
      const store = await loadPollStore();
      const poll = getPollById(store, pollId);

      if (!poll || poll.status !== "open" || Date.now() >= poll.endsAt) {
        await interaction.reply({
          content: t("poll.closedReply"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) {
        return;
      }

      poll.votes[voterKeyForDiscord(interaction.user.id)] = idx;
      await savePollStore(store);

      await interaction.reply({
        content: t("poll.voted", { option: poll.options[idx]! }),
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("polls", `Vote handling failed: ${msg}`);
    }
  });
}

function buildResultLines(poll: Poll): { lines: string[]; total: number } {
  const counts = tallyPoll(poll);
  const total = counts.reduce((a, b) => a + b, 0);
  const best = Math.max(...counts);
  const lines = poll.options.map((opt, i) => {
    const count = counts[i]!;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const marker = total > 0 && count === best ? "🏆 " : "";
    return `${marker}**${opt}** — ${count} (${pct}%)`;
  });
  return { lines, total };
}

/** Close a poll and announce results in both directions. Idempotent. */
export async function closePoll(client: Client, pollId: string): Promise<void> {
  const store = await loadPollStore();
  const poll = getPollById(store, pollId);
  if (!poll || poll.status === "closed") return;

  poll.status = "closed";
  await savePollStore(store);

  const timer = closeTimers.get(pollId);
  if (timer) clearTimeout(timer);
  closeTimers.delete(pollId);

  const { lines, total } = buildResultLines(poll);

  // Discord side: strip the buttons off the original message, post results.
  try {
    const channel = await client.channels.fetch(poll.channelId);
    if (channel && "messages" in channel) {
      const message = await channel.messages
        .fetch(poll.messageId)
        .catch(() => null);
      if (message) await message.edit({ components: [] });
      if ("send" in channel) {
        await channel.send({
          embeds: [
            createEmbed({
              title: t("poll.resultTitle"),
              description: `**${poll.question}**\n\n${lines.join("\n")}\n\n${t(
                "poll.resultTotal",
                { total },
              )}`,
              color: EmbedColor.Gold,
              footer: { text: pollServerIds(poll).join(", ") },
            }),
          ],
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("polls", `Failed to announce results on Discord: ${msg}`);
  }

  // In-game side: every participating instance gets the results.
  const counts = tallyPoll(poll);
  for (const serverId of pollServerIds(poll)) {
    const server = getServerInstance(serverId);
    if (!server) continue;
    try {
      await server.sendCommand(
        `/tellraw @a ${JSON.stringify({
          text: t("poll.resultInGame", { question: poll.question }),
          color: "gold",
        })}`,
      );
      for (let i = 0; i < poll.options.length; i++) {
        await server.sendCommand(
          `/tellraw @a ${JSON.stringify({
            text: `  ${poll.options[i]}: ${counts[i]}`,
            color: "yellow",
          })}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        "polls",
        `Failed to announce results in-game on ${serverId}: ${msg}`,
      );
    }
  }

  log.info("polls", `Poll ${pollId} closed (${total} vote(s))`);
}
