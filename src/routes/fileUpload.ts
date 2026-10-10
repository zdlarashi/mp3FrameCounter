import type { FastifyPluginCallback } from 'fastify';
import {
  EmptyFileError,
  FileTooLargeError,
  InvalidMp3Error,
} from '../errors.js';
import { countFrames } from '../mp3/countFrames.js';
import { RAW_UPLOAD_CONTENT_TYPES, getUploadSource } from './uploadSource.js';

export interface FileUploadRouteOptions {
  /** Must match the multipart plugin's fileSize limit; also applied to raw bodies. */
  readonly maxFileSizeBytes: number;
}

interface FileUploadResponse {
  frameCount: number;
}

const responseSchema = {
  200: {
    type: 'object',
    properties: { frameCount: { type: 'integer', minimum: 0 } },
    required: ['frameCount'],
    additionalProperties: false,
  },
} as const;

/**
 * POST /file-upload: accepts an MP3 either as multipart/form-data (first
 * file part, any field name) or as a raw body (Content-Type audio/mpeg,
 * audio/mp3 or application/octet-stream), and responds with
 * `{ "frameCount": number }`.
 *
 * The file is streamed straight into the frame counter as it is uploaded:
 * nothing is buffered to memory or disk, so large files are fine.
 */
export const fileUploadRoute: FastifyPluginCallback<FileUploadRouteOptions> = (
  app,
  { maxFileSizeBytes },
  done,
) => {
  // Hand raw audio bodies to the route as an unread stream (no buffering).
  app.addContentTypeParser(
    RAW_UPLOAD_CONTENT_TYPES,
    (_request, payload, parsed) => {
      parsed(null, payload);
    },
  );

  app.post<{ Reply: FileUploadResponse }>(
    '/file-upload',
    { schema: { response: responseSchema } },
    async (request) => {
      const upload = await getUploadSource(request, maxFileSizeBytes);
      const { frameCount, skippedBytes } = await countFrames(upload.chunks);

      if (upload.exceededLimit()) throw new FileTooLargeError(maxFileSizeBytes);
      if (upload.bytesRead() === 0) throw new EmptyFileError();
      if (frameCount === 0) throw new InvalidMp3Error();

      request.log.info(
        {
          filename: upload.filename,
          bytes: upload.bytesRead(),
          frameCount,
          skippedBytes,
        },
        'Counted MP3 frames',
      );

      return { frameCount };
    },
  );

  done();
};
