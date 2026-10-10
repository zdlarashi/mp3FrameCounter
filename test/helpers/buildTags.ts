import { buildFrame, type FrameHeaderOptions } from './buildFrame.js';

/**
 * Builders for the non-audio metadata tags found in MP3 files.
 */

export interface Id3v2TagOptions {
  /** Tag body. Defaults to 32 zero bytes. */
  payload?: Buffer;
  /** Major version byte (ID3v2.x). Defaults to 4. */
  majorVersion?: number;
  /** Append a 10-byte footer and set the footer flag (ID3v2.4 only). */
  footer?: boolean;
}

/** Encodes a 28-bit integer as 4 syncsafe bytes (7 bits per byte, MSB first). */
export function encodeSyncsafe(value: number): Buffer {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

/**
 * Builds a full ID3v2 tag: 10-byte header ("ID3", version, revision, flags,
 * syncsafe size), the payload, and optionally a 10-byte footer ("3DI" ...).
 * The encoded size excludes the header and footer, as the spec requires.
 */
export function buildId3v2Tag(options: Id3v2TagOptions = {}): Buffer {
  const payload = options.payload ?? Buffer.alloc(32);
  const flags = options.footer ? 0x10 : 0x00;
  const versionAndFlags = Buffer.from([options.majorVersion ?? 4, 0, flags]);
  const size = encodeSyncsafe(payload.length);

  const header = Buffer.concat([Buffer.from('ID3'), versionAndFlags, size]);
  const footer = options.footer
    ? Buffer.concat([Buffer.from('3DI'), versionAndFlags, size])
    : Buffer.alloc(0);

  return Buffer.concat([header, payload, footer]);
}

export type VbrTagId = 'Xing' | 'Info' | 'VBRI';

/**
 * Builds an MPEG-1 Layer III frame carrying a VBR/info tag instead of audio,
 * as written by encoders in the first frame of a file.
 *
 * Xing/Info sit after the side info: 4-byte header + 2-byte CRC (if present)
 * + 17 bytes (mono) or 32 bytes (other modes). VBRI is always 32 bytes after
 * the header. Pass `offset` to put the tag somewhere else.
 */
export function buildVbrTagFrame(
  tag: VbrTagId,
  options: FrameHeaderOptions = {},
  offset?: number,
): Buffer {
  const frame = buildFrame(options);
  const isMono = options.channelModeBits === 0b11;
  const xingOffset = 4 + (options.crc ? 2 : 0) + (isMono ? 17 : 32);
  frame.write(tag, offset ?? (tag === 'VBRI' ? 36 : xingOffset), 'ascii');
  return frame;
}
