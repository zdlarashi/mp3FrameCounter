import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_MP3_PATH = fileURLToPath(
  new URL('../fixtures/sample.mp3', import.meta.url),
);

/** Frame count for the sample, verified with ffprobe and its Xing header. */
export const SAMPLE_MP3_FRAME_COUNT = 6089;

/** Valid MPEG-1 Layer III files made by scripts/generate-fixtures.sh. */
export const GENERATED_FIXTURES_DIR = fileURLToPath(
  new URL('../fixtures/generated/', import.meta.url),
);

/** Files the API must reject, made by scripts/generate-fixtures.sh. */
export const ERROR_FIXTURES_DIR = fileURLToPath(
  new URL('../fixtures/errors/', import.meta.url),
);

export interface GeneratedFixture {
  file: string;
  description: string;
  /** Frame count reported by ffprobe. */
  frameCount: number;
}

export async function loadGeneratedFixtures(): Promise<GeneratedFixture[]> {
  const json = await readFile(
    join(GENERATED_FIXTURES_DIR, 'manifest.json'),
    'utf8',
  );
  return JSON.parse(json) as GeneratedFixture[];
}
