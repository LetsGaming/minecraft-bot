// H-03: intentional alias of /whitelist — shared implementation in
// commands/shared/whitelistAdd.ts
import {
  buildWhitelistAddData,
  executeWhitelistAdd,
} from "./shared/whitelistAdd.js";

export const data = buildWhitelistAddData("verify");
export const execute = executeWhitelistAdd;
