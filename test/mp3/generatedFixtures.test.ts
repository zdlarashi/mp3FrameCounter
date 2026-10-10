import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Mp3FrameCounter } from '../../src/mp3/Mp3FrameCounter.js';

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

async function countFile(url: URL): Promise<number> {
  const counter = new Mp3FrameCounter();
  for await (const chunk of createReadStream(url, { highWaterMark: 4096 })) {
    counter.push(chunk as Buffer);
  }
  return counter.finish().frameCount;
}

describe('encoder-generated fixtures match ffprobe', () => {
  it('has fixtures to test', () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  it.each(manifest)('$file: $description', async (fixture) => {
    expect(await countFile(new URL(fixture.file, FIXTURES_DIR))).toBe(
      fixture.frameCount,
    );
  });
});
