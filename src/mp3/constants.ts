/** Every MPEG audio frame starts with a 4-byte header. */
export const FRAME_HEADER_SIZE = 4;

/** MPEG-1 Layer III frames always encode 1152 samples. */
export const SAMPLES_PER_FRAME = 1152;

/** Version bits (header bits 19-20) for MPEG-1. */
export const MPEG1_VERSION_BITS = 0b11;

/** Layer bits (header bits 17-18) for Layer III. */
export const LAYER3_BITS = 0b01;

/**
 * MPEG-1 Layer III bitrates in kbps, indexed by the 4-bit bitrate index.
 * Index 0 is "free format" and 15 is invalid; both are unsupported (null).
 */
// prettier-ignore
export const BITRATES_KBPS = [
  null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null,
] as const;

/** MPEG-1 sample rates in Hz, indexed by the 2-bit sample-rate index. 3 is reserved. */
export const SAMPLE_RATES_HZ = [44100, 48000, 32000, null] as const;

/** Emphasis bits (header bits 0-1) value that is reserved, i.e. never valid. */
export const RESERVED_EMPHASIS_BITS = 0b10;

/** Channel modes, indexed by the 2-bit channel-mode field. */
export const CHANNEL_MODES = [
  'stereo',
  'jointStereo',
  'dualChannel',
  'mono',
] as const;

export type ChannelMode = (typeof CHANNEL_MODES)[number];
