import { describe, it, expect } from 'vitest';
import { flattenStats, filterStats } from '../utils/statUtils.js';

describe('flattenStats', () => {
  it('handles the new nested format', () => {
    const file = { stats: { 'minecraft:custom': { 'minecraft:play_time': 1200 } } };
    const flat = flattenStats(file);
    expect(flat).toContainEqual(
      expect.objectContaining({ key: 'minecraft:play_time', value: 1200 }),
    );
  });

  it('handles the old flat format', () => {
    const file = { 'stat.playOneMinute': 600 };
    const flat = flattenStats(file);
    expect(flat.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty file', () => {
    expect(flattenStats({})).toEqual([]);
  });

  it('skips non-numeric values in nested format', () => {
    const file = { stats: { 'minecraft:custom': { 'minecraft:play_time': 'bad' as unknown as number } } };
    const flat = flattenStats(file);
    expect(flat).toHaveLength(0);
  });

  it('builds correct fullKey in nested format', () => {
    const file = { stats: { 'minecraft:mined': { 'minecraft:stone': 500 } } };
    const flat = flattenStats(file);
    expect(flat[0]).toMatchObject({
      fullKey: 'minecraft:mined.minecraft:stone',
      category: 'minecraft:mined',
      key: 'minecraft:stone',
      value: 500,
    });
  });
});

describe('filterStats', () => {
  const stats = [
    { fullKey: 'minecraft:mined.stone', category: 'minecraft:mined', key: 'stone', value: 5 },
    { fullKey: 'minecraft:custom.deaths', category: 'minecraft:custom', key: 'minecraft:deaths', value: 2 },
    { fullKey: 'minecraft:killed.zombie', category: 'minecraft:killed', key: 'zombie', value: 10 },
    { fullKey: 'minecraft:killed_by.creeper', category: 'minecraft:killed_by', key: 'creeper', value: 3 },
  ];

  it('returns all stats when filter is null', () => {
    expect(filterStats(stats, null)).toEqual(stats);
  });

  it('matches by category prefix', () => {
    const result = filterStats(stats, 'mined');
    expect(result.every((s) => s.category === 'minecraft:mined')).toBe(true);
  });

  it('disambiguates "killed" from "killed_by"', () => {
    const result = filterStats(stats, 'killed');
    expect(result.every((s) => s.category === 'minecraft:killed')).toBe(true);
  });

  it('disambiguates "killed_by"', () => {
    const result = filterStats(stats, 'killed_by');
    expect(result.every((s) => s.category === 'minecraft:killed_by')).toBe(true);
  });

  it('returns empty when no match meets threshold', () => {
    const result = filterStats(stats, 'xxxxxxxxxxx');
    expect(result).toHaveLength(0);
  });
});
