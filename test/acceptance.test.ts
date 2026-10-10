import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { SAMPLE_MP3_FRAME_COUNT, SAMPLE_MP3_PATH } from './helpers/fixtures.js';

/**
 * End-to-end acceptance test: the definition of done for the assignment.
 * Written first (plan step 2) as `it.fails`; passing since step 8.
 */
describe('POST /file-upload (acceptance)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds with the frame count of a multipart upload as JSON', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([await readFile(SAMPLE_MP3_PATH)], { type: 'audio/mpeg' }),
      'sample.mp3',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      payload: form,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ frameCount: SAMPLE_MP3_FRAME_COUNT });
  });

  it('responds with the frame count of a raw audio/mpeg body as JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/file-upload',
      headers: { 'content-type': 'audio/mpeg' },
      payload: await readFile(SAMPLE_MP3_PATH),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ frameCount: SAMPLE_MP3_FRAME_COUNT });
  });
});
