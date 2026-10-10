import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { countFrames } from '../../src/mp3/countFrames.js';
import { buildFrame } from '../helpers/buildFrame.js';
import {
  SAMPLE_MP3_FRAME_COUNT,
  SAMPLE_MP3_PATH,
} from '../helpers/fixtures.js';

describe('countFrames', () => {
  it('counts the frames in the sample file', async () => {
    const result = await countFrames(createReadStream(SAMPLE_MP3_PATH));
    expect(result).toEqual({
      frameCount: SAMPLE_MP3_FRAME_COUNT,
      skippedBytes: 0,
    });
  });

  it.each([100, 1024, 4096])(
    'counts the sample file read in %i-byte chunks',
    async (highWaterMark) => {
      const stream = createReadStream(SAMPLE_MP3_PATH, { highWaterMark });
      expect((await countFrames(stream)).frameCount).toBe(
        SAMPLE_MP3_FRAME_COUNT,
      );
    },
  );

  it('counts the sample file fed in 1-byte chunks', async () => {
    // From memory: 1.4M one-byte fs reads would take ~20 s on their own.
    const data = await readFile(SAMPLE_MP3_PATH);
    function* oneByteChunks() {
      for (let i = 0; i < data.length; i++) yield data.subarray(i, i + 1);
    }
    expect((await countFrames(Readable.from(oneByteChunks()))).frameCount).toBe(
      SAMPLE_MP3_FRAME_COUNT,
    );
  });

  it('accepts Uint8Array chunks as well as Buffers', async () => {
    const stream = Readable.from([
      buildFrame(),
      new Uint8Array(buildFrame()),
      buildFrame(),
    ]);
    expect((await countFrames(stream)).frameCount).toBe(3);
  });

  it('counts 0 frames for an empty stream', async () => {
    expect(await countFrames(Readable.from([]))).toEqual({
      frameCount: 0,
      skippedBytes: 0,
    });
  });

  it('rejects with the stream error if the stream fails', async () => {
    const stream = new Readable({
      read() {
        this.push(buildFrame());
        this.destroy(new Error('connection reset'));
      },
    });
    await expect(countFrames(stream)).rejects.toThrow('connection reset');
  });

  it('rejects text chunks (e.g. a stream with an encoding set)', async () => {
    const stream = createReadStream(SAMPLE_MP3_PATH, { encoding: 'latin1' });
    await expect(countFrames(stream)).rejects.toThrow(TypeError);
  });
});
