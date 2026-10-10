import { open } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ID3V2_HEADER_SIZE,
  decodeSyncsafe,
  getId3v2TagSize,
} from '../../src/mp3/id3.js';
import { buildFrameHeader } from '../helpers/buildFrame.js';
import { SAMPLE_MP3_PATH } from '../helpers/fixtures.js';
import { buildId3v2Tag, encodeSyncsafe } from '../helpers/buildTags.js';

describe('decodeSyncsafe', () => {
  it.each([
    [[0x00, 0x00, 0x00, 0x00], 0],
    [[0x00, 0x00, 0x00, 0x7f], 127],
    [[0x00, 0x00, 0x01, 0x00], 128],
    [[0x00, 0x00, 0x02, 0x01], 257],
    [[0x7f, 0x7f, 0x7f, 0x7f], 2 ** 28 - 1],
  ])('decodes %j as %i', (bytes, expected) => {
    expect(decodeSyncsafe(Buffer.from(bytes))).toBe(expected);
  });

  it('reads at the given offset', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xaa, 0xbb]),
      encodeSyncsafe(300),
    ]);
    expect(decodeSyncsafe(bytes, 2)).toBe(300);
  });
});

describe('getId3v2TagSize', () => {
  it('returns header + payload size for a tag', () => {
    const tag = buildId3v2Tag({ payload: Buffer.alloc(257) });
    expect(getId3v2TagSize(tag)).toBe(ID3V2_HEADER_SIZE + 257);
    expect(getId3v2TagSize(tag)).toBe(tag.length);
  });

  it('includes the 10-byte footer when the footer flag is set', () => {
    const tag = buildId3v2Tag({ payload: Buffer.alloc(100), footer: true });
    expect(getId3v2TagSize(tag)).toBe(10 + 100 + 10);
    expect(getId3v2TagSize(tag)).toBe(tag.length);
  });

  it.each([2, 3, 4])('accepts ID3v2.%i tags', (majorVersion) => {
    expect(getId3v2TagSize(buildId3v2Tag({ majorVersion }))).toBe(42);
  });

  it('only needs the 10-byte header, not the whole tag', () => {
    const header = buildId3v2Tag({ payload: Buffer.alloc(5000) }).subarray(
      0,
      ID3V2_HEADER_SIZE,
    );
    expect(getId3v2TagSize(header)).toBe(5010);
  });

  it('reads the tag at the given offset', () => {
    const bytes = Buffer.concat([Buffer.alloc(7), buildId3v2Tag()]);
    expect(getId3v2TagSize(bytes, 7)).toBe(42);
  });

  it('reports the tag at the start of the sample file (34-byte payload)', async () => {
    const file = await open(SAMPLE_MP3_PATH);
    try {
      const { buffer } = await file.read({
        buffer: Buffer.alloc(ID3V2_HEADER_SIZE),
        position: 0,
      });
      expect(getId3v2TagSize(buffer)).toBe(44);
    } finally {
      await file.close();
    }
  });

  describe('returns null when the bytes are not an ID3v2 header', () => {
    const validTag = buildId3v2Tag();
    const withByte = (index: number, value: number) => {
      const copy = Buffer.from(validTag);
      copy[index] = value;
      return copy;
    };

    it.each([
      [
        'an MPEG frame header',
        Buffer.concat([buildFrameHeader(), Buffer.alloc(6)]),
      ],
      ['an ID3v1 tag', Buffer.concat([Buffer.from('TAG'), Buffer.alloc(7)])],
      ['lowercase identifier', withByte(0, 'i'.charCodeAt(0))],
      ['major version 0xFF', withByte(3, 0xff)],
      ['revision 0xFF', withByte(4, 0xff)],
      ['a size byte with the high bit set', withByte(6, 0x80)],
      ['a size byte with the high bit set (last byte)', withByte(9, 0x80)],
    ])('%s', (_description, bytes) => {
      expect(getId3v2TagSize(bytes)).toBeNull();
    });

    it('when fewer than 10 bytes are available', () => {
      expect(getId3v2TagSize(validTag.subarray(0, 9))).toBeNull();
      expect(getId3v2TagSize(validTag.subarray(0, 12), 3)).toBeNull();
    });
  });
});
