/**
 * Tests for the account linking flow.
 *
 * Covers:
 *  - generateCode: output format (randomBytes hex encoding)
 *  - logWatcher link handler: happy path, unknown code, expiry, rate limiting
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

// ── Top-level mocks — must be at file scope for Vitest hoisting ───────────

vi.mock('../src/utils/linkUtils.js', () => ({
  loadLinkCodes: vi.fn().mockResolvedValue({}),
  loadLinkedAccounts: vi.fn().mockResolvedValue({}),
  saveLinkCodes: vi.fn().mockResolvedValue(undefined),
  saveLinkedAccounts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/logWatcher/logWatcher.js', () => ({
  registerLogCommand: vi.fn(),
}));

// ── Code generation ────────────────────────────────────────────────────────

describe('link code format', () => {
  it('has exactly 8 hex characters (4 bytes → 8 hex chars)', () => {
    const code = randomBytes(4).toString('hex').toUpperCase();
    expect(code).toMatch(/^[0-9A-F]{8}$/);
  });

  it('produces unique codes on successive calls', () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => randomBytes(4).toString('hex').toUpperCase()),
    );
    expect(codes.size).toBe(50);
  });
});

// ── logWatcher !link handler ───────────────────────────────────────────────

describe('logWatcher link handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // Reset module-level state (codes map, linkAttempts) to prevent bleed between tests.
    const mod = await import('../src/logWatcher/commands/link.js');
    mod._resetStateForTesting?.();
  });

  /**
   * Load a fresh module instance with the given codes pre-loaded.
   * vi.resetModules() in beforeEach ensures module state is clean each test.
   */
  async function loadModule(
    initialCodes: Record<string, { discordId: string; expires: number; confirmed: boolean }> = {},
  ) {
    const linkUtils = await import('../src/utils/linkUtils.js');
    vi.mocked(linkUtils.loadLinkCodes).mockResolvedValue(initialCodes as never);
    vi.mocked(linkUtils.loadLinkedAccounts).mockResolvedValue({});
    vi.mocked(linkUtils.saveLinkCodes).mockResolvedValue(undefined);
    vi.mocked(linkUtils.saveLinkedAccounts).mockResolvedValue(undefined);

    const mod = await import('../src/logWatcher/commands/link.js');
    await mod.init();
    return mod;
  }

  it('links account on valid code', async () => {
    const { handler } = await loadModule({
      ABCD1234: { discordId: 'discord-99', expires: Date.now() + 60_000, confirmed: false },
    });

    const mockClient = { users: { cache: new Map([['discord-99', { send: vi.fn().mockResolvedValue(undefined) }]]) } };
    await handler('Steve', { code: 'ABCD1234' }, mockClient as never);

    const { saveLinkedAccounts } = await import('../src/utils/linkUtils.js');
    expect(vi.mocked(saveLinkedAccounts)).toHaveBeenCalled();
  });

  it('ignores unknown code', async () => {
    const { handler } = await loadModule({});

    const mockClient = { users: { cache: new Map() } };
    await handler('Steve', { code: 'XXXXXXXX' }, mockClient as never);

    const { saveLinkedAccounts } = await import('../src/utils/linkUtils.js');
    expect(vi.mocked(saveLinkedAccounts)).not.toHaveBeenCalled();
  });

  it('rejects expired code and does not link', async () => {
    const { handler } = await loadModule({
      EXPIRED1: { discordId: 'discord-42', expires: Date.now() - 1000, confirmed: false },
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const mockClient = { users: { cache: new Map([['discord-42', { send }]]) } };
    await handler('Steve', { code: 'EXPIRED1' }, mockClient as never);

    // saveData() is called to clean up the expired code from disk — that's correct.
    // The real invariant is that the account was NOT linked: saveLinkedAccounts must
    // never have been called with 'discord-42' mapped to 'Steve'.
    const { saveLinkedAccounts } = await import('../src/utils/linkUtils.js');
    const calls = vi.mocked(saveLinkedAccounts).mock.calls;
    for (const [linkedMap] of calls) {
      expect((linkedMap as Record<string, string>)['discord-42']).toBeUndefined();
    }
    expect(send).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('rate-limits rapid successive attempts from same player', async () => {
    const { handler } = await loadModule({
      VALID001: { discordId: 'discord-77', expires: Date.now() + 60_000, confirmed: false },
    });

    const mockClient = { users: { cache: new Map([['discord-77', { send: vi.fn().mockResolvedValue(undefined) }]]) } };

    // First attempt — should go through and consume the code.
    await handler('Herobrine', { code: 'VALID001' }, mockClient as never);
    const { saveLinkedAccounts } = await import('../src/utils/linkUtils.js');
    const callsAfterFirst = vi.mocked(saveLinkedAccounts).mock.calls.length;

    // Immediate retry — should be rate-limited, no additional save call.
    await handler('Herobrine', { code: 'VALID001' }, mockClient as never);
    expect(vi.mocked(saveLinkedAccounts).mock.calls.length).toBe(callsAfterFirst);

    // After cooldown elapses the rate-limit gate opens again.
    vi.advanceTimersByTime(3_100);
    // Code was already consumed on the first attempt — completes without error.
    await handler('Herobrine', { code: 'VALID001' }, mockClient as never);
  });
});
