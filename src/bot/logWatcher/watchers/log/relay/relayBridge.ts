import { enqueueSend } from "../../sendQueue.js";
import type { ResolvedBridge } from "../chatBridge.js";
import { webhookUsername } from "./identity.js";
import type { RelaySyncMap, RelayedCopy } from "./syncMap.js";
import { transformRelayContent, type RelayInput } from "./transform.js";

const TAG = "chatRelay";

export interface RelayTarget {
  guildId: string;
  channelId: string;
  useWebhook?: boolean;
}

export interface RelayPlan {
  group: string;
  serverId: string;
  targets: RelayTarget[];
}

/** How a relayed line reaches Discord; the chat bridge implements it, tests fake it. */
export interface RelaySender {
  send(
    target: RelayTarget,
    post: { username: string; content: string; avatarURL?: string },
  ): Promise<RelayedCopy | null>;
  edit(copy: RelayedCopy, content: string): Promise<void>;
  remove(copy: RelayedCopy): Promise<void>;
}

/**
 * Who a message from this channel is relayed to: every other bridge in the same
 * relay group that is bound to the same Minecraft server. Null when the source
 * bridge has no group or nobody else is in it. A relayed copy is a bot message,
 * which the bridge listener ignores, so relays never chain.
 */
export function planRelay(
  bridgesByGuild: Readonly<Record<string, readonly ResolvedBridge[]>>,
  source: { guildId: string; channelId: string },
): RelayPlan | null {
  const origin = bridgesByGuild[source.guildId]?.find((b) => b.channelId === source.channelId);
  if (!origin?.relayGroup) return null;

  const targets: RelayTarget[] = [];
  const seen = new Set<string>([source.channelId]);
  for (const [guildId, bridges] of Object.entries(bridgesByGuild)) {
    for (const bridge of bridges) {
      if (bridge.relayGroup !== origin.relayGroup || bridge.serverId !== origin.serverId) continue;
      if (seen.has(bridge.channelId)) continue;
      seen.add(bridge.channelId);
      targets.push({ guildId, channelId: bridge.channelId, ...(bridge.useWebhook ? { useWebhook: true } : {}) });
    }
  }
  return targets.length > 0 ? { group: origin.relayGroup, serverId: origin.serverId, targets } : null;
}

export interface RelayRequest {
  sourceMessageId: string;
  input: RelayInput;
  /** The speaker's relay identity, see `relayName`. */
  name: string;
  /** The source guild's label. */
  label: string;
  /** The linked speaker's Minecraft head. Unlinked speakers get none, so the webhook's own avatar shows. */
  avatarURL?: string;
  windowMs: number;
}

/** Send one message to every target in the plan, in order per channel, and remember the copies for edit sync. */
export async function relayMessage(
  plan: RelayPlan,
  request: RelayRequest,
  sender: RelaySender,
  sync: RelaySyncMap,
): Promise<number> {
  const content = transformRelayContent(request.input);
  if (!content) return 0;
  const username = webhookUsername(request.name, request.label);

  const copies: RelayedCopy[] = [];
  await Promise.all(
    plan.targets.map((target) =>
      enqueueSend(target.channelId, async () => {
        const copy = await sender.send(target, {
          username,
          content,
          ...(request.avatarURL ? { avatarURL: request.avatarURL } : {}),
        });
        if (copy) copies.push(copy);
      }, "relayed message", TAG),
    ),
  );
  sync.remember(request.sourceMessageId, copies, request.windowMs);
  return copies.length;
}

/** Apply an edit of the source message to its copies, re-running the same transforms. */
export async function relayEdit(
  sourceMessageId: string,
  input: RelayInput,
  sender: RelaySender,
  sync: RelaySyncMap,
): Promise<void> {
  const copies = sync.copiesOf(sourceMessageId);
  if (!copies) return;
  const content = transformRelayContent(input);
  if (!content) return;
  await Promise.all(copies.map((copy) => enqueueSend(copy.channelId, () => sender.edit(copy, content), "relayed edit", TAG)));
}

/** Delete the copies of a deleted source message. */
export async function relayDelete(
  sourceMessageId: string,
  sender: RelaySender,
  sync: RelaySyncMap,
): Promise<void> {
  const copies = sync.copiesOf(sourceMessageId);
  if (!copies) return;
  sync.forget(sourceMessageId);
  await Promise.all(copies.map((copy) => enqueueSend(copy.channelId, () => sender.remove(copy), "relayed delete", TAG)));
}
