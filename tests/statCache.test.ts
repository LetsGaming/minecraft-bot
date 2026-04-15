import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invalidateAllStatsCache } from '../src/utils/statUtils.js';

// ── Mock the filesystem calls loadAllStats uses ───────────────────────────
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
    },
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readdir: vi.fn().mockResolvedValue(['abc123.json', 'def456.json']),
  };
});

// Mock loadJson so we don't touch disk
vi.mock('../src/utils/utils.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadJson: vi.fn().mockResolvedValue({ stats: {} }),
    getLevelName: vi.fn().mockResolvedValue('world'),
  };
});

vi.mock('../src/utils/server.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServerConfig: vi.fn().mockReturnValue({ serverDir: '/fake/server' }),
  };
});

import { loadAllStats } from '../src/utils/statUtils.js';
import { loadJson } from '../src/utils/utils.js';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAllStatsCache();
});

afterEach(() => {
  invalidateAllStatsCache();
});

describe('loadAllStats TTL cache', () => {
  it('calls readdir and loadJson on first call', async () => {
    await loadAllStats();
    // 2 stat files → 2 loadJson calls
    expect(vi.mocked(loadJson)).toHaveBeenCalledTimes(2);
  });

  it('returns cached result within TTL without re-reading files', async () => {
    await loadAllStats();
    const callsAfterFirst = vi.mocked(loadJson).mock.calls.length;

    await loadAllStats();
    // No additional calls — should be served from cache
    expect(vi.mocked(loadJson).mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-reads files after cache is invalidated', async () => {
    await loadAllStats();
    const callsAfterFirst = vi.mocked(loadJson).mock.calls.length;

    invalidateAllStatsCache();
    await loadAllStats();

    expect(vi.mocked(loadJson).mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
