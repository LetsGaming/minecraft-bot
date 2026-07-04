// Shared implementation with /verify — see commands/shared/whitelistAdd.ts
import {
  buildWhitelistAddData,
  executeWhitelistAdd,
} from "./shared/whitelistAdd.js";

export const data = buildWhitelistAddData("whitelist");
export const execute = executeWhitelistAdd;
