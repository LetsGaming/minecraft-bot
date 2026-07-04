import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";
import type { LinkedAccountsMap, LinkCodesMap } from "../types/index.js";

export const LINKED_ACCOUNTS_PATH = path.resolve(
  getRootDir(),
  "data",
  "linkedAccounts.json",
);
export const LINK_CODES_PATH = path.resolve(
  getRootDir(),
  "data",
  "linkCodes.json",
);

export async function loadLinkedAccounts(): Promise<LinkedAccountsMap> {
  return (await loadJson(LINKED_ACCOUNTS_PATH)) as LinkedAccountsMap;
}

export async function saveLinkedAccounts(
  map: LinkedAccountsMap,
): Promise<void> {
  return saveJson(LINKED_ACCOUNTS_PATH, map);
}

export async function loadLinkCodes(): Promise<LinkCodesMap> {
  return (await loadJson(LINK_CODES_PATH)) as LinkCodesMap;
}

export async function saveLinkCodes(codes: LinkCodesMap): Promise<void> {
  return saveJson(LINK_CODES_PATH, codes);
}

export async function isLinked(userId: string): Promise<boolean> {
  const linked = await getLinkedAccount(userId);
  return linked !== null;
}

export async function getLinkedAccount(userId: string): Promise<string | null> {
  // Don't swallow read failures — a corrupt store must surface as
  // an error, not as "this user is not linked".
  const linked = await loadLinkedAccounts();
  return linked[userId] ?? null;
}
