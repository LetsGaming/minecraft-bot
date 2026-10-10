import type { CommandOutcome } from "@mcbot/schema/commandOutcome.js";

export const DELIVERED: CommandOutcome = { kind: "delivered", output: "" };
export const SENT: CommandOutcome = { kind: "sent", via: "screen" };
export const UNREACHABLE: CommandOutcome = {
  kind: "unreachable",
  reason: "wrapper-down",
  detail: "fetch failed",
};

export function delivered(output: string): CommandOutcome {
  return { kind: "delivered", output };
}
