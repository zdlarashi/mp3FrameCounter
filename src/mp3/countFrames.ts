import { Mp3FrameCounter, type FrameCountResult } from './Mp3FrameCounter.js';

/**
 * Counts the MPEG-1 Layer III frames in a byte stream (e.g. a Node
 * `Readable` such as a file or upload stream).
 *
 * Chunks are processed as they arrive and not kept, so memory use doesn't
 * grow with the input size. Async iteration applies backpressure: the
 * source is read no faster than the counter consumes it.
 *
 * Rejects with the stream's error if the stream fails, or with a TypeError
 * if it yields text instead of bytes.
 */
export async function countFrames(
  source: AsyncIterable<unknown>,
): Promise<FrameCountResult> {
  const counter = new Mp3FrameCounter();

  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError(
        `Expected byte chunks (Buffer/Uint8Array) but got ${typeof chunk}; ` +
          'is an encoding set on the stream?',
      );
    }
    counter.push(chunk);
  }

  return counter.finish();
}
