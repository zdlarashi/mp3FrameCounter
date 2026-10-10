import { FRAME_HEADER_SIZE } from './constants.js';
import type { FrameHeader } from './frameHeader.js';

const CRC_SIZE = 2;

/** Layer III side information size for MPEG-1, which precedes a Xing/Info tag. */
const SIDE_INFO_SIZE = { mono: 17, other: 32 } as const;

/** The Fraunhofer VBRI tag is always 32 bytes after the frame header. */
const VBRI_OFFSET = FRAME_HEADER_SIZE + 32;

/**
 * Returns true if `frame` is a VBR/info tag frame rather than audio.
 *
 * Encoders often make the first frame of a file a valid-looking frame
 * carrying metadata (total frames, bytes, seek table) instead of audio:
 * - "Xing" (VBR) and "Info" (CBR), written by LAME/ffmpeg, after the side info
 * - "VBRI", written by the Fraunhofer encoder, at a fixed offset
 *
 * Decoders such as ffmpeg and mediainfo don't count this frame, so we don't
 * either.
 *
 * @param frame bytes starting at the frame header (at least the first ~40 bytes)
 */
export function isVbrTagFrame(frame: Uint8Array, header: FrameHeader): boolean {
  const sideInfoSize =
    header.channelMode === 'mono' ? SIDE_INFO_SIZE.mono : SIDE_INFO_SIZE.other;
  const xingOffset = FRAME_HEADER_SIZE + sideInfoSize;

  // Per the spec the tag follows the CRC, but also accept it at the no-CRC
  // offset in case an encoder set the protection bit without shifting it.
  const xingOffsets = header.hasCrc
    ? [xingOffset + CRC_SIZE, xingOffset]
    : [xingOffset];

  return (
    xingOffsets.some(
      (offset) =>
        hasAsciiAt(frame, offset, 'Xing') || hasAsciiAt(frame, offset, 'Info'),
    ) || hasAsciiAt(frame, VBRI_OFFSET, 'VBRI')
  );
}

function hasAsciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}
