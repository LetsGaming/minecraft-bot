/**
 * Pure RCON protocol client — TCP connection, auth handshake, command dispatch.
 * Has zero knowledge of Minecraft game logic or Discord. Designed to be
 * dependency-injected into ServerInstance so it can be mocked in tests.
 */
import net from 'net';
import { log } from '../utils/logger.js';
import type { RconPacket, PendingRconCommand } from '../types/index.js';

// ── Packet encoding / decoding ──────────────────────────────────────────────

const RCON_PACKET_TYPE = {
  AUTH: 3,
  CMD: 2,
} as const;

function encodePkt(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, 'utf-8');
  const len = 4 + 4 + b.length + 2;
  const buf = Buffer.alloc(4 + len);
  buf.writeInt32LE(len, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  buf[12 + b.length] = 0;
  buf[13 + b.length] = 0;
  return buf;
}

function decodePkt(buf: Buffer): RconPacket | null {
  if (buf.length < 14) return null;
  const length = buf.readInt32LE(0);
  if (buf.length < 4 + length) return null;
  return {
    id: buf.readInt32LE(4),
    type: buf.readInt32LE(8),
    body: buf.toString('utf-8', 12, 4 + length - 2),
    totalSize: 4 + length,
  };
}

// ── RconClient ───────────────────────────────────────────────────────────────

export class RconClient {
  private readonly host: string;
  private readonly port: number;
  private readonly password: string;
  private readonly serverId: string;

  private _client: net.Socket | null = null;
  private _auth = false;
  private _connecting = false;
  private _cmdId = 10;
  private _pending = new Map<number, PendingRconCommand>();
  private _buf = Buffer.alloc(0);
  private _authResolve: (() => void) | null = null;
  private _authReject: ((err: Error) => void) | null = null;
  private _lastSuccess = 0;

  constructor(host: string, port: number, password: string, serverId: string) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.serverId = serverId;
  }

  get lastSuccessTime(): number {
    return this._lastSuccess;
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private _cleanup(): void {
    this._auth = false;
    this._connecting = false;
    if (this._client) {
      this._client.removeAllListeners();
      this._client.destroy();
      this._client = null;
    }
    for (const [, cb] of this._pending) {
      clearTimeout(cb.timer);
      cb.reject(new Error('RCON lost'));
    }
    this._pending.clear();
    this._buf = Buffer.alloc(0);
    if (this._authReject) {
      this._authReject(new Error('RCON lost'));
      this._authResolve = null;
      this._authReject = null;
    }
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._auth && this._client && !this._client.destroyed) return resolve();

      if (this._connecting) {
        // Another caller already started the handshake — wait for it.
        const poll = setInterval(() => {
          if (this._auth) { clearInterval(poll); resolve(); }
          else if (!this._connecting) { clearInterval(poll); reject(new Error('RCON failed')); }
        }, 50);
        return;
      }

      this._cleanup();
      this._connecting = true;
      this._authResolve = resolve;
      this._authReject = reject;

      this._client = new net.Socket();
      this._client.setKeepAlive(true, 30000);

      const authTimeout = setTimeout(() => {
        this._cleanup();
        reject(new Error('RCON auth timeout'));
      }, 10000);

      this._client.connect(this.port, this.host, () => {
        this._client!.write(encodePkt(1, RCON_PACKET_TYPE.AUTH, this.password));
      });

      this._client.on('data', (data: Buffer) => {
        this._buf = Buffer.concat([this._buf, data]);
        while (true) {
          const pkt = decodePkt(this._buf);
          if (!pkt) break;
          this._buf = this._buf.subarray(pkt.totalSize);

          if (!this._auth) {
            clearTimeout(authTimeout);
            if (pkt.id === -1) {
              this._connecting = false;
              this._cleanup();
              reject(new Error('RCON auth failed'));
              return;
            }
            if (pkt.id === 1) {
              this._auth = true;
              this._connecting = false;
              this._authResolve?.();
              this._authResolve = null;
              this._authReject = null;
            }
            continue;
          }

          const cb = this._pending.get(pkt.id);
          if (cb) {
            clearTimeout(cb.timer);
            this._pending.delete(pkt.id);
            this._lastSuccess = Date.now();
            cb.resolve(pkt.body);
          }
        }
      });

      this._client.on('error', () => this._cleanup());
      this._client.on('close', () => this._cleanup());
    });
  }

  disconnect(): void {
    this._cleanup();
  }

  // ── Command dispatch ─────────────────────────────────────────────────────

  async send(command: string, timeoutMs = 5000): Promise<string> {
    await this.connect();
    const id = this._cmdId++;
    if (this._cmdId > 2e9) this._cmdId = 10;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('RCON timeout'));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._client!.write(encodePkt(id, RCON_PACKET_TYPE.CMD, command));
    });
  }

  /** Fire a command and swallow all errors — for best-effort screen fallbacks. */
  async trySend(command: string, timeoutMs = 5000): Promise<string | null> {
    try {
      return await this.send(command, timeoutMs);
    } catch (err) {
      log.warn(this.serverId, `RCON trySend failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
