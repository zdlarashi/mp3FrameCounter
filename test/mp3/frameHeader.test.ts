import { describe, expect, it } from 'vitest';
import {
  calculateFrameLength,
  parseFrameHeader,
} from '../../src/mp3/frameHeader.js';
import { buildFrameHeader } from '../helpers/buildFrame.js';

describe('parseFrameHeader', () => {
  it('parses a typical MPEG-1 Layer III header', () => {
    expect(parseFrameHeader(buildFrameHeader())).toEqual({
      bitrateKbps: 128,
      sampleRate: 44100,
      padding: false,
      hasCrc: false,
      channelMode: 'jointStereo',
      frameLength: 417,
    });
  });

  it.each([
    [1, 32],
    [2, 40],
    [3, 48],
    [4, 56],
    [5, 64],
    [6, 80],
    [7, 96],
    [8, 112],
    [9, 128],
    [10, 160],
    [11, 192],
    [12, 224],
    [13, 256],
    [14, 320],
  ])('maps bitrate index %i to %i kbps', (bitrateIndex, kbps) => {
    expect(parseFrameHeader(buildFrameHeader({ bitrateIndex }))).toMatchObject({
      bitrateKbps: kbps,
    });
  });

  it.each([
    [0, 44100],
    [1, 48000],
    [2, 32000],
  ])('maps sample rate index %i to %i Hz', (sampleRateIndex, hz) => {
    expect(
      parseFrameHeader(buildFrameHeader({ sampleRateIndex })),
    ).toMatchObject({ sampleRate: hz });
  });

  it.each([
    [0b00, 'stereo'],
    [0b01, 'jointStereo'],
    [0b10, 'dualChannel'],
    [0b11, 'mono'],
  ])('maps channel mode bits %i to %s', (channelModeBits, channelMode) => {
    expect(
      parseFrameHeader(buildFrameHeader({ channelModeBits })),
    ).toMatchObject({ channelMode });
  });

  it('reads the padding bit and adds it to the frame length', () => {
    expect(parseFrameHeader(buildFrameHeader({ padding: true }))).toMatchObject(
      { padding: true, frameLength: 418 },
    );
  });

  it('reports a CRC when the protection bit is 0', () => {
    expect(parseFrameHeader(buildFrameHeader({ crc: true }))).toMatchObject({
      hasCrc: true,
    });
  });

  it('reads the header at the given offset', () => {
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00]),
      buildFrameHeader({ bitrateIndex: 14 }),
    ]);
    expect(parseFrameHeader(bytes, 3)).toMatchObject({ bitrateKbps: 320 });
  });

  describe('returns null for headers that are not valid MPEG-1 Layer III', () => {
    it.each([
      ['no frame sync in first byte', Buffer.from([0xfe, 0xfb, 0x90, 0x40])],
      [
        'incomplete frame sync in second byte',
        Buffer.from([0xff, 0xdb, 0x90, 0x40]),
      ],
      ['MPEG-2', buildFrameHeader({ versionBits: 0b10 })],
      ['MPEG-2.5', buildFrameHeader({ versionBits: 0b00 })],
      ['reserved version', buildFrameHeader({ versionBits: 0b01 })],
      ['Layer I', buildFrameHeader({ layerBits: 0b11 })],
      ['Layer II', buildFrameHeader({ layerBits: 0b10 })],
      ['reserved layer', buildFrameHeader({ layerBits: 0b00 })],
      ['free-format bitrate', buildFrameHeader({ bitrateIndex: 0 })],
      ['bad bitrate index', buildFrameHeader({ bitrateIndex: 15 })],
      ['reserved sample rate', buildFrameHeader({ sampleRateIndex: 3 })],
    ])('%s', (_description, bytes) => {
      expect(parseFrameHeader(bytes)).toBeNull();
    });

    it('when fewer than 4 bytes are available', () => {
      expect(parseFrameHeader(buildFrameHeader().subarray(0, 3))).toBeNull();
      expect(parseFrameHeader(buildFrameHeader(), 1)).toBeNull();
    });
  });
});

describe('calculateFrameLength', () => {
  it.each([
    // [kbps, Hz, padding, bytes]
    [128, 44100, false, 417],
    [128, 44100, true, 418],
    [128, 48000, false, 384],
    [128, 32000, false, 576],
    [320, 48000, false, 960],
    [320, 44100, true, 1045],
    [32, 32000, false, 144],
    [32, 48000, false, 96],
  ])(
    '%i kbps @ %i Hz (padding: %s) is %i bytes',
    (bitrateKbps, sampleRate, padding, expected) => {
      expect(calculateFrameLength(bitrateKbps, sampleRate, padding)).toBe(
        expected,
      );
    },
  );
});
