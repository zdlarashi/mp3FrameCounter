import { describe, expect, it } from 'vitest';
import {
  Mp3FrameCounter,
  type FrameCountResult,
} from '../../src/mp3/Mp3FrameCounter.js';
import {
  buildFrame,
  buildFrameHeader,
  type FrameHeaderOptions,
} from '../helpers/buildFrame.js';
import { buildId3v2Tag, buildVbrTagFrame } from '../helpers/buildTags.js';
import { fixedChunks, randomChunks } from '../helpers/chunking.js';

function count(...chunks: Buffer[]): FrameCountResult {
  const counter = new Mp3FrameCounter();
  for (const chunk of chunks) counter.push(chunk);
  return counter.finish();
}

function frames(n: number, options: FrameHeaderOptions = {}): Buffer {
  return Buffer.concat(Array.from({ length: n }, () => buildFrame(options)));
}

/** Bytes that contain no 0xFF, so they can never contain a frame sync. */
function junk(length: number): Buffer {
  return Buffer.alloc(length, 0xaa);
}

const ID3V1_TAG = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125, 0x20)]);

describe('Mp3FrameCounter', () => {
  describe('counting frames', () => {
    it('counts 0 frames for empty input', () => {
      expect(count()).toEqual({ frameCount: 0, skippedBytes: 0 });
    });

    it('counts a single frame', () => {
      expect(count(buildFrame()).frameCount).toBe(1);
    });

    it('counts consecutive constant-bitrate frames', () => {
      expect(count(frames(50))).toEqual({ frameCount: 50, skippedBytes: 0 });
    });

    it('counts variable-bitrate frames with mixed padding', () => {
      const vbr = Buffer.concat([
        buildFrame({ bitrateIndex: 1 }),
        buildFrame({ bitrateIndex: 14, padding: true }),
        buildFrame({ bitrateIndex: 9 }),
        buildFrame({ bitrateIndex: 5, padding: true }),
        buildFrame({ bitrateIndex: 12 }),
      ]);
      expect(count(vbr).frameCount).toBe(5);
    });

    it.each([
      ['44.1 kHz', 0],
      ['48 kHz', 1],
      ['32 kHz', 2],
    ])('counts frames at %s', (_label, sampleRateIndex) => {
      expect(count(frames(10, { sampleRateIndex })).frameCount).toBe(10);
    });

    it('counts frames with a CRC', () => {
      expect(count(frames(10, { crc: true })).frameCount).toBe(10);
    });
  });

  describe('metadata tags', () => {
    it('skips a leading ID3v2 tag', () => {
      const data = Buffer.concat([buildId3v2Tag(), frames(10)]);
      expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 0 });
    });

    it('skips a leading ID3v2 tag with a footer', () => {
      const data = Buffer.concat([buildId3v2Tag({ footer: true }), frames(10)]);
      expect(count(data).frameCount).toBe(10);
    });

    it('does not count frame headers inside the ID3v2 tag', () => {
      // e.g. embedded album art can contain bytes that look like frames
      const tag = buildId3v2Tag({ payload: frames(3) });
      expect(count(Buffer.concat([tag, frames(10)])).frameCount).toBe(10);
    });

    it('skips a large ID3v2 tag spanning many chunks', () => {
      const tag = buildId3v2Tag({ payload: Buffer.alloc(200_000, 0xff) });
      const data = Buffer.concat([tag, frames(10)]);
      expect(count(...fixedChunks(data, 4096)).frameCount).toBe(10);
    });

    it('ignores a trailing ID3v1 tag', () => {
      const data = Buffer.concat([frames(10), ID3V1_TAG]);
      expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 128 });
    });
  });

  describe('VBR/info tag frame', () => {
    it.each(['Xing', 'Info', 'VBRI'] as const)(
      'does not count a leading %s frame',
      (tag) => {
        const data = Buffer.concat([buildVbrTagFrame(tag), frames(10)]);
        expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 0 });
      },
    );

    it('does not count a mono Xing frame', () => {
      const mono = { channelModeBits: 0b11 };
      const data = Buffer.concat([
        buildVbrTagFrame('Xing', mono),
        frames(10, mono),
      ]);
      expect(count(data).frameCount).toBe(10);
    });

    it('does not count the tag frame after an ID3v2 tag', () => {
      const data = Buffer.concat([
        buildId3v2Tag(),
        buildVbrTagFrame('Info'),
        frames(10),
      ]);
      expect(count(data).frameCount).toBe(10);
    });

    it('does not count the tag frame after leading junk', () => {
      const data = Buffer.concat([
        junk(20),
        buildVbrTagFrame('Xing'),
        frames(10),
      ]);
      expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 20 });
    });

    it('does not count the tag frame when fed in 1-byte chunks', () => {
      const data = Buffer.concat([buildVbrTagFrame('Xing'), frames(10)]);
      expect(count(...fixedChunks(data, 1)).frameCount).toBe(10);
    });

    it('counts 0 frames for a file containing only a tag frame', () => {
      expect(count(buildVbrTagFrame('Info')).frameCount).toBe(0);
    });

    it('counts a frame that looks like a tag frame if it is not the first', () => {
      // Only the first frame can be a tag frame; later ones are audio that
      // happens to contain the same bytes.
      const data = Buffer.concat([
        frames(5),
        buildVbrTagFrame('Xing'),
        frames(5),
      ]);
      expect(count(data).frameCount).toBe(11);
    });
  });

  describe('resynchronising', () => {
    it('skips junk before the first frame', () => {
      const data = Buffer.concat([junk(100), frames(10)]);
      expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 100 });
    });

    it('skips junk between frames and resyncs', () => {
      const data = Buffer.concat([frames(5), junk(37), frames(5)]);
      expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 37 });
    });

    it('does not count a lone header that is not followed by another frame', () => {
      // A valid-looking header inside junk, with junk where the next frame should be
      const falseSync = Buffer.concat([buildFrameHeader(), junk(600)]);
      const data = Buffer.concat([frames(3), junk(10), falseSync, frames(3)]);
      expect(count(data).frameCount).toBe(6);
    });

    it('does not count a header that is followed by a truncated frame header', () => {
      const data = Buffer.concat([
        junk(10),
        buildFrame(),
        buildFrameHeader().subarray(0, 2),
      ]);
      expect(count(data).frameCount).toBe(0);
    });

    it('counts 0 frames for data that is not an MP3', () => {
      const text = Buffer.from('This is not an MP3 file. '.repeat(100));
      expect(count(text)).toEqual({
        frameCount: 0,
        skippedBytes: text.length,
      });
    });
  });

  describe('truncated input', () => {
    // Matches ffprobe, which counts the final packet if its header is intact.
    it('counts a final frame that is cut short', () => {
      const data = Buffer.concat([frames(10), buildFrame().subarray(0, 100)]);
      expect(count(data).frameCount).toBe(11);
    });

    it('counts a final frame that is only a header', () => {
      const data = Buffer.concat([frames(10), buildFrameHeader()]);
      expect(count(data).frameCount).toBe(11);
    });

    it('does not count a partial final header', () => {
      const data = Buffer.concat([
        frames(10),
        buildFrameHeader().subarray(0, 3),
      ]);
      expect(count(data)).toEqual({ frameCount: 10, skippedBytes: 3 });
    });

    it('counts 0 frames for a truncated ID3v2 tag', () => {
      const tag = buildId3v2Tag({ payload: Buffer.alloc(1000) });
      expect(count(tag.subarray(0, 500)).frameCount).toBe(0);
    });
  });

  describe('chunk boundaries', () => {
    const file = Buffer.concat([
      buildId3v2Tag({ payload: frames(2) }),
      junk(13),
      frames(20, { bitrateIndex: 9 }),
      frames(20, { bitrateIndex: 14, padding: true }),
      junk(5),
      frames(20, { bitrateIndex: 1, sampleRateIndex: 2 }),
      ID3V1_TAG,
    ]);
    const expected: FrameCountResult = { frameCount: 60, skippedBytes: 146 };

    it('counts the whole file in one chunk', () => {
      expect(count(file)).toEqual(expected);
    });

    it.each([1, 2, 3, 4, 7, 10, 417, 1024])(
      'gives the same result with %i-byte chunks',
      (size) => {
        expect(count(...fixedChunks(file, size))).toEqual(expected);
      },
    );

    it.each([1, 2, 3, 4, 5])(
      'gives the same result with random chunk sizes (seed %i)',
      (seed) => {
        expect(count(...randomChunks(file, 2000, seed))).toEqual(expected);
      },
    );

    it('ignores empty chunks', () => {
      expect(count(Buffer.alloc(0), file, Buffer.alloc(0))).toEqual(expected);
    });
  });

  it('returns the same result if finish() is called again', () => {
    const counter = new Mp3FrameCounter();
    counter.push(Buffer.concat([frames(3), junk(5)]));
    const first = counter.finish();
    expect(counter.finish()).toEqual(first);
    expect(first).toEqual({ frameCount: 3, skippedBytes: 5 });
  });

  it('throws if data is pushed after finish()', () => {
    const counter = new Mp3FrameCounter();
    counter.finish();
    expect(() => {
      counter.push(buildFrame());
    }).toThrow(/finish/);
  });
});
