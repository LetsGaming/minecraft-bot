import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock server module ─────────────────────────────────────────────────────
vi.mock('../src/utils/server.js', () => ({
  getServerInstance: vi.fn(),
  getGuildServer: vi.fn(),
}));

import { getServerInstance, getGuildServer } from '../src/utils/server.js';
import { resolveServer, tryResolveServer } from '../src/utils/guildRouter.js';
import type { ChatInputCommandInteraction } from 'discord.js';

// Minimal interaction stub
function makeInteraction(opts: {
  serverId?: string | null;
  guildId?: string | null;
}): ChatInputCommandInteraction {
  return {
    guild: opts.guildId !== undefined ? { id: opts.guildId } : null,
    options: {
      getString: (_name: string) => opts.serverId ?? null,
    },
  } as unknown as ChatInputCommandInteraction;
}

const fakeServer = { id: 'main', useRcon: false } as never;
const otherServer = { id: 'survival', useRcon: true } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveServer', () => {
  it('uses explicit server option when provided', () => {
    vi.mocked(getServerInstance).mockReturnValue(fakeServer);
    const interaction = makeInteraction({ serverId: 'main', guildId: 'guild1' });
    const result = resolveServer(interaction);
    expect(getServerInstance).toHaveBeenCalledWith('main');
    expect(result).toBe(fakeServer);
  });

  it('falls back to guild default when no explicit server option', () => {
    vi.mocked(getGuildServer).mockReturnValue(fakeServer);
    const interaction = makeInteraction({ serverId: null, guildId: 'guild1' });
    const result = resolveServer(interaction);
    expect(getGuildServer).toHaveBeenCalledWith('guild1');
    expect(result).toBe(fakeServer);
  });

  it('throws when explicit server ID is not found', () => {
    vi.mocked(getServerInstance).mockReturnValue(null);
    const interaction = makeInteraction({ serverId: 'unknown', guildId: 'guild1' });
    expect(() => resolveServer(interaction)).toThrow('Server "unknown" not found.');
  });

  it('throws when guild has no configured server', () => {
    vi.mocked(getGuildServer).mockReturnValue(null);
    const interaction = makeInteraction({ serverId: null, guildId: 'guild1' });
    expect(() => resolveServer(interaction)).toThrow('No server configured for this guild.');
  });

  it('returns different server per explicit ID', () => {
    vi.mocked(getServerInstance).mockImplementation((id) =>
      id === 'survival' ? otherServer : null,
    );
    const interaction = makeInteraction({ serverId: 'survival', guildId: 'guild1' });
    expect(resolveServer(interaction)).toBe(otherServer);
  });
});

describe('tryResolveServer', () => {
  it('returns server when found', () => {
    vi.mocked(getGuildServer).mockReturnValue(fakeServer);
    const interaction = makeInteraction({ serverId: null, guildId: 'guild1' });
    expect(tryResolveServer(interaction)).toBe(fakeServer);
  });

  it('returns null instead of throwing when not found', () => {
    vi.mocked(getGuildServer).mockReturnValue(null);
    const interaction = makeInteraction({ serverId: null, guildId: 'guild1' });
    expect(tryResolveServer(interaction)).toBeNull();
  });
});
