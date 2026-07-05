// ── Mod types ─────────────────────────────────────────────────────────────────

export type ModSide = "server_only" | "client_optional" | "client_and_server";

export interface ModInfo {
  slug: string;
  name: string;
  description: string;
  url: string;
  side: ModSide;
}

export interface ModList {
  serverOnly: ModInfo[];
  clientOptional: ModInfo[];
  clientAndServer: ModInfo[];
  fetchedAt: number;
}
