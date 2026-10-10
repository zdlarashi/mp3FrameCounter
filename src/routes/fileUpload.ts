import type { FastifyPluginCallback } from 'fastify';
import {
  EmptyFileError,
  FileTooLargeError,
  InvalidMp3Error,
  MissingFileError,
} from '../errors.js';
import { countFrames } from '../mp3/countFrames.js';

export interface FileUploadRouteOptions {
  /** Must match the multipart plugin's fileSize limit; used in the error message. */
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
 * POST /file-upload: accepts an MP3 as multipart/form-data (first file part,
 * any field name) and responds with `{ "frameCount": number }`.
 *
 * The file is streamed straight into the frame counter as it is uploaded:
 * nothing is buffered to memory or disk, so large files are fine.
 */
export const fileUploadRoute: FastifyPluginCallback<FileUploadRouteOptions> = (
  app,
  { maxFileSizeBytes },
  done,
) => {
  app.post<{ Reply: FileUploadResponse }>(
    '/file-upload',
    { schema: { response: responseSchema } },
    async (request) => {
      if (!request.isMultipart()) throw new MissingFileError();

      const part = await request.file();
      if (part === undefined) throw new MissingFileError();

      const { frameCount, skippedBytes } = await countFrames(part.file);

      // The multipart plugin ends the stream early at the size limit.
      if (part.file.truncated) throw new FileTooLargeError(maxFileSizeBytes);
      if (part.file.bytesRead === 0) throw new EmptyFileError();
      if (frameCount === 0) throw new InvalidMp3Error();

      request.log.info(
        {
          filename: part.filename,
          bytes: part.file.bytesRead,
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
