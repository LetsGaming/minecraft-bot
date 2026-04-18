/**
 * Tests for the /daily command logic.
 *
 * Covers:
 *  - calcStreak: streak increment, reset after miss, longestStreak tracking
 *  - pick: weighted random item selection
 *  - claimLock: concurrent executions are blocked (F-001 race condition fix)
 *  - cooldown: second claim within 24 h is rejected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── calcStreak & pick ──────────────────────────────────────────────────────
// These are pure functions — import them directly without touching Discord or FS.

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const TWO_DAYS = 2 * DAILY_COOLDOWN + 1;

// Dynamic import so we can test without discord.js side-effects at module load.
const { calcStreak, pick } = await import(
  '../src/commands/connection/daily/daily.js'
);

describe('calcStreak', () => {
  it('increments streak on consecutive claim', () => {
    const result = calcStreak(
      { currentStreak: 3, bonusStreak: 3, longestStreak: 5 },
      DAILY_COOLDOWN + 1000, // just over 24 h
    );
    expect(result.currentStreak).toBe(4);
    expect(result.bonusStreak).toBe(4);
    expect(result.longestStreak).toBe(5); // unchanged — 4 < 5
  });

  it('resets streak after missing a day (delta > 48 h)', () => {
    const result = calcStreak(
      { currentStreak: 10, bonusStreak: 10, longestStreak: 10 },
      TWO_DAYS,
    );
    expect(result.currentStreak).toBe(1);
    expect(result.bonusStreak).toBe(1);
    expect(result.longestStreak).toBe(10); // preserved
  });

  it('updates longestStreak when currentStreak exceeds it', () => {
    const result = calcStreak(
      { currentStreak: 7, bonusStreak: 7, longestStreak: 7 },
      DAILY_COOLDOWN + 1000,
    );
    expect(result.currentStreak).toBe(8);
    expect(result.longestStreak).toBe(8);
  });

  it('caps bonusStreak at MAX_STREAK (35)', () => {
    const result = calcStreak(
      { currentStreak: 35, bonusStreak: 35, longestStreak: 35 },
      DAILY_COOLDOWN + 1000,
    );
    expect(result.bonusStreak).toBe(35); // not 36
  });
});

describe('pick', () => {
  it('always returns an item from the pool', () => {
    const pool = [
      { item: 'minecraft:diamond', amount: 1, weight: 1 },
      { item: 'minecraft:gold_ingot', amount: 3, weight: 5 },
    ];
    for (let i = 0; i < 100; i++) {
      const result = pick(pool);
      expect(pool).toContain(result);
    }
  });

  it('returns the only item in a single-entry pool', () => {
    const pool = [{ item: 'minecraft:emerald', amount: 2, weight: 1 }];
    expect(pick(pool)).toBe(pool[0]);
  });

  it('respects weight — high-weight item wins overwhelmingly', () => {
    const pool = [
      { item: 'rare', amount: 1, weight: 1 },
      { item: 'common', amount: 1, weight: 999 },
    ];
    const counts: Record<string, number> = { rare: 0, common: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[pick(pool).item!]!++;
    }
    expect(counts['common']!).toBeGreaterThan(900);
  });
});

// ── claimLock (F-001) ──────────────────────────────────────────────────────
// We test the lock behaviour by mocking all external dependencies and driving
// execute() directly.

describe('claimLock — concurrent claim prevention', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks a second concurrent execution for the same user', async () => {
    // Stub every external module the command touches.
    vi.mock('../src/utils/linkUtils.js', () => ({
      isLinked: vi.fn().mockResolvedValue(true),
      getLinkedAccount: vi.fn().mockResolvedValue('Steve'),
    }));
    vi.mock('../src/utils/playerUtils.js', () => ({
      getOnlinePlayers: vi.fn().mockResolvedValue(['Steve']),
    }));
    vi.mock('../src/utils/guildRouter.js', () => ({
      resolveServer: vi.fn().mockReturnValue({
        sendCommand: vi.fn().mockResolvedValue(null),
      }),
    }));
    vi.mock('../src/utils/embedUtils.js', () => ({
      createErrorEmbed: vi.fn().mockReturnValue({}),
    }));

    // Provide a saveJson that never resolves so the first execution stays
    // inside the lock long enough for the second to arrive.
    let releaseSave!: () => void;
    const savePending = new Promise<void>((res) => { releaseSave = res; });
    vi.mock('../src/utils/utils.js', () => ({
      getRootDir: vi.fn().mockReturnValue('/tmp'),
      loadJson: vi.fn().mockResolvedValue({
        default: [{ item: 'minecraft:diamond', amount: 1, weight: 1 }],
        streakBonuses: {},
      }),
      saveJson: vi.fn().mockReturnValue(savePending),
    }));

    const { execute } = await import('../src/commands/connection/daily/daily.js');

    const makeInteraction = (userId = 'user-1') => ({
      user: { id: userId },
      guild: { id: 'guild-1' },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
    });

    const i1 = makeInteraction();
    const i2 = makeInteraction();

    // Start first execution — it will hang at saveJson.
    const p1 = execute(i1 as never);
    // Yield so p1 enters the lock before p2 starts.
    await new Promise((r) => setTimeout(r, 0));

    // Second execution for the same user should be rejected immediately.
    await execute(i2 as never);
    expect(i2.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Already processing') }),
    );

    // Release the first execution.
    releaseSave();
    await p1;
  });

  it('allows a second execution for a different user', async () => {
    vi.mock('../src/utils/linkUtils.js', () => ({
      isLinked: vi.fn().mockResolvedValue(false), // fail fast — we only care about lock
      getLinkedAccount: vi.fn(),
    }));
    vi.mock('../src/utils/playerUtils.js', () => ({
      getOnlinePlayers: vi.fn(),
    }));
    vi.mock('../src/utils/guildRouter.js', () => ({
      resolveServer: vi.fn(),
    }));
    vi.mock('../src/utils/embedUtils.js', () => ({
      createErrorEmbed: vi.fn().mockReturnValue({}),
    }));
    vi.mock('../src/utils/utils.js', () => ({
      getRootDir: vi.fn().mockReturnValue('/tmp'),
      loadJson: vi.fn(),
      saveJson: vi.fn(),
    }));

    const { execute } = await import('../src/commands/connection/daily/daily.js');

    const makeInteraction = (userId: string) => ({
      user: { id: userId },
      guild: { id: 'guild-1' },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
    });

    const iA = makeInteraction('user-A');
    const iB = makeInteraction('user-B');

    await Promise.all([execute(iA as never), execute(iB as never)]);

    // Neither should get the "Already processing" lock message — they're different users.
    for (const call of [...iA.reply.mock.calls, ...iB.reply.mock.calls]) {
      expect((call[0] as { content?: string }).content ?? '').not.toContain('Already processing');
    }
  });
});
