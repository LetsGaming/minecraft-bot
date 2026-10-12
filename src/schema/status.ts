import { ServerState } from "./serverState.js";
import { ConfigApplyState } from "./configStatus.js";

/**
 * The seven status roles the dashboard chips and the Discord embeds share.
 * Colour never carries a state alone: every role has its own shape.
 */
export const StatusRole = {
  Online: "online",
  Degraded: "degraded",
  Offline: "offline",
  Unknown: "unknown",
  Pending: "pending",
  Applied: "applied",
  Info: "info",
} as const;

export type StatusRole = (typeof StatusRole)[keyof typeof StatusRole];

export const StatusShape = {
  FilledCircle: "filled-circle",
  Diamond: "diamond",
  Ring: "ring",
  Dash: "dash",
  DashedRing: "dashed-ring",
  Check: "check",
  /** Spins while the thing it describes is busy. */
  SpinnerCircle: "spinner-circle",
} as const;

export type StatusShape = (typeof StatusShape)[keyof typeof StatusShape];

export interface StatusDefinition {
  name: StatusRole;
  shape: StatusShape;
  /** Foreground hex, the colour of the shape and the label. */
  colour: string;
  /** Chip background hex; the foreground reads on it at 4.7:1 or better. */
  tint: string;
  /** Discord embed colour, the same value as `colour`. */
  embedColour: number;
  /** Glossary key of the human label (see `glossary.ts`). */
  labelKey: string;
}

export const STATUS_TABLE: Readonly<Record<StatusRole, StatusDefinition>> = {
  online: {
    name: "online",
    shape: StatusShape.FilledCircle,
    colour: "#4ade80",
    tint: "#263933",
    embedColour: 0x4ade80,
    labelKey: "status.online",
  },
  degraded: {
    name: "degraded",
    shape: StatusShape.Diamond,
    colour: "#fbbf24",
    tint: "#3a3629",
    embedColour: 0xfbbf24,
    labelKey: "status.degraded",
  },
  offline: {
    name: "offline",
    shape: StatusShape.Ring,
    colour: "#f87171",
    tint: "#3a2d32",
    embedColour: 0xf87171,
    labelKey: "status.offline",
  },
  unknown: {
    name: "unknown",
    shape: StatusShape.Dash,
    colour: "#9aa1ac",
    tint: "#2f3338",
    embedColour: 0x9aa1ac,
    labelKey: "status.unknown",
  },
  pending: {
    name: "pending",
    shape: StatusShape.DashedRing,
    colour: "#b7a1ff",
    tint: "#323341",
    embedColour: 0xb7a1ff,
    labelKey: "status.pending",
  },
  applied: {
    name: "applied",
    shape: StatusShape.Check,
    colour: "#4ade80",
    tint: "#263933",
    embedColour: 0x4ade80,
    labelKey: "status.applied",
  },
  info: {
    name: "info",
    shape: StatusShape.SpinnerCircle,
    colour: "#7cb4ff",
    tint: "#2c3541",
    embedColour: 0x7cb4ff,
    labelKey: "status.info",
  },
};

export const STATUS_ROLES: readonly StatusRole[] = Object.values(StatusRole);

export const SERVER_STATE_ROLE: Readonly<Record<ServerState, StatusRole>> = {
  [ServerState.Online]: StatusRole.Online,
  [ServerState.Unresponsive]: StatusRole.Degraded,
  [ServerState.Offline]: StatusRole.Offline,
  [ServerState.Unknown]: StatusRole.Unknown,
};

export const CONFIG_APPLY_STATE_ROLE: Readonly<Record<ConfigApplyState, StatusRole>> = {
  [ConfigApplyState.Applied]: StatusRole.Applied,
  [ConfigApplyState.Pending]: StatusRole.Pending,
  [ConfigApplyState.BotDown]: StatusRole.Offline,
  [ConfigApplyState.RestartRequired]: StatusRole.Pending,
  [ConfigApplyState.Unknown]: StatusRole.Unknown,
};

export type StatusInput = StatusRole | ServerState | ConfigApplyState;

/**
 * Role names are checked first. The spellings shared with a state
 * ("online", "offline", "unknown", "applied", "pending") map to the
 * identically named role, so the lookup order never changes an answer.
 */
export function statusRole(state: StatusInput): StatusRole {
  if (state in STATUS_TABLE) return state as StatusRole;
  return (
    (SERVER_STATE_ROLE as Record<string, StatusRole | undefined>)[state] ??
    (CONFIG_APPLY_STATE_ROLE as Record<string, StatusRole | undefined>)[state] ??
    StatusRole.Unknown
  );
}

export function statusDefinition(state: StatusInput): StatusDefinition {
  return STATUS_TABLE[statusRole(state)];
}

/** Foreground hex for the state. */
export function statusColor(state: StatusInput): string {
  return statusDefinition(state).colour;
}

/** Discord embed colour for the state. */
export function statusEmbedColor(state: StatusInput): number {
  return statusDefinition(state).embedColour;
}

export function statusShape(state: StatusInput): StatusShape {
  return statusDefinition(state).shape;
}

export function statusLabelKey(state: StatusInput): string {
  return statusDefinition(state).labelKey;
}
