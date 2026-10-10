import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../../src/app.js';
import { buildFrame } from '../helpers/buildFrame.js';
import {
  ERROR_FIXTURES_DIR,
  GENERATED_FIXTURES_DIR,
  SAMPLE_MP3_FRAME_COUNT,
  SAMPLE_MP3_PATH,
  loadGeneratedFixtures,
} from '../helpers/fixtures.js';

const generated = await loadGeneratedFixtures();

let app: FastifyInstance | undefined;

async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  app = buildApp({ logger: false, ...options });
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function mp3Form(
  data: Uint8Array,
  fieldName = 'file',
  filename = 'test.mp3',
): FormData {
  const form = new FormData();
  form.append(fieldName, new Blob([data], { type: 'audio/mpeg' }), filename);
  return form;
}

async function fileForm(path: string): Promise<FormData> {
  return mp3Form(await readFile(path), 'file', basename(path));
}

async function upload(
  payload: FormData,
  options: AppOptions = {},
): Promise<LightMyRequestResponse> {
  const server = await createApp(options);
  return server.inject({ method: 'POST', url: '/file-upload', payload });
}

function expectJsonError(
  response: LightMyRequestResponse,
  statusCode: number,
  code: string,
): void {
  expect(response.statusCode).toBe(statusCode);
  expect(response.headers['content-type']).toMatch(/^application\/json/);
  const body = response.json<{ error: { code: string; message: string } }>();
  expect(body).toEqual({
    error: { code, message: expect.any(String) as string },
  });
  expect(body.error.message.length).toBeGreaterThan(0);
}

describe('POST /file-upload', () => {
  describe('success', () => {
    it('responds 200 with the frame count of the sample as JSON', async () => {
      const response = await upload(mp3Form(await readFile(SAMPLE_MP3_PATH)));

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.json()).toEqual({ frameCount: SAMPLE_MP3_FRAME_COUNT });
    });

    it('returns only frameCount in the body', async () => {
      // e.g. junk bytes: skippedBytes is logged, not returned
      const data = Buffer.concat([Buffer.alloc(10, 0xaa), buildFrame()]);
      const response = await upload(mp3Form(data));
      expect(response.json()).toEqual({ frameCount: 1 });
    });

    it('accepts the file under any form field name', async () => {
      const response = await upload(mp3Form(buildFrame(), 'audio'));
      expect(response.json()).toEqual({ frameCount: 1 });
    });

    it('ignores non-file form fields before the file', async () => {
      const form = new FormData();
      form.append('description', 'my song');
      form.append('file', new Blob([buildFrame()]), 'test.mp3');
      const response = await upload(form);
      expect(response.json()).toEqual({ frameCount: 1 });
    });
  });

  describe('client errors', () => {
    it('responds 400 MISSING_FILE when the form has no file', async () => {
      const form = new FormData();
      form.append('description', 'no file here');
      expectJsonError(await upload(form), 400, 'MISSING_FILE');
    });

    it('responds 400 MISSING_FILE for a JSON body', async () => {
      const server = await createApp();
      const response = await server.inject({
        method: 'POST',
        url: '/file-upload',
        payload: { file: 'not a file' },
      });
      expectJsonError(response, 400, 'MISSING_FILE');
    });

    it('responds 400 MISSING_FILE with no body', async () => {
      const server = await createApp();
      const response = await server.inject({
        method: 'POST',
        url: '/file-upload',
      });
      expectJsonError(response, 400, 'MISSING_FILE');
    });

    it('responds 415 for an unsupported content type', async () => {
      const server = await createApp();
      const response = await server.inject({
        method: 'POST',
        url: '/file-upload',
        headers: { 'content-type': 'image/png' },
        payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      });
      expectJsonError(response, 415, 'FST_ERR_CTP_INVALID_MEDIA_TYPE');
    });

    it('responds 400 EMPTY_FILE for an empty file', async () => {
      expectJsonError(
        await upload(mp3Form(new Uint8Array(0))),
        400,
        'EMPTY_FILE',
      );
    });

    it('responds 413 FILE_TOO_LARGE when the file exceeds the limit', async () => {
      const data = Buffer.concat([buildFrame(), buildFrame(), buildFrame()]);
      const response = await upload(mp3Form(data), {
        maxFileSizeBytes: 1000,
      });
      expectJsonError(response, 413, 'FILE_TOO_LARGE');
      expect(
        response.json<{ error: { message: string } }>().error.message,
      ).toMatch(/1000 bytes/);
    });

    it('accepts a file exactly at the size limit', async () => {
      const data = buildFrame();
      const response = await upload(mp3Form(data), {
        maxFileSizeBytes: data.length,
      });
      expect(response.json()).toEqual({ frameCount: 1 });
    });

    it('responds 422 INVALID_MP3 when no MPEG-1 Layer III frames are found', async () => {
      const text = Buffer.from('This is a text file, not an MP3.\n'.repeat(50));
      expectJsonError(await upload(mp3Form(text)), 422, 'INVALID_MP3');
    });
  });
});

describe('POST /file-upload with a raw body', () => {
  async function uploadRaw(
    payload: Buffer | NodeJS.ReadableStream,
    contentType = 'audio/mpeg',
    options: AppOptions = {},
  ): Promise<LightMyRequestResponse> {
    const server = await createApp(options);
    return server.inject({
      method: 'POST',
      url: '/file-upload',
      headers: { 'content-type': contentType },
      payload,
    });
  }

  it('responds 200 with the frame count of the sample as JSON', async () => {
    const response = await uploadRaw(await readFile(SAMPLE_MP3_PATH));

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ frameCount: SAMPLE_MP3_FRAME_COUNT });
  });

  it.each(['audio/mpeg', 'audio/mp3', 'application/octet-stream'])(
    'accepts Content-Type: %s',
    async (contentType) => {
      const response = await uploadRaw(buildFrame(), contentType);
      expect(response.json()).toEqual({ frameCount: 1 });
    },
  );

  it('accepts a streamed body without a Content-Length', async () => {
    const response = await uploadRaw(createReadStream(SAMPLE_MP3_PATH));
    expect(response.json()).toEqual({ frameCount: SAMPLE_MP3_FRAME_COUNT });
  });

  it('responds 400 EMPTY_FILE for an empty body', async () => {
    expectJsonError(await uploadRaw(Buffer.alloc(0)), 400, 'EMPTY_FILE');
  });

  it('responds 422 INVALID_MP3 for a body that is not an MP3', async () => {
    const text = Buffer.from('This is a text file, not an MP3.\n'.repeat(50));
    expectJsonError(await uploadRaw(text), 422, 'INVALID_MP3');
  });

  it('responds 413 FILE_TOO_LARGE when Content-Length exceeds the limit', async () => {
    const data = Buffer.concat([buildFrame(), buildFrame(), buildFrame()]);
    const response = await uploadRaw(data, 'audio/mpeg', {
      maxFileSizeBytes: 1000,
    });
    expectJsonError(response, 413, 'FILE_TOO_LARGE');
  });

  it('responds 413 FILE_TOO_LARGE when a streamed body exceeds the limit', async () => {
    // No Content-Length, so the limit has to be enforced while reading
    const response = await uploadRaw(
      createReadStream(SAMPLE_MP3_PATH),
      'audio/mpeg',
      { maxFileSizeBytes: 1024 * 1024 },
    );
    expectJsonError(response, 413, 'FILE_TOO_LARGE');
  });

  it('accepts a body exactly at the size limit', async () => {
    const data = buildFrame();
    const response = await uploadRaw(data, 'audio/mpeg', {
      maxFileSizeBytes: data.length,
    });
    expect(response.json()).toEqual({ frameCount: 1 });
  });
});

describe('POST /file-upload with fixture files', () => {
  it.each(generated)(
    'responds 200 with the ffprobe frame count for $file',
    async ({ file, frameCount }) => {
      const response = await upload(
        await fileForm(join(GENERATED_FIXTURES_DIR, file)),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ frameCount });
    },
  );

  it.each([
    ['empty.mp3', 400, 'EMPTY_FILE'],
    ['not-an-mp3.mp3', 422, 'INVALID_MP3'],
    ['mpeg2-layer3-22k.mp3', 422, 'INVALID_MP3'],
    ['mpeg25-layer3-11k.mp3', 422, 'INVALID_MP3'],
    ['mpeg1-layer2.mp2', 422, 'INVALID_MP3'],
  ])('responds %s → %i %s', async (file, statusCode, code) => {
    const response = await upload(
      await fileForm(join(ERROR_FIXTURES_DIR, file)),
    );
    expectJsonError(response, statusCode, code);
  });

  it('responds 413 FILE_TOO_LARGE for the sample with a 1 MiB limit', async () => {
    const response = await upload(await fileForm(SAMPLE_MP3_PATH), {
      maxFileSizeBytes: 1024 * 1024,
    });
    expectJsonError(response, 413, 'FILE_TOO_LARGE');
  });
});

describe('other routes', () => {
  it('responds 404 NOT_FOUND as JSON for an unknown route', async () => {
    const server = await createApp();
    const response = await server.inject({ method: 'GET', url: '/nope' });
    expectJsonError(response, 404, 'NOT_FOUND');
  });

  it('responds 404 NOT_FOUND for GET /file-upload', async () => {
    const server = await createApp();
    const response = await server.inject({
      method: 'GET',
      url: '/file-upload',
    });
    expectJsonError(response, 404, 'NOT_FOUND');
  });

  it('responds 200 on GET /health', async () => {
    const server = await createApp();
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('unexpected errors', () => {
  it('responds 500 INTERNAL_ERROR without leaking details', async () => {
    const server = buildApp({ logger: false });
    app = server;
    server.get('/boom', () => {
      throw new Error('database password is hunter2');
    });
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/boom' });
    expectJsonError(response, 500, 'INTERNAL_ERROR');
    expect(response.body).not.toContain('hunter2');
  });
});
