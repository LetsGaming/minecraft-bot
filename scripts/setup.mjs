#!/usr/bin/env node

/**
 * setup.mjs — Interactive configuration wizard for the Minecraft Discord Bot.
 *
 * Usage:
 *   node setup.mjs          Generate a new config.json interactively
 *   node setup.mjs --edit   Edit an existing config.json
 *
 * SCHEMA-DRIVEN: the wizard reads config.schema.json (generated from
 * RawBotConfig by `npm run schema:generate`, kept in sync by CI) and
 * derives its prompts, hints, enums, and section structure from it.
 * Only the flows where interaction order matters are hand-curated:
 * credentials, admin users, servers (local vs REMOTE via the API
 * wrapper), and the per-guild feature walk. Everything else — presence,
 * hostAlerts, limits, webui, schedules, … — comes from a generic schema
 * walker, so NEW top-level sections and NEW fields inside existing
 * sections appear in the wizard automatically the moment the schema
 * regenerates, without touching this file.
 *
 * Editing semantics: existing values become defaults; declining to
 * configure a section keeps what is already in config.json (explicit
 * removal is offered, never silent). Unknown keys are preserved.
 */

import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "config.json");
const SCHEMA_PATH = resolve(ROOT, "config.schema.json");

// ── Colours ──

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Line-queue input: with piped stdin, ALL lines (and EOF) can arrive in
// the first chunk — rl.question would then see `close` fire while later
// questions are still pending. Queue lines ourselves so scripted input
// (tests, provisioning) pairs deterministically with prompts, and
// resolve outstanding asks with "" once stdin truly runs dry.
let rlClosed = false;
/** @type {string[]} */
const queuedLines = [];
/** @type {((s: string) => void)[]} */
const waiters = [];
rl.on("line", (l) => {
  const w = waiters.shift();
  if (w) w(l);
  else queuedLines.push(l);
});
rl.on("close", () => {
  rlClosed = true;
  while (waiters.length) waiters.shift()?.("");
});

/** @param {string} q @returns {Promise<string>} */
function ask(q) {
  process.stdout.write(q);
  const queued = queuedLines.shift();
  if (queued !== undefined) {
    process.stdout.write("\n");
    return Promise.resolve(queued.trim());
  }
  if (rlClosed) {
    process.stdout.write("\n");
    return Promise.resolve("");
  }
  return new Promise((res) => waiters.push((l) => res(l.trim())));
}

/** Mask secrets when shown as a bracketed default. @param {string} v */
function maskSecret(v) {
  if (v.length <= 6) return "•".repeat(v.length);
  return `${"•".repeat(6)}…${v.slice(-4)}`;
}

/** @param {string} name Field name → should its default be masked? */
function isSecretField(name) {
  return /token|password|apikey|secret|(^|[a-z])key$/i.test(name);
}

/**
 * Prompt with a default value shown in brackets.
 * @param {string} label
 * @param {string} [fallback]
 * @param {{ secret?: boolean }} [opts]
 * @returns {Promise<string>}
 */
async function prompt(label, fallback = "", opts = {}) {
  const shown = opts.secret && fallback ? maskSecret(fallback) : fallback;
  const suffix = fallback ? ` ${C.dim}[${shown}]${C.reset}` : "";
  const answer = await ask(`  ${C.cyan}?${C.reset} ${label}${suffix}: `);
  return answer || fallback;
}

/**
 * Yes/no prompt.
 * @param {string} label
 * @param {boolean} [fallback]
 * @returns {Promise<boolean>}
 */
async function confirm(label, fallback = true) {
  const hint = fallback ? "Y/n" : "y/N";
  const answer = await ask(
    `  ${C.cyan}?${C.reset} ${label} ${C.dim}(${hint})${C.reset}: `,
  );
  if (!answer) return fallback;
  return answer.toLowerCase().startsWith("y");
}

/** @param {string} msg */
function heading(msg) {
  console.log(`\n${C.bold}${C.magenta}── ${msg} ──${C.reset}\n`);
}

/** @param {string} msg */
function info(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

/** @param {string} msg */
function warn(msg) {
  console.log(`  ${C.yellow}!${C.reset} ${msg}`);
}

/** @param {string} msg */
function hint(msg) {
  console.log(`  ${C.dim}${msg}${C.reset}`);
}

/** Print a (possibly long) schema description as wrapped hint lines.
 * @param {string | undefined} desc */
function describe(desc) {
  if (!desc) return;
  const words = desc.replace(/\s+/g, " ").trim().split(" ");
  let line = "";
  for (const w of words) {
    if ((line + " " + w).length > 74) {
      hint(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) hint(line);
}

// ── Validators ──

/** @param {string} s */
function isSnowflake(s) {
  return /^\d{17,20}$/.test(s);
}

/** @param {string} s */
function isToken(s) {
  // Discord bot tokens are base64-ish, usually 59+ chars with dots
  return s.length >= 50 && s.includes(".");
}

/**
 * Mirror of core's validateApiUrl transport rules (src/core/config.ts):
 * https is fine; plain http is acceptable only toward loopback/private
 * hosts — the x-api-key and all server-control commands travel
 * unencrypted otherwise.
 * @param {string} raw
 * @returns {{ level: "ok" | "warn" | "insecure" | "invalid", message?: string }}
 */
function checkApiUrlTransport(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { level: "invalid", message: "Not a valid URL." };
  }
  if (url.protocol === "https:") return { level: "ok" };
  if (url.protocol !== "http:") {
    return { level: "invalid", message: `Unsupported protocol ${url.protocol}` };
  }
  const h = url.hostname;
  const isPrivate =
    h === "localhost" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^\[?::1\]?$/.test(h) ||
    h.endsWith(".local") ||
    h.endsWith(".lan");
  if (isPrivate) {
    return {
      level: "warn",
      message:
        "Plaintext HTTP to a private/LAN host — acceptable only on a trusted segment.",
    };
  }
  return {
    level: "insecure",
    message:
      "Plaintext http:// to a PUBLIC host would expose the x-api-key and full " +
      "server-control traffic to the network. Use https:// (reverse proxy in " +
      "front of the wrapper), or set allowInsecureHttp if this host is on a " +
      "trusted segment the bot cannot detect.",
  };
}

// ── Schema access ──

/** @type {Record<string, any>} */
let SCHEMA_DEFS = {};

function loadSchema() {
  if (!existsSync(SCHEMA_PATH)) {
    warn("config.schema.json not found — falling back to minimal prompts.");
    warn("Run `npm run schema:generate` for the full schema-driven wizard.");
    return null;
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  SCHEMA_DEFS = schema.definitions ?? {};
  return schema;
}

/** Follow $ref chains into definitions. @param {any} node */
function deref(node) {
  let n = node;
  const seen = new Set();
  while (n && n.$ref) {
    const name = String(n.$ref).split("/").pop() ?? "";
    if (seen.has(name)) break;
    seen.add(name);
    n = SCHEMA_DEFS[name];
  }
  return n ?? {};
}

/** First sentence of a schema description — used as the prompt label hint.
 * @param {any} node */
function shortDesc(node) {
  const d = deref(node)?.description ?? node?.description;
  if (!d) return "";
  const first = String(d).split(/(?<=\.)\s/)[0];
  return first.length > 90 ? "" : first;
}

/**
 * Is this node the ServerScope shape (string | string[])? Detected
 * structurally so a renamed type keeps working.
 * @param {any} node
 */
function isServerScope(node) {
  const n = deref(node);
  const variants = n?.anyOf ?? n?.oneOf;
  if (!Array.isArray(variants) || variants.length !== 2) return false;
  const kinds = variants.map((v) => {
    const r = deref(v);
    if (r.type === "string") return "s";
    if (r.type === "array" && deref(r.items ?? {}).type === "string") return "a";
    return "?";
  });
  return kinds.includes("s") && kinds.includes("a");
}

// ── Generic schema-driven prompting ──
// This is the auto-expansion engine: any property reachable from the
// schema gets a prompt derived from its type, enum, and JSDoc
// description. Field-name heuristics add validation (snowflakes for
// channel/role IDs, HH:MM for times) and completion hints (configured
// server IDs for `server` scopes).

/**
 * @typedef {Object} WalkCtx
 * @property {string[]} serverIds Configured server IDs (for scope hints)
 * @property {number} depth
 */

/**
 * Prompt for one schema property. Returns undefined when skipped.
 * @param {string} name
 * @param {any} rawNode
 * @param {any} existing
 * @param {WalkCtx} ctx
 * @returns {Promise<any>}
 */
async function promptValue(name, rawNode, existing, ctx) {
  const node = deref(rawNode);

  // string | string[] server scope
  if (isServerScope(node) || rawNode?.$ref?.endsWith("/ServerScope")) {
    const cur = Array.isArray(existing) ? existing.join(", ") : (existing ?? "");
    if (ctx.serverIds.length > 0) {
      hint(`Configured servers: ${ctx.serverIds.join(", ")} — empty = all visible.`);
    }
    const ans = await prompt(`${name} (one ID, comma list, or empty)`, cur);
    if (!ans) return undefined;
    const list = ans.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = list.filter((s) => ctx.serverIds.length && !ctx.serverIds.includes(s));
    if (unknown.length) warn(`Unknown server ID(s): ${unknown.join(", ")} — kept anyway.`);
    return list.length === 1 ? list[0] : list;
  }

  // Unions we cannot meaningfully prompt generically → keep existing.
  if (node.anyOf || node.oneOf) return existing;

  switch (node.type) {
    case "boolean": {
      return confirm(name, existing === true);
    }

    case "string": {
      if (Array.isArray(node.enum)) {
        const cur = existing !== undefined ? String(existing) : "";
        let v = await prompt(`${name} (${node.enum.join("/")})`, cur);
        while (v && !node.enum.includes(v) && !rlClosed) {
          warn(`Must be one of: ${node.enum.join(", ")}`);
          v = await prompt(`${name} (${node.enum.join("/")})`, cur);
        }
        return v && node.enum.includes(v) ? v : undefined;
      }
      const secret = isSecretField(name);
      const needsSnowflake =
        /channelid$/i.test(name) || /(mention|linked)role$/i.test(name);
      let v = await prompt(name, existing ?? "", { secret });
      while (v && needsSnowflake && !isSnowflake(v) && !rlClosed) {
        warn("Expected a Discord ID (17–20 digit snowflake).");
        v = await prompt(name, "", { secret });
      }
      if (v && needsSnowflake && !isSnowflake(v)) return undefined;
      if (v && name === "time" && !/^\d{1,2}:\d{2}$/.test(v)) {
        warn(`"${v}" does not look like HH:MM — kept anyway.`);
      }
      return v || undefined;
    }

    case "number":
    case "integer": {
      const cur = existing !== undefined ? String(existing) : "";
      const v = await prompt(name, cur);
      if (!v) return undefined;
      const n = Number(v);
      if (Number.isNaN(n)) {
        warn(`"${v}" is not a number — skipped.`);
        return existing;
      }
      return node.type === "integer" ? Math.trunc(n) : n;
    }

    case "array": {
      const items = deref(node.items ?? {});
      const cur = Array.isArray(existing) ? existing.join(", ") : "";
      const v = await prompt(`${name} (comma-separated)`, cur);
      if (!v) return undefined;
      const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
      if (items.type === "number" || items.type === "integer") {
        const nums = parts.map(Number).filter((n) => !Number.isNaN(n));
        if (nums.length !== parts.length) warn("Non-numeric entries were dropped.");
        return nums.length ? nums : undefined;
      }
      return parts.length ? parts : undefined;
    }

    case "object":
      return promptObject(name, node, existing, ctx);

    default:
      // No type (e.g. Record<string, unknown>) — not promptable; keep as-is.
      return existing;
  }
}

/**
 * Prompt for an object node: fixed properties are walked field by
 * field; Record-style objects (additionalProperties) become a keyed
 * add-entry loop.
 * @param {string} name
 * @param {any} node
 * @param {any} existing
 * @param {WalkCtx} ctx
 * @returns {Promise<any>}
 */
async function promptObject(name, node, existing, ctx) {
  // Record<string, X>
  if (node.additionalProperties && typeof node.additionalProperties === "object") {
    const valueNode = deref(node.additionalProperties);
    /** @type {Record<string, any>} */
    const out = { ...(existing ?? {}) };
    const keys = Object.keys(out);
    if (keys.length) info(`${name}: existing entries — ${keys.join(", ")}`);
    if (name === "schedules" && ctx.serverIds.length) {
      hint(`Keys are server IDs (${ctx.serverIds.join(", ")}).`);
    }
    let more = await confirm(`Add ${keys.length ? "another" : "an"} ${name} entry?`, false);
    while (more) {
      const key = await prompt(`${name} key`);
      if (!key) break;
      const v = await promptValue(key, node.additionalProperties, out[key], {
        ...ctx,
        depth: ctx.depth + 1,
      });
      if (v !== undefined) out[key] = v;
      more = await confirm(`Add another ${name} entry?`, false);
    }
    return Object.keys(out).length ? out : undefined;
  }

  const props = node.properties ?? {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, propNode] of Object.entries(props)) {
    const resolved = deref(propNode);
    const desc = resolved?.description ?? /** @type {any} */ (propNode)?.description;

    if (resolved.type === "object" && !resolved.additionalProperties) {
      // Nested fixed-shape section: opt in (default: already configured)
      const has = existing?.[key] !== undefined;
      describe(desc);
      if (await confirm(`Configure ${key}?`, has)) {
        const v = await promptObject(key, resolved, existing?.[key], {
          ...ctx,
          depth: ctx.depth + 1,
        });
        if (v !== undefined) out[key] = v;
      } else if (has) {
        out[key] = existing[key]; // declined ≠ delete
      }
      continue;
    }

    describe(desc);
    const v = await promptValue(key, propNode, existing?.[key], ctx);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── Main ──

async function main() {
  const isEdit = process.argv.includes("--edit");
  const schema = loadSchema();
  const rootNode = schema ? deref(schema) : { properties: {} };
  const rootProps = rootNode.properties ?? {};

  /** @type {Record<string, any>} */
  let existing = {};
  if (isEdit || existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      warn("Existing config.json could not be parsed, starting fresh.");
      existing = {};
    }
  }

  if (existsSync(CONFIG_PATH) && !isEdit) {
    const overwrite = await confirm(
      "config.json already exists. Overwrite?",
      false,
    );
    if (!overwrite) {
      info("Aborted. Use --edit to modify the existing config.");
      rl.close();
      return;
    }
  }

  console.log(
    `\n${C.bold}${C.green}Minecraft Discord Bot — Setup Wizard${C.reset}`,
  );
  hint(
    "Press Enter to accept defaults shown in [brackets].\n  Leave optional fields empty to skip.\n",
  );

  // ─── Discord credentials ───

  heading("Discord Credentials");
  hint("Create a bot at https://discord.com/developers/applications");

  let token = await prompt("Bot token", existing.token ?? "", { secret: true });
  while (token && !isToken(token) && !rlClosed) {
    warn("That doesn't look like a valid bot token.");
    token = await prompt("Bot token", "", { secret: true });
  }

  let clientId = await prompt(
    "Client ID (Application ID)",
    existing.clientId ?? "",
  );
  while (clientId && !isSnowflake(clientId) && !rlClosed) {
    warn("Client ID should be a numeric snowflake (17–20 digits).");
    clientId = await prompt("Client ID");
  }

  // ─── Admin users ───

  heading("Admin Users");
  describe(deref(rootProps.adminUsers)?.description);
  hint("Discord user IDs (and/or role IDs) that can use admin commands.");
  hint(
    "Right-click your profile → Copy User ID (enable Developer Mode first).",
  );

  /** @type {string[]} */
  const adminUsers = [...(existing.adminUsers ?? [])];
  if (adminUsers.length > 0) {
    info(`Current admins: ${adminUsers.join(", ")}`);
  }

  let addMore = adminUsers.length === 0;
  if (adminUsers.length > 0) {
    addMore = await confirm("Add more admin users?", false);
  }

  while (addMore) {
    const id = await prompt("Admin user/role ID (empty to stop)");
    if (!id) break;
    if (!isSnowflake(id)) {
      warn("Not a valid snowflake, skipping.");
      continue;
    }
    if (!adminUsers.includes(id)) adminUsers.push(id);
    info(`Added ${id}`);
  }

  // ─── Servers ───

  heading("Minecraft Servers");
  hint("Configure one or more Minecraft server instances.");
  hint("LOCAL   — the bot runs on the same machine as the server.");
  hint("REMOTE  — the server runs elsewhere, reached through the API");
  hint("          wrapper (mc-api-server) over HTTP(S).");

  /** @type {Record<string, any>} */
  const servers = {};
  const existingServers = existing.servers ?? {};
  const existingServerIds = Object.keys(existingServers);
  const serverSchema = deref(rootProps.servers?.additionalProperties ?? {});

  if (existingServerIds.length > 0) {
    info(`Existing servers: ${existingServerIds.join(", ")}`);
    for (const id of existingServerIds) {
      const keep = await confirm(`Keep server "${id}"?`, true);
      if (keep) {
        servers[id] = existingServers[id];
        const edit = await confirm(`  Edit "${id}" settings?`, false);
        if (edit) {
          servers[id] = await configureServer(id, existingServers[id], serverSchema);
        }
      }
    }
  }

  let addServer = Object.keys(servers).length === 0;
  if (!addServer) addServer = await confirm("Add another server?", false);

  while (addServer) {
    const id = await prompt("Server ID (e.g. survival, creative)");
    if (!id) break;
    servers[id] = await configureServer(id, {}, serverSchema);
    info(`Server "${id}" configured.`);
    addServer = await confirm("Add another server?", false);
  }

  const serverIds = Object.keys(servers);
  /** @type {WalkCtx} */
  const ctx = { serverIds, depth: 0 };

  // ─── Guilds ───

  heading("Discord Guild (Server) Configuration");
  hint("Configure which Discord server gets which features.");

  /** @type {Record<string, any>} */
  const guilds = {};
  const existingGuilds = existing.guilds ?? {};
  const existingGuildIds = Object.keys(existingGuilds);
  const guildSchema = deref(rootProps.guilds?.additionalProperties ?? {});

  if (existingGuildIds.length > 0) {
    for (const gid of existingGuildIds) {
      const keep = await confirm(`Keep guild ${gid}?`, true);
      if (keep) {
        guilds[gid] = existingGuilds[gid];
        const edit = await confirm(`  Edit guild ${gid}?`, false);
        if (edit) {
          guilds[gid] = await configureGuild(gid, existingGuilds[gid], guildSchema, ctx);
        }
      }
    }
  }

  let addGuild = Object.keys(guilds).length === 0;
  if (!addGuild) addGuild = await confirm("Add another guild?", false);

  while (addGuild) {
    const gid = await prompt("Guild ID (right-click server → Copy Server ID)");
    if (!gid) break;
    if (!isSnowflake(gid)) {
      warn("Not a valid snowflake.");
      continue;
    }
    guilds[gid] = await configureGuild(gid, {}, guildSchema, ctx);
    info(`Guild ${gid} configured.`);
    addGuild = await confirm("Add another guild?", false);
  }

  // ─── Everything else: schema-driven global sweep ───
  // Every top-level RawBotConfig property not handled above is offered
  // here, straight from the schema — new sections appear automatically.

  /** @type {Record<string, any>} */
  const config = {
    $schema: "./config.schema.json",
    token,
    clientId,
    adminUsers,
    servers,
    guilds,
  };

  const CURATED = new Set(["token", "clientId", "adminUsers", "servers", "guilds"]);
  // Power-user blocks the wizard preserves but does not prompt for —
  // the dashboard's Commands view (or a text editor) is the better UI.
  const PRESERVE_ONLY = new Set(["commands", "leaderboard", "milestones"]);

  heading("Global Settings");
  hint("Optional features and tuning. Enter keeps the shown default;");
  hint("declining a section keeps its existing configuration.");

  for (const [key, propNode] of Object.entries(rootProps)) {
    if (CURATED.has(key)) continue;
    if (PRESERVE_ONLY.has(key)) {
      if (existing[key] !== undefined) {
        config[key] = existing[key];
        info(`Preserved: ${key} (edit via dashboard or config.json)`);
      }
      continue;
    }

    const node = deref(propNode);
    const desc = node?.description ?? /** @type {any} */ (propNode)?.description;
    const has = existing[key] !== undefined;

    if (node.type === "object") {
      console.log();
      describe(desc);
      if (await confirm(`Configure ${key}?`, has)) {
        const v = await promptObject(key, node, existing[key], ctx);
        if (v !== undefined) config[key] = v;
        else if (has && !(await confirm(`Remove existing ${key} config?`, false))) {
          config[key] = existing[key];
        }
      } else if (has) {
        if (await confirm(`Remove existing ${key} config?`, false)) {
          info(`Removed: ${key}`);
        } else {
          config[key] = existing[key];
        }
      }
      continue;
    }

    describe(desc);
    const v = await promptValue(key, propNode, existing[key], ctx);
    if (v !== undefined) config[key] = v;
  }

  // Preserve unknown top-level keys (forward/backward compatibility)
  for (const [key, value] of Object.entries(existing)) {
    if (key === "$schema") continue;
    if (!(key in config) && !(key in rootProps)) {
      config[key] = value;
      info(`Preserved unknown key: ${key}`);
    }
  }

  // ─── Write ───

  heading("Summary");
  const remotes = serverIds.filter((id) => servers[id]?.apiUrl);
  console.log(`  Servers: ${serverIds.join(", ") || "none"}`);
  if (remotes.length) console.log(`  Remote:  ${remotes.join(", ")} (via API wrapper)`);
  console.log(`  Guilds:  ${Object.keys(guilds).length}`);
  console.log(`  Admins:  ${adminUsers.length}`);
  console.log();

  const doWrite = await confirm("Write config.json?", true);
  if (!doWrite) {
    warn("Aborted. No changes written.");
    rl.close();
    return;
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  info(`Config written to ${CONFIG_PATH}`);

  // Best-effort validation with the bot's own validator (needs a build).
  try {
    const mod = await import(
      new URL("../src/core/dist/utils/configService.js", import.meta.url).href
    );
    const result = mod.validateCandidate(config);
    if (result.valid) {
      info("Config passes the bot's own validation.");
    } else {
      warn("The bot's validator reports problems:");
      for (const e of result.errors) hint(e);
    }
    for (const w of result.warnings ?? []) warn(w);
  } catch {
    hint("(Skipped deep validation — run `npm run build` to enable it.)");
  }

  console.log();
  hint("Next steps:");
  hint("  node scripts/start.mjs setup   — Build & start the bot");
  hint("  node scripts/start.mjs dev     — Start in development mode");
  console.log();

  rl.close();
}

/**
 * Configure a single Minecraft server instance — local (same machine)
 * or remote (through the mc-api-server wrapper). Fields not covered by
 * the curated flow are offered from the schema under "advanced", so new
 * RawServerConfig fields surface automatically.
 * @param {string} id
 * @param {Record<string, any>} existing
 * @param {any} serverSchema Resolved RawServerConfig schema node
 * @returns {Promise<Record<string, any>>}
 */
async function configureServer(id, existing, serverSchema) {
  console.log();
  hint(`Configuring server: ${id}`);

  const wasRemote = !!existing.apiUrl;
  const remote = await confirm(
    "Is this a REMOTE instance (reached via the API wrapper)?",
    wasRemote,
  );

  /** @type {Record<string, any>} */
  const server = {};

  if (remote) {
    describe(deref(serverSchema.properties?.apiUrl)?.description);
    let apiUrl = "";
    for (;;) {
      if (rlClosed) break;
      apiUrl = await prompt(
        "API wrapper base URL (e.g. https://mc-api.example.com or http://192.168.1.10:3000)",
        existing.apiUrl ?? "",
      );
      if (!apiUrl) {
        warn("A remote instance needs an apiUrl.");
        continue;
      }
      const check = checkApiUrlTransport(apiUrl);
      if (check.level === "ok") break;
      if (check.level === "warn") {
        warn(check.message ?? "");
        break;
      }
      if (check.level === "insecure") {
        warn(check.message ?? "");
        if (await confirm("Set allowInsecureHttp and continue anyway?", false)) {
          server.allowInsecureHttp = true;
          break;
        }
        continue;
      }
      warn(check.message ?? "Invalid URL.");
    }
    server.apiUrl = apiUrl;

    describe(deref(serverSchema.properties?.apiKey)?.description);
    let apiKey = await prompt("API key (x-api-key of the wrapper)",
      existing.apiKey ?? "", { secret: true });
    while (!apiKey && !rlClosed) {
      warn("The wrapper refuses keyless requests — an API key is required.");
      apiKey = await prompt("API key", "", { secret: true });
    }
    server.apiKey = apiKey;
    hint("Filesystem, scripts, logs, and console for this instance are");
    hint("forwarded to the wrapper — no local paths needed.");
  } else {
    server.serverDir = await prompt(
      "Server directory (absolute path to MC server root)",
      existing.serverDir ?? "",
    );
    server.linuxUser = await prompt(
      "Linux user that owns the server files",
      existing.linuxUser ?? "minecraft",
    );
    server.screenSession = await prompt(
      "Screen session name",
      existing.screenSession ?? id,
    );

    server.useRcon = await confirm("Use RCON?", existing.useRcon ?? true);
    if (server.useRcon) {
      server.rconHost = await prompt(
        "RCON host",
        existing.rconHost ?? "localhost",
      );
      server.rconPort = parseInt(
        await prompt("RCON port", String(existing.rconPort ?? 25575)),
        10,
      );
      server.rconPassword = await prompt(
        "RCON password",
        existing.rconPassword ?? "",
        { secret: true },
      );
    }

    const hasScripts = await confirm(
      "Do you have management scripts (start.sh, shutdown.sh, etc.)?",
      !!existing.scriptDir,
    );
    if (hasScripts) {
      server.scriptDir = await prompt(
        "Scripts directory",
        existing.scriptDir ?? "",
      );
    }
  }

  // Auto-expansion: any RawServerConfig field the curated flow above
  // did not cover is offered here straight from the schema.
  const covered = new Set([
    "id", "serverDir", "linuxUser", "screenSession", "useRcon", "rconHost",
    "rconPort", "rconPassword", "scriptDir", "apiUrl", "apiKey",
    "allowInsecureHttp", "commands",
  ]);
  const extras = Object.entries(serverSchema.properties ?? {}).filter(
    ([k]) => !covered.has(k),
  );
  if (extras.length > 0 && (await confirm("Configure advanced server fields?",
    extras.some(([k]) => existing[k] !== undefined)))) {
    for (const [key, propNode] of extras) {
      describe(deref(propNode)?.description);
      const v = await promptValue(key, propNode, existing[key], {
        serverIds: [], depth: 1,
      });
      if (v !== undefined) server[key] = v;
    }
  } else {
    for (const [key] of extras) {
      if (existing[key] !== undefined) server[key] = existing[key];
    }
  }

  // Per-server command overrides are preserved, not prompted.
  if (existing.commands) server.commands = existing.commands;

  return server;
}

/**
 * Configure features for a single guild, walking GuildConfig straight
 * from the schema (in schema order) so new guild features appear in the
 * wizard automatically. A few fields get curated treatment for better
 * defaults (defaultServer suggestion, chatBridge one-channel-per-server
 * flow); everything else goes through the generic walker.
 * @param {string} guildId
 * @param {Record<string, any>} existing
 * @param {any} guildSchema Resolved GuildConfig schema node
 * @param {WalkCtx} ctx
 * @returns {Promise<Record<string, any>>}
 */
async function configureGuild(guildId, existing, guildSchema, ctx) {
  console.log();
  hint(`Configuring guild: ${guildId}`);

  /** @type {Record<string, any>} */
  const guild = {};
  const serverIds = ctx.serverIds;

  for (const [key, propNode] of Object.entries(guildSchema.properties ?? {})) {
    const node = deref(propNode);
    const desc = node?.description ?? /** @type {any} */ (propNode)?.description;

    // ── Curated: defaultServer with sensible single-server shortcut ──
    if (key === "defaultServer") {
      if (serverIds.length > 1) {
        guild.defaultServer = await prompt(
          `Default server for this guild (${serverIds.join("/")})`,
          existing.defaultServer ?? serverIds[0] ?? "",
        );
      } else if (serverIds.length === 1) {
        guild.defaultServer = serverIds[0];
        info(`Default server: ${serverIds[0]}`);
      }
      continue;
    }

    // ── Curated: chat bridge (one Discord channel per server) ──
    if (key === "chatBridge") {
      const existingBridges = Array.isArray(existing.chatBridge)
        ? existing.chatBridge
        : existing.chatBridge
          ? [existing.chatBridge]
          : [];
      describe(desc);
      if (!(await confirm("Enable chat bridge?", existingBridges.length > 0))) {
        continue;
      }
      const bridgeSchema = deref(
        (node.anyOf ?? []).find((v) => deref(v).type === "object") ?? {},
      );
      /** @type {any[]} */
      const bridges = [];
      const targets = serverIds.length ? serverIds : [undefined];
      if (serverIds.length > 1) {
        hint("Each server gets its own channel — leave one empty to skip it.");
      }
      for (const sid of targets) {
        const prev = existingBridges.find((b) => b?.server === sid) ??
          (targets.length === 1 ? existingBridges[0] : undefined);
        const label = sid ? `Bridge channel ID for "${sid}"` : "Chat bridge channel ID";
        let channelId = await prompt(label, prev?.channelId ?? "");
        while (channelId && !isSnowflake(channelId) && !rlClosed) {
          warn("Expected a channel ID (17–20 digit snowflake).");
          channelId = await prompt(label, "");
        }
        if (channelId && !isSnowflake(channelId)) channelId = "";
        if (!channelId) continue;
        /** @type {Record<string, any>} */
        const bridge = { channelId };
        if (sid) bridge.server = sid;
        // Remaining bridge fields (useWebhook + future ones) from schema
        for (const [bk, bn] of Object.entries(bridgeSchema.properties ?? {})) {
          if (bk === "channelId" || bk === "server") continue;
          describe(deref(bn)?.description);
          const v = await promptValue(bk, bn, prev?.[bk], ctx);
          if (v !== undefined) bridge[bk] = v;
        }
        bridges.push(bridge);
      }
      if (bridges.length === 1) guild.chatBridge = bridges[0];
      else if (bridges.length > 1) guild.chatBridge = bridges;
      continue;
    }

    // ── Preserved, not prompted ──
    if (key === "commands") {
      if (existing.commands) guild.commands = existing.commands;
      continue;
    }

    // ── Generic: object-typed feature blocks (notifications,
    //    leaderboard, statusEmbed, reports, console, …) ──
    if (node.type === "object") {
      const has = existing[key] !== undefined;
      console.log();
      describe(desc);
      if (await confirm(`Enable ${key}?`, has)) {
        const v = await promptObject(key, node, existing[key], ctx);
        if (v !== undefined) guild[key] = v;
        else if (has) guild[key] = existing[key];
      }
      continue;
    }

    // ── Generic: scalars and arrays (language, adminUsers,
    //    allowedServers, linkedRole, …) ──
    describe(desc);
    const v = await promptValue(key, propNode, existing[key], ctx);
    if (v !== undefined) guild[key] = v;
  }

  // Preserve unknown guild keys
  for (const [key, value] of Object.entries(existing)) {
    if (!(key in guild) && !(key in (guildSchema.properties ?? {}))) {
      guild[key] = value;
    }
  }

  return guild;
}

main().catch((err) => {
  console.error(`${C.red}Error:${C.reset}`, err.message ?? err);
  rl.close();
  process.exit(1);
});
