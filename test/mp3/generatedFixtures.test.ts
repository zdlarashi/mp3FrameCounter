import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countFrames } from '../../src/mp3/countFrames.js';
import {
  GENERATED_FIXTURES_DIR,
  loadGeneratedFixtures,
} from '../helpers/fixtures.js';

/**
 * Real encoder output from scripts/generate-fixtures.sh, with frame counts
 * reported by ffprobe. Checks the counter against an independent
 * implementation rather than our own synthetic frames.
 */
const fixtures = await loadGeneratedFixtures();

describe('encoder-generated fixtures match ffprobe', () => {
  it('has fixtures to test', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$file: $description', async (fixture) => {
    const stream = createReadStream(join(GENERATED_FIXTURES_DIR, fixture.file));
    expect((await countFrames(stream)).frameCount).toBe(fixture.frameCount);
  });
});
