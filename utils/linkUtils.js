import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";

export const LINKED_ACCOUNTS_PATH = path.resolve(
  getRootDir(),
  "data",
  "linkedAccounts.json"
);
export const LINK_CODES_PATH = path.resolve(
  getRootDir(),
  "data",
  "linkCodes.json"
);

export async function loadLinkedAccounts() {
  return loadJson(LINKED_ACCOUNTS_PATH);
}
export async function saveLinkedAccounts(map) {
  return saveJson(LINKED_ACCOUNTS_PATH, map);
}

export async function loadLinkCodes() {
  // ensure file exists, then
  return loadJson(LINK_CODES_PATH);
}
export async function saveLinkCodes(codes) {
  // ensure dir exists, then
  return saveJson(LINK_CODES_PATH, codes);
}

export async function isLinked(userId) {
  const linked = await getLinkedAccount(userId);
  return linked !== null;
}

export async function getLinkedAccount(userId) {
  const linked = await loadLinkedAccounts().catch(() => ({}));
  return linked[userId] || null;
}
