/**
 * The head URL builder lives in core, where the dashboard shares it. Embed
 * author icons, chat-bridge webhook avatars and leaderboard thumbnails all
 * call `playerAvatarUrl`, so a player has one URL in every place.
 */
export { playerHeadUrl as playerAvatarUrl } from "@mcbot/core/utils/minecraft/playerHead.js";
