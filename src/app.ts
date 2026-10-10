import { STATUS_CODES } from 'node:http';
import multipart from '@fastify/multipart';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { DEFAULT_MAX_FILE_SIZE_BYTES } from './config.js';
import { AppError } from './errors.js';
import { fileUploadRoute } from './routes/fileUpload.js';

export interface AppOptions {
  /** Upload size limit in bytes (default 200 MiB). */
  maxFileSizeBytes?: number;
  /** Fastify/pino logger options; `false` disables logging (e.g. in tests). */
  logger?: FastifyServerOptions['logger'];
}

/** Fastify errors carry a code, but errors from elsewhere may not. */
type HandledError = Error & { statusCode?: number; code?: string };

export interface ErrorResponse {
  error: { code: string; message: string };
}

function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

/** e.g. 403 → "FORBIDDEN", for errors that don't carry their own code. */
function statusCodeName(statusCode: number): string {
  return (STATUS_CODES[statusCode] ?? 'CLIENT_ERROR')
    .toUpperCase()
    .replace(/\W+/g, '_');
}

/**
 * Builds the Fastify application without starting a server, so tests can
 * exercise it via `app.inject()`.
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const maxFileSizeBytes =
    options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const app = Fastify({ logger: options.logger ?? true });

  // Every error response has the same JSON shape: { error: { code, message } }
  app.setErrorHandler<HandledError>((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.info({ code: error.code }, error.message);
      return reply
        .status(error.statusCode)
        .send(errorBody(error.code, error.message));
    }

    // Client errors raised by Fastify or plugins (e.g. unsupported media type)
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      request.log.info({ err: error }, 'Client error');
      return reply
        .status(statusCode)
        .send(
          errorBody(error.code ?? statusCodeName(statusCode), error.message),
        );
    }

    // Anything else is a bug: log it, but don't leak details to the client.
    request.log.error({ err: error }, 'Unhandled error');
    return reply
      .status(500)
      .send(errorBody('INTERNAL_ERROR', 'An unexpected error occurred.'));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(
        errorBody(
          'NOT_FOUND',
          `Route ${request.method} ${request.url} not found`,
        ),
      );
  });

  // One file per request, streamed; the limit ends the stream early.
  void app.register(multipart, {
    limits: { fileSize: maxFileSizeBytes, files: 1 },
  });
  void app.register(fileUploadRoute, { maxFileSizeBytes });

  app.get('/health', () => ({ status: 'ok' }));

  return app;
}
