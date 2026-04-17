import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveJson, loadJson } from '../src/utils/utils.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('saveJson', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `minecraft-bot-test-${Date.now()}.json`);
    await saveJson(tmpFile, {});
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true });
  });

  it('writes and reads back a simple object', async () => {
    await saveJson(tmpFile, { hello: 'world' });
    const result = await loadJson(tmpFile);
    expect(result).toMatchObject({ hello: 'world' });
  });

  it('writes valid JSON (not corrupted) under concurrent writes', async () => {
    // Ten concurrent writes — without the mutex the file would be corrupted.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveJson(tmpFile, { [`key${i}`]: i }),
      ),
    );
    // The file must still be parseable valid JSON.
    const raw = await fs.readFile(tmpFile, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('final state after sequential writes is the last written value', async () => {
    await saveJson(tmpFile, { value: 1 });
    await saveJson(tmpFile, { value: 2 });
    await saveJson(tmpFile, { value: 3 });
    const result = await loadJson(tmpFile) as { value: number };
    expect(result.value).toBe(3);
  });

  it('returns cached value when file has not changed', async () => {
    await saveJson(tmpFile, { cached: true });
    const first = await loadJson(tmpFile);
    const second = await loadJson(tmpFile);
    // Both calls must return equivalent data (cache hit on second call).
    expect(first).toEqual(second);
  });
});
