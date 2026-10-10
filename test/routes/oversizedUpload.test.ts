import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

// These tests use a real socket: inject() buffers the whole payload, so it
// can't show when the server stops reading an upload.

const LIMIT = 64 * 1024;
const CHUNK_SIZE = 16 * 1024;
/** The client gives up after this much; a server reading everything gets it all. */
const MAX_SENT = 32 * 1024 * 1024;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface UploadResult {
  statusLine: string;
  bytesSentBeforeResponse: number;
  closedByServer: boolean;
}

/** Streams a chunked upload until the server responds and closes, or MAX_SENT is reached. */
async function streamOversizedUpload(
  headers: string,
  preamble: Buffer,
  epilogue: Buffer,
): Promise<UploadResult> {
  app = buildApp({ logger: false, maxFileSizeBytes: LIMIT });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;

  const toChunk = (data: Buffer): Buffer =>
    Buffer.concat([
      Buffer.from(`${data.length.toString(16)}\r\n`),
      data,
      Buffer.from('\r\n'),
    ]);
  const body = toChunk(Buffer.alloc(CHUNK_SIZE, 0));

  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let sent = 0;
    let statusLine = '';
    let bytesSentBeforeResponse = -1;

    const writeMore = (): void => {
      while (!socket.destroyed && bytesSentBeforeResponse < 0) {
        if (sent >= MAX_SENT) {
          if (epilogue.length > 0) socket.write(toChunk(epilogue));
          socket.end('0\r\n\r\n');
          return;
        }
        sent += CHUNK_SIZE;
        if (!socket.write(body)) {
          socket.once('drain', writeMore);
          return;
        }
      }
    };

    socket.on('data', (data) => {
      if (bytesSentBeforeResponse >= 0) return;
      statusLine = data.toString('latin1').split('\r\n')[0] ?? '';
      bytesSentBeforeResponse = sent;
    });
    socket.on('error', () => {
      // The server may reset the connection while we are still writing.
    });
    socket.on('close', () => {
      resolve({
        statusLine,
        bytesSentBeforeResponse,
        closedByServer: sent < MAX_SENT,
      });
    });
    socket.on('connect', () => {
      socket.write(
        `POST /file-upload HTTP/1.1\r\nHost: localhost\r\n${headers}` +
          'Transfer-Encoding: chunked\r\n\r\n',
      );
      if (preamble.length > 0) socket.write(toChunk(preamble));
      writeMore();
    });
    setTimeout(() => {
      socket.destroy();
      reject(new Error('Upload did not finish in time'));
    }, 15_000).unref();
  });
}

describe(
  'oversized uploads over a real connection',
  { timeout: 20_000 },
  () => {
    it.each([
      ['a raw body', 'Content-Type: audio/mpeg\r\n', '', ''],
      [
        'a multipart form',
        'Content-Type: multipart/form-data; boundary=XX\r\n',
        '--XX\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
        '\r\n--XX--\r\n',
      ],
    ])(
      'responds 413 and closes the connection without reading the rest of %s',
      async (_kind, headers, preamble, epilogue) => {
        const result = await streamOversizedUpload(
          headers,
          Buffer.from(preamble),
          Buffer.from(epilogue),
        );

        expect(result.statusLine).toBe('HTTP/1.1 413 Payload Too Large');
        expect(result.closedByServer).toBe(true);
        // Some data is in flight before the server stops reading, but far
        // less than the whole upload.
        expect(result.bytesSentBeforeResponse).toBeLessThan(MAX_SENT / 4);
      },
    );
  },
);
