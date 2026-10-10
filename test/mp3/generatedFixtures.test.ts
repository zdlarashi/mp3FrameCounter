import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { countFrames } from '../../src/mp3/countFrames.js';

/**
 * Real encoder output from scripts/generate-fixtures.sh, with frame counts
 * reported by ffprobe. Checks the counter against an independent
 * implementation rather than our own synthetic frames.
 */
interface FixtureEntry {
  file: string;
  description: string;
  frameCount: number;
}

const FIXTURES_DIR = new URL('../fixtures/generated/', import.meta.url);

const manifest = JSON.parse(
  await readFile(new URL('manifest.json', FIXTURES_DIR), 'utf8'),
) as FixtureEntry[];

describe('encoder-generated fixtures match ffprobe', () => {
  it('has fixtures to test', () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  it.each(manifest)('$file: $description', async (fixture) => {
    const stream = createReadStream(new URL(fixture.file, FIXTURES_DIR));
    expect((await countFrames(stream)).frameCount).toBe(fixture.frameCount);
  });
});
