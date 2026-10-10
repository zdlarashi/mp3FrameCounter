import { describe, expect, it } from 'vitest';
import {
  parseFrameHeader,
  type FrameHeader,
} from '../../src/mp3/frameHeader.js';
import { isVbrTagFrame } from '../../src/mp3/xing.js';
import { buildFrame, type FrameHeaderOptions } from '../helpers/buildFrame.js';
import { buildVbrTagFrame, type VbrTagId } from '../helpers/buildTags.js';

function check(frame: Buffer): boolean {
  const header: FrameHeader | null = parseFrameHeader(frame);
  if (header === null) throw new Error('test frame has an invalid header');
  return isVbrTagFrame(frame, header);
}

const STEREO: FrameHeaderOptions = { channelModeBits: 0b00 };
const JOINT_STEREO: FrameHeaderOptions = { channelModeBits: 0b01 };
const DUAL_CHANNEL: FrameHeaderOptions = { channelModeBits: 0b10 };
const MONO: FrameHeaderOptions = { channelModeBits: 0b11 };

describe('isVbrTagFrame', () => {
  describe.each<VbrTagId>(['Xing', 'Info'])('%s tag', (tag) => {
    it.each([
      ['stereo', STEREO, 36],
      ['joint stereo', JOINT_STEREO, 36],
      ['dual channel', DUAL_CHANNEL, 36],
      ['mono', MONO, 21],
    ])(
      'is found after the side info in a %s frame (byte %i)',
      (_mode, options) => {
        expect(check(buildVbrTagFrame(tag, options))).toBe(true);
      },
    );

    it('is found after the CRC when the frame has one', () => {
      expect(check(buildVbrTagFrame(tag, { crc: true }))).toBe(true);
      expect(check(buildVbrTagFrame(tag, { ...MONO, crc: true }))).toBe(true);
    });

    it('is found at the no-CRC offset even if the CRC flag is set', () => {
      // Tolerates encoders that set the protection bit but don't shift the tag.
      expect(check(buildVbrTagFrame(tag, { crc: true }, 36))).toBe(true);
    });

    it('is not found at the mono offset of a stereo frame', () => {
      expect(check(buildVbrTagFrame(tag, STEREO, 21))).toBe(false);
    });

    it('is not found at the stereo offset of a mono frame', () => {
      expect(check(buildVbrTagFrame(tag, MONO, 36))).toBe(false);
    });
  });

  describe('VBRI tag (Fraunhofer encoder)', () => {
    it.each([
      ['stereo', STEREO],
      ['mono', MONO],
    ])('is found 32 bytes after the header in a %s frame', (_mode, options) => {
      expect(check(buildVbrTagFrame('VBRI', options))).toBe(true);
    });

    it('is not found anywhere else', () => {
      expect(check(buildVbrTagFrame('VBRI', STEREO, 21))).toBe(false);
    });
  });

  it('returns false for an audio frame', () => {
    expect(check(buildFrame())).toBe(false);
    expect(check(buildFrame(MONO))).toBe(false);
  });

  it('is case sensitive', () => {
    const frame = buildFrame();
    frame.write('xing', 36, 'ascii');
    expect(check(frame)).toBe(false);
  });

  it('returns false without throwing when the frame is too short', () => {
    const frame = buildVbrTagFrame('Xing').subarray(0, 38);
    expect(check(frame)).toBe(false);
  });
});
