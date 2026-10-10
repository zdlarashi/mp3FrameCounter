import {
  BITRATES_KBPS,
  CHANNEL_MODES,
  FRAME_HEADER_SIZE,
  LAYER3_BITS,
  MPEG1_VERSION_BITS,
  RESERVED_EMPHASIS_BITS,
  SAMPLES_PER_FRAME,
  SAMPLE_RATES_HZ,
  type ChannelMode,
} from './constants.js';

/** The fields of an MPEG-1 Layer III frame header that the counter needs. */
export interface FrameHeader {
  readonly bitrateKbps: number;
  readonly sampleRate: number;
  readonly padding: boolean;
  /** A 16-bit CRC follows the header (protection bit is 0). */
  readonly hasCrc: boolean;
  readonly channelMode: ChannelMode;
  /** Total frame size in bytes, header included. */
  readonly frameLength: number;
}

/**
 * Parses the 4-byte frame header at `offset`.
 *
 * Header layout (32 bits): AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM
 *   A sync (all 1s), B version, C layer, D protection, E bitrate index,
 *   F sample-rate index, G padding, H private, I channel mode, J mode extension,
 *   K copyright, L original, M emphasis.
 *
 * Returns null instead of throwing if the bytes are not a valid MPEG-1
 * Layer III header. Callers scan for frames, so invalid input is expected
 * and handled on the hot path.
 */
export function parseFrameHeader(
  bytes: Uint8Array,
  offset = 0,
): FrameHeader | null {
  if (offset + FRAME_HEADER_SIZE > bytes.length) return null;

  // Bounds checked above; `?? 0` only satisfies noUncheckedIndexedAccess.
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;

  const hasFrameSync = b0 === 0xff && (b1 & 0xe0) === 0xe0;
  if (!hasFrameSync) return null;

  const versionBits = (b1 >> 3) & 0b11;
  const layerBits = (b1 >> 1) & 0b11;
  if (versionBits !== MPEG1_VERSION_BITS || layerBits !== LAYER3_BITS) {
    return null;
  }

  const bitrateKbps = BITRATES_KBPS[(b2 >> 4) & 0b1111] ?? null;
  const sampleRate = SAMPLE_RATES_HZ[(b2 >> 2) & 0b11] ?? null;
  if (bitrateKbps === null || sampleRate === null) return null;
  // No encoder writes the reserved value, so it means these bytes aren't a header.
  if ((b3 & 0b11) === RESERVED_EMPHASIS_BITS) return null;

  const padding = (b2 & 0b10) !== 0;
  const channelMode = CHANNEL_MODES[(b3 >> 6) & 0b11] ?? 'stereo';

  return {
    bitrateKbps,
    sampleRate,
    padding,
    hasCrc: (b1 & 0b1) === 0,
    channelMode,
    frameLength: calculateFrameLength(bitrateKbps, sampleRate, padding),
  };
}

/**
 * Byte length of an MPEG-1 Layer III frame:
 * floor(samplesPerFrame / 8 * bitrate / sampleRate) + padding,
 * i.e. floor(144 * bitrate / sampleRate) + padding.
 */
export function calculateFrameLength(
  bitrateKbps: number,
  sampleRate: number,
  padding: boolean,
): number {
  const bytesPerFrame =
    ((SAMPLES_PER_FRAME / 8) * bitrateKbps * 1000) / sampleRate;
  return Math.floor(bytesPerFrame) + (padding ? 1 : 0);
}
