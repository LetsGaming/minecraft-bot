/**
 * Dashboard copy, English. Keys are `<area>.<name>`, placeholders `{name}`.
 * A key with `.one` / `.other` (and other Intl.PluralRules categories)
 * variants is picked by the `count` placeholder.
 *
 * Terms the bot shares (server, guild, status labels) come from the glossary
 * in @mcbot/schema and are not repeated here.
 */
export const en = {
  "app.name": "Minecraft Bot",
  "app.tagline": "Dashboard",
  "app.pageTitle": "{view} · Minecraft Bot",

  "login.subtitle": "Server dashboard",
  "login.hintLead": "Sign in with the Discord account listed in",
  "login.button": "Log in with Discord",

  "shell.skip": "Skip to content",
  "shell.menuOpen": "Open navigation",
  "shell.menuClose": "Close navigation",
  "shell.navigation": "Navigation",
  "shell.sidebar": "Sidebar",
  "shell.mainNav": "Main",
  "shell.loading": "Loading the dashboard",
  "shell.noServers": "No servers configured",
  "shell.tps": "{tps} TPS",
  "shell.invite": "Add to Discord",
  "shell.inviteHint": "Invite the bot to another Discord guild.",
  "shell.density": "Density",
  "shell.densityComfortable": "Roomy",
  "shell.densityCompact": "Compact",
  "shell.signedInAs": "Signed in as {name}",
  "shell.logout": "Log out",
  "shell.noAccess": "Your account has no dashboard access yet.",
  "shell.noAccessHintLead": "Ask an operator to grant you access under",
  "shell.botDown": "The bot last reported {age}. Changes you save apply when it is back.",
  "shell.botDownNever": "The bot has not reported in yet. Changes you save apply when it starts.",
  "shell.botDownLink": "Open overview",

  "nav.group.monitor": "Monitor",
  "nav.group.manage": "Manage",
  "nav.group.admin": "Admin",
  "nav.overview": "Overview",
  "nav.analytics": "Analytics",
  "nav.console": "Console",
  "nav.audit": "Audit log",
  "nav.servers": "Servers",
  "nav.backups": "Backups",
  "nav.mods": "Mods",
  "nav.modconfig": "Mod config",
  "nav.config": "Config",
  "nav.commands": "Commands",
  "nav.guilds": "Guilds",

  "leave.header": "Discard unsaved changes?",
  "leave.message": "This page has changes that are not saved. Leaving it discards them.",
  "leave.messageServer": "This page has changes that are not saved. Switching server discards them.",
  "leave.accept": "Discard and leave",
  "leave.reject": "Stay",
} as const;

export type EnglishKey = keyof typeof en;
