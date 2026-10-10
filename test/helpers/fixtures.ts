import { fileURLToPath } from 'node:url';

export const SAMPLE_MP3_PATH = fileURLToPath(
  new URL('../fixtures/sample.mp3', import.meta.url),
);

/** Frame count for the sample, verified with ffprobe and its Xing header. */
export const SAMPLE_MP3_FRAME_COUNT = 6089;
