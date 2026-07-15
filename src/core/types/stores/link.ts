// ── Link system types ─────────────────────────────────────────────────────────

export interface LinkCode {
  discordId: string;
  expires: number;
  confirmed: boolean;
}

export type LinkedAccountsMap = Record<string, string>;
export type LinkCodesMap = Record<string, LinkCode>;
