import { FRAME_HEADER_SIZE } from './constants.js';
import { parseFrameHeader } from './frameHeader.js';
import { ID3V2_HEADER_SIZE, getId3v2TagSize } from './id3.js';

export interface FrameCountResult {
  /** Number of MPEG-1 Layer III frames found. */
  readonly frameCount: number;
  /** Bytes that were neither part of a frame nor of the leading ID3v2 tag (junk, trailing tags). */
  readonly skippedBytes: number;
}

/**
 * - `start`: at the beginning of the stream, checking for an ID3v2 tag.
 * - `searching`: looking for a frame header. A header found here only counts
 *   if another valid header follows it, so stray 0xFF bytes in junk or
 *   metadata are not mistaken for frames.
 * - `synced`: the next frame is expected right where the previous one ended.
 */
type State = 'start' | 'searching' | 'synced';

const FRAME_SYNC_BYTE = 0xff;
const EMPTY = new Uint8Array(0);

/**
 * Counts MPEG-1 Layer III frames in a stream of byte chunks.
 *
 * Designed for arbitrarily large inputs: the counter jumps from header to
 * header, skips frame bodies without copying them (even across chunks), and
 * keeps at most one partial frame (< 1.5 KB) between chunks. Memory use is
 * O(1) whatever the input size.
 *
 * Usage: call `push()` for each chunk, then `finish()` once at the end.
 */
export class Mp3FrameCounter {
  #state: State = 'start';
  #frameCount = 0;
  #skippedBytes = 0;
  /** Bytes still to be skipped from upcoming chunks (the rest of a frame or tag). */
  #bytesToSkip = 0;
  /** Unprocessed bytes from the previous chunk (a partial header or unconfirmed frame). */
  #pending: Uint8Array = EMPTY;
  #finished = false;

  push(chunk: Uint8Array): void {
    if (this.#finished) {
      throw new Error('Cannot push data after finish() has been called');
    }

    let data = chunk;
    if (this.#bytesToSkip > 0) {
      const skip = Math.min(this.#bytesToSkip, data.length);
      this.#bytesToSkip -= skip;
      data = data.subarray(skip);
    }
    if (data.length === 0) return;

    const buffer =
      this.#pending.length > 0 ? Buffer.concat([this.#pending, data]) : data;
    const consumed = this.#process(buffer, false);
    // Copy the (small) remainder so we don't keep the whole chunk alive.
    // (`new Uint8Array(view)` copies; `Buffer#slice` would not.)
    this.#pending = new Uint8Array(buffer.subarray(consumed));
  }

  finish(): FrameCountResult {
    if (!this.#finished) {
      this.#finished = true;
      this.#process(this.#pending, true);
      this.#pending = EMPTY;
    }
    return { frameCount: this.#frameCount, skippedBytes: this.#skippedBytes };
  }

  /**
   * Processes as much of `buffer` as possible and returns the number of
   * bytes consumed. Unless `isFinal`, it stops early when more data is needed
   * to make a decision, and the caller keeps the remainder for the next chunk.
   */
  #process(buffer: Uint8Array, isFinal: boolean): number {
    let pos = 0;

    for (;;) {
      const remaining = buffer.length - pos;

      switch (this.#state) {
        case 'start': {
          if (remaining < ID3V2_HEADER_SIZE && !isFinal) return pos;
          this.#state = 'searching';
          const tagSize = getId3v2TagSize(buffer, pos);
          if (tagSize !== null) pos = this.#skip(buffer, pos, tagSize);
          break;
        }

        case 'synced': {
          if (remaining < FRAME_HEADER_SIZE) {
            return isFinal ? this.#discardRest(buffer, pos) : pos;
          }
          const header = parseFrameHeader(buffer, pos);
          if (header === null) {
            // Lost sync (junk, trailing tag, corruption): scan for the next frame.
            this.#state = 'searching';
            break;
          }
          this.#frameCount++;
          pos = this.#skip(buffer, pos, header.frameLength);
          break;
        }

        case 'searching': {
          if (remaining < FRAME_HEADER_SIZE) {
            return isFinal ? this.#discardRest(buffer, pos) : pos;
          }
          const header = parseFrameHeader(buffer, pos);
          if (header === null) {
            pos = this.#skipToNextSyncCandidate(buffer, pos);
            break;
          }

          // Confirm the candidate: the next frame must start where this one ends.
          const nextPos = pos + header.frameLength;
          const hasRoomForNextHeader =
            nextPos + FRAME_HEADER_SIZE <= buffer.length;
          if (!hasRoomForNextHeader && !isFinal) return pos;

          const isConfirmed = hasRoomForNextHeader
            ? parseFrameHeader(buffer, nextPos) !== null
            : nextPos === buffer.length; // a lone frame ending exactly at end of stream

          if (!isConfirmed) {
            pos = this.#skipToNextSyncCandidate(buffer, pos);
            break;
          }
          this.#frameCount++;
          this.#state = 'synced';
          pos = nextPos;
          break;
        }
      }
    }
  }

  /**
   * Advances `length` bytes from `pos`. If that goes past the end of the
   * buffer, the overflow is skipped from the next chunk(s) instead.
   */
  #skip(buffer: Uint8Array, pos: number, length: number): number {
    const end = pos + length;
    if (end <= buffer.length) return end;
    this.#bytesToSkip = end - buffer.length;
    return buffer.length;
  }

  /** Jumps to the next 0xFF byte after `pos` (or the end of the buffer), counting the bytes passed over as skipped. */
  #skipToNextSyncCandidate(buffer: Uint8Array, pos: number): number {
    const next = buffer.indexOf(FRAME_SYNC_BYTE, pos + 1);
    const end = next === -1 ? buffer.length : next;
    this.#skippedBytes += end - pos;
    return end;
  }

  #discardRest(buffer: Uint8Array, pos: number): number {
    this.#skippedBytes += buffer.length - pos;
    return buffer.length;
  }
}
