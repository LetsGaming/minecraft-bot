/**
 * Whitelist applications, non-admins request access with a button, a
 * modal collects their Minecraft name, admins approve or deny from a
 * queue channel. Approval takes the exact same path as /whitelist
 * (performWhitelistAdd: Mojang lookup, console add, audit, cache).
 *
 * Config (per guild):
 *
 *   "whitelistApplications": {
 *     "channelId": "…",        // where the persistent Apply button lives
 *     "adminChannelId": "…",   // where applications queue up
 *     "mentionRole": "…"       // optional ping on new applications
 *   }
 *
 * All components use stable customIds (wlapp:…) routed through the
 * global interactionCreate handler, NOT collectors, so buttons keep
 * working across restarts. The application queue and the prompt-message
 * bookkeeping live in whitelistApplicationStore; this file is Discord I/O.
 */
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { randomBytes } from "crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type Client,
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { loadConfig, getServerIds } from "@mcbot/core/config.js";
import {
  resolveDefaultServerId,
  visibleServerIdsForGuild,
} from "@mcbot/core/utils/server/guildTargets.js";
import { isInvokerAdmin } from "../utils/guild/permissions.js";
import { getGuildScopedServer } from "../utils/guild/guildRouter.js";
import { performWhitelistAdd } from "../commands/shared/whitelistAdd.js";
import { createEmbed } from "../utils/embeds/embedUtils.js";
import { EmbedColor } from "../utils/embeds/embedColors.js";
import { roleMention } from "../utils/embeds/alertUtils.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import {
  addPendingApplication,
  claimWhitelistApplication,
  countPendingApplications,
  loadWhitelistApplications,
  releaseWhitelistApplication,
  removeWhitelistApplication,
  settleWhitelistApplication,
  updateWhitelistApplications,
  type WhitelistApplication,
} from "@mcbot/core/utils/stores/whitelistApplicationStore.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../utils/guild/guildConfigs.js";
import { errMsg } from "@mcbot/core/utils/error.js";

export type {
  ApplicationStatus,
  WhitelistApplication,
} from "@mcbot/core/utils/stores/whitelistApplicationStore.js";

const APPLY_ID = "wlapp:apply";
const MODAL_ID = "wlapp:modal";
const APPROVE_PREFIX = "wlapp:approve:";
const DENY_PREFIX = "wlapp:deny:";

/** Pending applications per user per guild (spam guard). */
const MAX_PENDING_PER_USER = 1;

/** The server IDs this guild's applications may target. */
function visibleServerIds(guildId: string): string[] {
  return visibleServerIdsForGuild(guildId, getServerIds());
}

/** The server an application in this guild targets, or null if ambiguous. */
function defaultApplicationServer(guildId: string): string | null {
  try {
    return resolveDefaultServerId(guildId, getServerIds());
  } catch {
    return null;
  }
}

// ── Persistent prompt maintenance ─────────────────────────────────────────

/**
 * Ensure every configured guild has a live Apply prompt: reuse the
 * stored message when it still exists, repost otherwise. Called at init
 * and on config reload, idempotent by design.
 */
export async function ensureApplicationPrompts(
  client: Client,
  guildConfigs: GuildConfigSource,
): Promise<void> {
  const store = loadWhitelistApplications();
  const posted: Record<string, { channelId: string; messageId: string }> = {};

  for (const [guildId, gcfg] of Object.entries(
    resolveGuildConfigs(guildConfigs),
  )) {
    const cfg = gcfg.whitelistApplications;
    if (!cfg?.channelId || !cfg.adminChannelId) continue;

    const existing = store.prompts[guildId];
    if (existing && existing.channelId === cfg.channelId) {
      try {
        const channel = await client.channels.fetch(existing.channelId);
        if (channel && "messages" in channel) {
          const msg = await channel.messages
            .fetch(existing.messageId)
            .catch(() => null);
          if (msg) continue; // prompt alive, nothing to do
        }
      } catch {
        /* fall through to repost */
      }
    }

    try {
      const channel = await client.channels.fetch(cfg.channelId);
      if (!channel || !("send" in channel)) continue;

      const message = await runWithGuildLocale(guildId, async () =>
        channel.send({
          embeds: [
            createEmbed({
              title: t("wlapp.promptTitle"),
              description: t("wlapp.promptBody"),
              category: EmbedCategory.Whitelist,
            }),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(APPLY_ID)
                .setLabel(t("wlapp.applyButton"))
                .setStyle(ButtonStyle.Success),
            ),
          ],
        }),
      );
      posted[guildId] = {
        channelId: cfg.channelId,
        messageId: message.id,
      };
      log.info("wlapp", `Posted application prompt for guild ${guildId}`);
    } catch (err) {
      log.warn("wlapp", `Prompt setup failed for guild ${guildId}: ${errMsg(err)}`);
    }
  }

  if (Object.keys(posted).length > 0) {
    updateWhitelistApplications((current) => {
      Object.assign(current.prompts, posted);
    });
  }
}

// ── Interaction routing ───────────────────────────────────────────────────

/**
 * Handle wlapp:* buttons and the application modal. Returns true when
 * the interaction belonged to this feature (handled or rejected), false
 * to let the dispatcher continue.
 */
export async function handleWhitelistApplicationInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (interaction.isButton()) {
    if (interaction.customId === APPLY_ID) {
      await handleApplyButton(interaction);
      return true;
    }
    if (
      interaction.customId.startsWith(APPROVE_PREFIX) ||
      interaction.customId.startsWith(DENY_PREFIX)
    ) {
      await handleDecisionButton(interaction);
      return true;
    }
    return false;
  }
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    await handleModalSubmit(interaction);
    return true;
  }
  return false;
}

async function handleApplyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guild?.id;
  if (!guildId) return;

  await runWithGuildLocale(guildId, async () => {
    const gcfg = loadConfig().guilds[guildId];
    const modal = new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle(t("wlapp.modalTitle"))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(t("wlapp.modalName"))
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("mcName")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(17),
          ),
      );

    // Multi-server guild without a default: the applicant picks the
    // target, better than bouncing them with a config error.
    if (gcfg && !defaultApplicationServer(guildId)) {
      const ids = visibleServerIds(guildId).slice(0, 25);
      modal.addLabelComponents(
        new LabelBuilder()
          .setLabel(t("wlapp.modalServer"))
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId("server")
              .setRequired(true)
              .addOptions(ids.map((id) => ({ label: id, value: id }))),
          ),
      );
    }

    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel(t("wlapp.modalNote"))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("note")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(300),
        ),
    );
    await interaction.showModal(modal);
  });
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const guildId = interaction.guild?.id;
  if (!guildId) return;
  const gcfg = loadConfig().guilds[guildId];
  const cfg = gcfg?.whitelistApplications;
  if (!gcfg || !cfg?.adminChannelId) return;
  // Narrowing does not survive the locale-context closure below.
  const adminChannelId = cfg.adminChannelId;

  await runWithGuildLocale(guildId, async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const mcName = interaction.fields.getTextInputValue("mcName").trim();
    const note = interaction.fields.getTextInputValue("note").trim();

    if (!isValidMcName(mcName)) {
      await interaction.editReply({
        content: t("wlapp.invalidName", { name: mcName }),
      });
      return;
    }

    // Server: the guild default when unambiguous, otherwise the modal's
    // select. Re-validate against the visible set, customIds and modal
    // payloads are client-controlled.
    let serverId = defaultApplicationServer(guildId);
    if (!serverId) {
      const picked = (() => {
        try {
          return interaction.fields.getStringSelectValues("server")[0];
        } catch {
          return undefined;
        }
      })();
      if (picked && visibleServerIds(guildId).includes(picked)) {
        serverId = picked;
      }
    }
    if (!serverId) {
      await interaction.editReply({ content: t("wlapp.noServer") });
      return;
    }

    if (countPendingApplications(guildId, interaction.user.id) >= MAX_PENDING_PER_USER) {
      await interaction.editReply({ content: t("wlapp.alreadyPending") });
      return;
    }

    const app: WhitelistApplication = {
      id: randomBytes(4).toString("hex"),
      guildId,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      mcName,
      ...(note ? { note } : {}),
      serverId,
      status: "pending",
      createdAt: Date.now(),
    };

    const channel = await interaction.client.channels
      .fetch(adminChannelId)
      .catch(() => null);
    if (!channel || !("send" in channel)) {
      await interaction.editReply({ content: t("wlapp.queueBroken") });
      return;
    }

    // The row goes in first (the limit is enforced in the same transaction),
    // so a concurrent second submit never posts a queue message for an
    // application that was not stored. A failed post takes the row back out.
    if (!addPendingApplication(app, MAX_PENDING_PER_USER)) {
      await interaction.editReply({ content: t("wlapp.alreadyPending") });
      return;
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${APPROVE_PREFIX}${app.id}`)
        .setLabel(t("wlapp.approveButton"))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${DENY_PREFIX}${app.id}`)
        .setLabel(t("wlapp.denyButton"))
        .setStyle(ButtonStyle.Danger),
    );
    try {
      await channel.send({
        embeds: [buildQueueEmbed(app)],
        components: [row],
        ...roleMention(cfg.mentionRole),
      });
    } catch (err) {
      removeWhitelistApplication(app.id);
      throw err;
    }

    await interaction.editReply({
      content: t("wlapp.submitted", { name: mcName, server: serverId }),
    });
  });
}

function buildQueueEmbed(
  app: WhitelistApplication,
  statusLine?: string,
): ReturnType<typeof createEmbed> {
  const lines = [
    t("wlapp.queueApplicant", { mention: `<@${app.userId}>`, tag: app.userTag }),
    t("wlapp.queueName", { name: app.mcName }),
    t("wlapp.queueServer", { server: app.serverId }),
  ];
  if (app.note) lines.push(t("wlapp.queueNote", { note: app.note }));
  if (statusLine) lines.push("", statusLine);
  return createEmbed({
    title: t("wlapp.queueTitle"),
    description: lines.join("\n"),
    color:
      app.status === "approved"
        ? EmbedColor.Success
        : app.status === "denied"
          ? EmbedColor.Error
          : EmbedColor.Pending,
  });
}

async function handleDecisionButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guild?.id;
  if (!guildId) return;

  await runWithGuildLocale(guildId, async () => {
    // Buttons bypass the slash middleware, so enforce the exact same
    // admin check here (queue channels can be misconfigured as public).
    if (!isInvokerAdmin(interaction)) {
      await interaction.reply({
        content: t("wlapp.notAdmin"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const approve = interaction.customId.startsWith(APPROVE_PREFIX);
    const appId = interaction.customId.slice(
      approve ? APPROVE_PREFIX.length : DENY_PREFIX.length,
    );

    await interaction.deferUpdate();

    const staleReply = (): Promise<unknown> =>
      interaction.followUp({
        content: t("wlapp.stale"),
        flags: MessageFlags.Ephemeral,
      });

    // Claim first: only the admin who wins the claim acts, so two admins can
    // neither both whitelist nor approve and deny the same application.
    const app = claimWhitelistApplication(appId, guildId, interaction.user.id);
    if (!app) {
      await staleReply();
      return;
    }

    let mcName = app.mcName;
    let statusLine: string;
    if (approve) {
      // The stored server ID is re-checked against what the guild may target now.
      const server = getGuildScopedServer(guildId, app.serverId);
      if (!server) {
        releaseWhitelistApplication(app.id, interaction.user.id);
        await interaction.followUp({
          content: t("wlapp.serverGone", { server: app.serverId }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      try {
        const added = await performWhitelistAdd(server, app.mcName, {
          tag: interaction.user.tag,
          id: interaction.user.id,
        });
        mcName = added.name;
      } catch (err) {
        releaseWhitelistApplication(app.id, interaction.user.id);
        await interaction.followUp({
          content: t("wlapp.approveFailed", { error: errMsg(err) }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      statusLine = t("wlapp.approvedBy", { by: interaction.user.tag });
    } else {
      statusLine = t("wlapp.deniedBy", { by: interaction.user.tag });
    }

    const decided = settleWhitelistApplication(app.id, interaction.user.id, {
      status: approve ? "approved" : "denied",
      mcName,
      decidedBy: interaction.user.tag,
      decidedAt: Date.now(),
    });
    if (!decided) {
      await staleReply();
      return;
    }

    await recordAdminAction({
      action: approve ? "wlapp approve" : "wlapp deny",
      server: decided.serverId,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId,
      detail: `${decided.mcName} (applicant ${decided.userTag})`,
    });

    // Freeze the queue message: final embed, no buttons.
    await interaction.editReply({
      embeds: [buildQueueEmbed(decided, statusLine)],
      components: [],
    });

    // Tell the applicant. Closed DMs are their choice, not an error.
    try {
      const user = await interaction.client.users.fetch(decided.userId);
      await user.send(
        approve
          ? t("wlapp.dmApproved", { name: decided.mcName, server: decided.serverId })
          : t("wlapp.dmDenied", { name: decided.mcName }),
      );
    } catch {
      /* closed DMs */
    }
  });
}
