// ── RCON protocol types ───────────────────────────────────────────────────────

export interface RconPacket {
  id: number;
  type: number;
  body: string;
  totalSize: number;
}

export interface PendingRconCommand {
  resolve: (body: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
