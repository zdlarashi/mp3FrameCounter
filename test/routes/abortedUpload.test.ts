import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';

// A real socket, so the client can disconnect mid-upload (inject() can't).

interface LogLine {
  level: number;
  msg: string;
}

const ABORT_MESSAGE = 'Client aborted the request';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Starts an upload that declares more data than it sends, then disconnects. */
async function abortUpload(headers: string, body: string): Promise<LogLine[]> {
  const logs: LogLine[] = [];
  app = buildApp({
    logger: {
      level: 'info',
      stream: {
        write: (line: string) => logs.push(JSON.parse(line) as LogLine),
      },
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;

  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {
    // We are the ones closing the connection.
  });
  socket.write(
    `POST /file-upload HTTP/1.1\r\nHost: localhost\r\n${headers}` +
      'Content-Length: 100000\r\n\r\n' +
      body,
  );
  await vi.waitFor(() => {
    expect(logs.some((line) => line.msg === 'incoming request')).toBe(true);
  });
  socket.destroy();

  // Wait for the error handler to deal with the disconnect, either way.
  await vi.waitFor(() => {
    expect(
      logs.some((line) => line.level >= 50 || line.msg === ABORT_MESSAGE),
    ).toBe(true);
  });
  return logs;
}

describe('uploads aborted by the client', () => {
  it.each([
    ['a raw body', 'Content-Type: audio/mpeg\r\n', '\xff'.repeat(5000)],
    [
      'a multipart form',
      'Content-Type: multipart/form-data; boundary=XX\r\n',
      '--XX\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n' +
        'Content-Type: audio/mpeg\r\n\r\n' +
        '\xff'.repeat(5000),
    ],
  ])(
    'are logged as a client abort, not an unhandled error, for %s',
    async (_kind, headers, body) => {
      const logs = await abortUpload(headers, body);

      expect(logs.filter((line) => line.level >= 50)).toEqual([]);
      expect(logs.map((line) => line.msg)).toContain(ABORT_MESSAGE);
    },
  );
});
