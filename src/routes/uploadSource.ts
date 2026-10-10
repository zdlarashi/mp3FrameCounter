import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { FileTooLargeError, MissingFileError } from '../errors.js';

/** Content types accepted as a raw request body, where the body is the file. */
export const RAW_UPLOAD_CONTENT_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'application/octet-stream',
];

/**
 * The uploaded file as a stream, however it was sent (multipart form or
 * raw body), with the size information the route needs afterwards.
 */
export interface UploadSource {
  readonly chunks: AsyncIterable<unknown>;
  readonly filename: string | undefined;
  /** Bytes read so far; the full size once `chunks` has been consumed. */
  bytesRead(): number;
  /** True if reading stopped because the file exceeded the size limit. */
  exceededLimit(): boolean;
}

/**
 * Returns the uploaded file from either:
 * - a multipart/form-data request (the first file part, any field name), or
 * - a raw body with one of RAW_UPLOAD_CONTENT_TYPES.
 *
 * Throws MissingFileError if the request contains no file, and
 * FileTooLargeError if a raw body declares a size over the limit.
 */
export async function getUploadSource(
  request: FastifyRequest,
  maxFileSizeBytes: number,
): Promise<UploadSource> {
  if (request.isMultipart()) {
    const part = await request.file();
    if (part === undefined) throw new MissingFileError();
    // The multipart plugin enforces the size limit and ends the stream early.
    return {
      chunks: part.file,
      filename: part.filename,
      bytesRead: () => part.file.bytesRead,
      exceededLimit: () => part.file.truncated,
    };
  }

  if (request.body instanceof Readable) {
    // Reject early, without reading the body, when the client declares its size.
    const declaredSize = Number(request.headers['content-length']);
    if (declaredSize > maxFileSizeBytes) {
      throw new FileTooLargeError(maxFileSizeBytes);
    }
    return limitSize(request.body, maxFileSizeBytes);
  }

  throw new MissingFileError();
}

/**
 * Wraps a raw body stream so reading stops once it exceeds `maxBytes`
 * (needed when there is no Content-Length, e.g. chunked uploads).
 */
function limitSize(stream: Readable, maxBytes: number): UploadSource {
  let bytesRead = 0;
  let exceededLimit = false;

  async function* chunks(): AsyncGenerator {
    // Don't destroy the request stream when we stop early: that would reset
    // the connection and the client would never see the 413 response.
    for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
      if (chunk instanceof Uint8Array) bytesRead += chunk.length;
      if (bytesRead > maxBytes) {
        exceededLimit = true;
        return;
      }
      yield chunk;
    }
  }

  return {
    chunks: chunks(),
    filename: undefined,
    bytesRead: () => bytesRead,
    exceededLimit: () => exceededLimit,
  };
}
