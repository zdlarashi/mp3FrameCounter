import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAMPLE_MP3_PATH } from './helpers/fixtures.js';

describe('test fixtures', () => {
  it('provides the sample MP3 file', () => {
    expect(statSync(SAMPLE_MP3_PATH).size).toBeGreaterThan(0);
  });
});
