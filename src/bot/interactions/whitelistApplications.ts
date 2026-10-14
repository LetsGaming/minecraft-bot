/**
 * Whitelist applications — non-admins request access with a button, a
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
 * global interactionCreate handler — NOT collectors — so buttons keep
 * working across restarts. data/whitelistApplications.json owns the
 * pending queue and the prompt-message bookkeeping.
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
import { kvGet, kvUpdate } from "@mcbot/core/db/kv.js";
import { loadConfig, getServerIds } from "@mcbot/core/config.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  resolveDefaultServerId,
  visibleServerIdsForGuild,
} from "@mcbot/core/utils/server/guildTargets.js";
import { isServerAdmin, getMemberRoleIds } from "../commands/middleware.js";
import { performWhitelistAdd } from "../commands/shared/whitelistAdd.js";
import { createEmbed } from "../utils/embeds/embedUtils.js";
import { EmbedColor } from "../utils/embeds/embedColors.js";
import { roleMention } from "../utils/embeds/alertUtils.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../utils/guild/guildConfigs.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const APPLY_ID = "wlapp:apply";
const MODAL_ID = "wlapp:modal";
const APPROVE_PREFIX = "wlapp:approve:";
const DENY_PREFIX = "wlapp:deny:";

/** Pending applications per user per guild (spam guard). */
const MAX_PENDING_PER_USER = 1;

/**
 * Decided-application history kept per store (pending applications are
 * never trimmed — they still need a working Approve/Deny button).
 * Storage audit: this array only ever grew via push(), so it was the
 * kv_store's one truly unbounded blob.
 */
const MAX_DECIDED_APPLICATIONS = 200;

export type ApplicationStatus = "pending" | "approved" | "denied";

export interface WhitelistApplication {
  id: string;
  guildId: string;
  userId: string;
  userTag: string;
  mcName: string;
  note?: string;
  serverId: string;
  status: ApplicationStatus;
  createdAt: number;
  decidedBy?: string;
  decidedAt?: number;
}

interface ApplicationStore {
  version: 1;
  /** guildId → the persistent Apply prompt message. */
  prompts: Record<string, { channelId: string; messageId: string }>;
  applications: WhitelistApplication[];
}

async function loadStore(): Promise<ApplicationStore> {
  const raw = kvGet<Partial<ApplicationStore>>("whitelistApplications");
  return {
    version: 1,
    prompts: raw?.prompts ?? {},
    applications: raw?.applications ?? [],
  };
}

/**
 * AUD-005: change the store in one transaction against what is on disk
 * now. Every caller awaits Discord between deciding and writing; saving a
 * copy loaded before those awaits wrote it over applications submitted or
 * decided in the meantime (an approved one could go back to pending).
 */
async function updateStore<T>(fn: (store: ApplicationStore) => T): Promise<T> {
  let out!: T;
  kvUpdate<Partial<ApplicationStore>>("whitelistApplications", (raw) => {
    const store: ApplicationStore = {
      version: 1,
      prompts: raw?.prompts ?? {},
      applications: raw?.applications ?? [],
    };
    out = fn(store);
    // Trim decided history; pending applications always survive.
    const pending = store.applications.filter((a) => a.status === "pending");
    const decided = store.applications
      .filter((a) => a.status !== "pending")
      .sort((a, b) => (a.decidedAt ?? 0) - (b.decidedAt ?? 0))
      .slice(-MAX_DECIDED_APPLICATIONS);
    store.applications = [...decided, ...pending].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    return store;
  });
  return out;
}

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
 * and on config reload — idempotent by design.
 */
export async function ensureApplicationPrompts(
  client: Client,
  guildConfigs: GuildConfigSource,
): Promise<void> {
  const store = await loadStore();
  const posted: ApplicationStore["prompts"] = {};

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
          if (msg) continue; // prompt alive — nothing to do
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
    await updateStore((current) => {
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
    // target — better than bouncing them with a config error.
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
    // select. Re-validate against the visible set — customIds and modal
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

    const pendingCount = (store: ApplicationStore): number =>
      store.applications.filter(
        (a) =>
          a.status === "pending" &&
          a.guildId === guildId &&
          a.userId === interaction.user.id,
      ).length;
    if (pendingCount(await loadStore()) >= MAX_PENDING_PER_USER) {
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

    // Queue post first — an application nobody can see must not exist.
    const channel = await interaction.client.channels
      .fetch(adminChannelId)
      .catch(() => null);
    if (!channel || !("send" in channel)) {
      await interaction.editReply({ content: t("wlapp.queueBroken") });
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
    await channel.send({
      embeds: [buildQueueEmbed(app)],
      components: [row],
      ...roleMention(cfg.mentionRole),
    });

    const accepted = await updateStore((current) => {
      // Re-checked here: a second submit may have landed during the post.
      if (pendingCount(current) >= MAX_PENDING_PER_USER) return false;
      current.applications.push(app);
      return true;
    });
    if (!accepted) {
      await interaction.editReply({ content: t("wlapp.alreadyPending") });
      return;
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
    // Buttons bypass the slash middleware — enforce the exact same
    // admin check here (queue channels can be misconfigured as public).
    const allowed = isServerAdmin(
      interaction.user.id,
      getMemberRoleIds(interaction),
      guildId,
    );
    if (!allowed) {
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

    const store = await loadStore();
    const app = store.applications.find((a) => a.id === appId);
    if (!app || app.status !== "pending") {
      // Stale button (already decided, or the store was pruned).
      await interaction.followUp({
        content: t("wlapp.stale"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let statusLine: string;
    if (approve) {
      const server = getServerInstance(app.serverId);
      if (!server) {
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
        app.mcName = added.name;
      } catch (err) {
        const msg = errMsg(err);
        await interaction.followUp({
          content: t("wlapp.approveFailed", { error: msg }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      app.status = "approved";
      statusLine = t("wlapp.approvedBy", { by: interaction.user.tag });
    } else {
      app.status = "denied";
      statusLine = t("wlapp.deniedBy", { by: interaction.user.tag });
    }

    app.decidedBy = interaction.user.tag;
    app.decidedAt = Date.now();
    const recorded = await updateStore((current) => {
      const target = current.applications.find((a) => a.id === app.id);
      // Decided by another admin while this one was whitelisting.
      if (!target || target.status !== "pending") return false;
      Object.assign(target, app);
      return true;
    });
    if (!recorded) {
      await interaction.followUp({
        content: t("wlapp.stale"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await recordAdminAction({
      action: approve ? "wlapp approve" : "wlapp deny",
      server: app.serverId,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId,
      detail: `${app.mcName} (applicant ${app.userTag})`,
    });

    // Freeze the queue message: final embed, no buttons.
    await interaction.editReply({
      embeds: [buildQueueEmbed(app, statusLine)],
      components: [],
    });

    // Tell the applicant. Closed DMs are their choice, not an error.
    try {
      const user = await interaction.client.users.fetch(app.userId);
      await user.send(
        approve
          ? t("wlapp.dmApproved", { name: app.mcName, server: app.serverId })
          : t("wlapp.dmDenied", { name: app.mcName }),
      );
    } catch {
      /* closed DMs */
    }
  });
}
