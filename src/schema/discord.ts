/**
 * Discord URLs, in one place.
 *
 * The backend (OAuth flow, REST client, CSP) and the frontend (guild avatars)
 * all talk to the same Discord hosts. Centralizing them here — in the
 * isomorphic contract package both import — means the discord.com origin, the
 * API version, and the CDN origin live in a single spot instead of being
 * hardcoded at each call site. Plain strings only (no Node built-ins), per the
 * package rule, so the browser bundle can import them too.
 */

/** Discord web origin — the OAuth2 authorize page lives here (not under /api). */
export const DISCORD_BASE_URL = "https://discord.com";

/** Discord HTTP API base. The OAuth token/user endpoints hang off this. */
export const DISCORD_API_BASE = `${DISCORD_BASE_URL}/api`;

/** Versioned REST base the bot API client uses (channels, roles, guilds). */
export const DISCORD_API_V10_BASE = `${DISCORD_API_BASE}/v10`;

/** Discord CDN origin — guild icons and avatars. */
export const DISCORD_CDN_URL = "https://cdn.discordapp.com";

/** OAuth2 authorize page — both dashboard login and bot-invite start here. */
export const DISCORD_OAUTH_AUTHORIZE_URL = `${DISCORD_BASE_URL}/oauth2/authorize`;

/** OAuth2 token exchange endpoint (login code → access token). */
export const DISCORD_OAUTH_TOKEN_URL = `${DISCORD_API_BASE}/oauth2/token`;

/** Current-user endpoint (the `identify` scope). */
export const DISCORD_USER_URL = `${DISCORD_API_BASE}/users/@me`;

/** Current-user guild list — which guilds the user may manage. */
export const DISCORD_USER_GUILDS_URL = `${DISCORD_API_BASE}/users/@me/guilds`;
