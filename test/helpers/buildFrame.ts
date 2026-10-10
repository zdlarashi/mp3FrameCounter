/**
 * Builders for synthetic MPEG audio frames used in unit tests.
 *
 * Header layout (32 bits): AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM
 *   A sync, B version, C layer, D protection, E bitrate index,
 *   F sample-rate index, G padding, H private, I channel mode, J mode ext,
 *   K copyright, L original, M emphasis.
 *
 * Fields are set by their raw bit values so tests can also build invalid
 * headers. The bitrate/sample-rate tables are deliberately duplicated here
 * (rather than imported from src) so the tests act as an independent oracle.
 */

export interface FrameHeaderOptions {
  /** 2 bits: 0b11 = MPEG-1, 0b10 = MPEG-2, 0b00 = MPEG-2.5, 0b01 = reserved */
  versionBits?: number;
  /** 2 bits: 0b01 = Layer III, 0b10 = Layer II, 0b11 = Layer I, 0b00 = reserved */
  layerBits?: number;
  /** true = CRC present (protection bit 0) */
  crc?: boolean;
  /** 4 bits: 0 = free format, 15 = bad */
  bitrateIndex?: number;
  /** 2 bits: 3 = reserved */
  sampleRateIndex?: number;
  padding?: boolean;
  /** 2 bits: 0 stereo, 1 joint stereo, 2 dual channel, 3 mono */
  channelModeBits?: number;
  /** 2 bits: 0 none, 1 50/15 ms, 2 reserved, 3 CCITT J.17 */
  emphasisBits?: number;
}

const MPEG1_LAYER3_BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG1_SAMPLE_RATES_HZ = [44100, 48000, 32000, 0];

/** Defaults describe a typical file: MPEG-1 Layer III, 128 kbps, 44.1 kHz, joint stereo. */
const DEFAULTS: Required<FrameHeaderOptions> = {
  versionBits: 0b11,
  layerBits: 0b01,
  crc: false,
  bitrateIndex: 9,
  sampleRateIndex: 0,
  padding: false,
  channelModeBits: 0b01,
  emphasisBits: 0b00,
};

export function buildFrameHeader(options: FrameHeaderOptions = {}): Buffer {
  const o = { ...DEFAULTS, ...options };
  return Buffer.from([
    0xff,
    0xe0 | (o.versionBits << 3) | (o.layerBits << 1) | (o.crc ? 0 : 1),
    (o.bitrateIndex << 4) | (o.sampleRateIndex << 2) | (o.padding ? 0b10 : 0),
    (o.channelModeBits << 6) | o.emphasisBits,
  ]);
}

/** Expected byte length of an MPEG-1 Layer III frame with these options. */
export function expectedFrameLength(options: FrameHeaderOptions = {}): number {
  const o = { ...DEFAULTS, ...options };
  const bitrate = (MPEG1_LAYER3_BITRATES_KBPS[o.bitrateIndex] ?? 0) * 1000;
  const sampleRate = MPEG1_SAMPLE_RATES_HZ[o.sampleRateIndex] ?? 0;
  return Math.floor((144 * bitrate) / sampleRate) + (o.padding ? 1 : 0);
}

/**
 * Builds a complete MPEG-1 Layer III frame: a header followed by a
 * zero-filled payload so the total size equals the frame length.
 */
export function buildFrame(options: FrameHeaderOptions = {}): Buffer {
  const frame = Buffer.alloc(expectedFrameLength(options));
  buildFrameHeader(options).copy(frame);
  return frame;
}
