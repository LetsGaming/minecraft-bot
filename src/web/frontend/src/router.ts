import {
  createRouter,
  type LocationQueryRaw,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type RouteParamsRawGeneric,
  type Router,
  type RouterHistory,
} from "vue-router";
import { defineComponent } from "vue";
import type { GrantableCapability } from "./api";
import type { MessageKey } from "./i18n";
import { confirmLeave } from "./composables/useUnsavedGuard";

export type NavId =
  | "overview"
  | "analytics"
  | "console"
  | "audit"
  | "servers"
  | "backups"
  | "mods"
  | "modconfig"
  | "config"
  | "commands"
  | "guilds";

export type NavGate = GrantableCapability | "sysadmin" | "guild";

export interface NavEntry {
  id: NavId;
  labelKey: MessageKey;
  icon: string;
  /** `sysadmin` covers the config surface (bot:config is never granted);
   *  `guild` is the Discord side, which has nothing to do with host access. */
  gate: NavGate;
  /** The route carries the server as its first param. */
  serverScoped: boolean;
  path: string;
}

export interface NavGroup {
  id: "monitor" | "manage" | "admin";
  labelKey: MessageKey;
  items: NavEntry[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "monitor",
    labelKey: "nav.group.monitor",
    items: [
      { id: "overview", labelKey: "nav.overview", icon: "pi pi-th-large", gate: "server:read", serverScoped: false, path: "/overview" },
      { id: "analytics", labelKey: "nav.analytics", icon: "pi pi-chart-bar", gate: "server:read", serverScoped: true, path: "/analytics/:server?" },
      { id: "console", labelKey: "nav.console", icon: "pi pi-desktop", gate: "server:read", serverScoped: true, path: "/console/:server?" },
      { id: "audit", labelKey: "nav.audit", icon: "pi pi-history", gate: "audit:read", serverScoped: false, path: "/audit" },
    ],
  },
  {
    id: "manage",
    labelKey: "nav.group.manage",
    items: [
      { id: "servers", labelKey: "nav.servers", icon: "pi pi-server", gate: "server:read", serverScoped: false, path: "/servers" },
      { id: "backups", labelKey: "nav.backups", icon: "pi pi-database", gate: "server:read", serverScoped: true, path: "/backups/:server?" },
      { id: "mods", labelKey: "nav.mods", icon: "pi pi-download", gate: "mods:read", serverScoped: true, path: "/mods/:server?" },
      { id: "modconfig", labelKey: "nav.modconfig", icon: "pi pi-sliders-h", gate: "config:read", serverScoped: true, path: "/modconfig/:server?/:fileId?" },
    ],
  },
  {
    id: "admin",
    labelKey: "nav.group.admin",
    items: [
      { id: "config", labelKey: "nav.config", icon: "pi pi-cog", gate: "sysadmin", serverScoped: false, path: "/config/:mode(raw)?" },
      { id: "commands", labelKey: "nav.commands", icon: "pi pi-bolt", gate: "sysadmin", serverScoped: false, path: "/commands" },
      { id: "guilds", labelKey: "nav.guilds", icon: "pi pi-discord", gate: "guild", serverScoped: false, path: "/guilds/:guildId?" },
    ],
  },
];

export const NAV_ENTRIES: readonly NavEntry[] = NAV_GROUPS.flatMap((g) => g.items);

declare module "vue-router" {
  interface RouteMeta {
    nav?: NavId;
  }
}

/**
 * The shell renders the views itself rather than through `<RouterView>`, so
 * Servers can stay mounted on every route (it owns the status poll that feeds
 * the server picker). Routes therefore only carry a placeholder component.
 */
const ShellRendered = defineComponent({ name: "ShellRendered", render: () => null });

export type LeaveReason = "leave" | "server";

/** Asks whether unsaved work may be thrown away; resolves true to leave. */
export type LeavePrompt = (reason: LeaveReason) => Promise<boolean>;

export function navOf(route: RouteLocationNormalized): NavId | undefined {
  return route.meta.nav;
}

export function serverOf(route: Pick<RouteLocationNormalized, "params">): string {
  const value = route.params.server;
  return typeof value === "string" ? value : "";
}

/**
 * What a navigation from `from` to `to` would throw away. Views unmount when
 * the destination changes and reload when the server changes; a server filled
 * into a route that had none and in-view state (open file, filters, raw mode)
 * keep the view as it is, so they need no question here. The views guard
 * their own in-view switches.
 */
export function leaveReason(
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
): LeaveReason | null {
  if (from.matched.length === 0) return null;
  if (navOf(to) !== navOf(from)) return "leave";
  const before = serverOf(from);
  const after = serverOf(to);
  if (before && after && before !== after) return "server";
  return null;
}

export function createAppRouter(history: RouterHistory, ask: LeavePrompt): Router {
  const router = createRouter({
    history,
    routes: [
      { path: "/", name: "home", component: ShellRendered },
      ...NAV_ENTRIES.map((entry) => ({
        path: entry.path,
        name: entry.id,
        component: ShellRendered,
        meta: { nav: entry.id },
      })),
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });

  router.beforeEach(async (to, from) => {
    const reason = leaveReason(to, from);
    if (!reason) return true;
    return confirmLeave(() => ask(reason));
  });

  return router;
}

/** Drops empty values, so an unset param or filter leaves no trace in the URL. */
function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

/** The location of a nav entry, on `server` when the entry is server scoped. */
export function navLocation(entry: NavEntry, server: string): RouteLocationRaw {
  return {
    name: entry.id,
    params: entry.serverScoped ? compact({ server }) : {},
  };
}

export interface RoutePatch {
  params?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
}

/** The current route with some params or query values replaced. */
export function patchedLocation(
  route: RouteLocationNormalized,
  patch: RoutePatch,
): RouteLocationRaw {
  return {
    name: route.name ?? undefined,
    params: compact({ ...route.params, ...patch.params }) as RouteParamsRawGeneric,
    query: compact({ ...route.query, ...patch.query }) as LocationQueryRaw,
  };
}
