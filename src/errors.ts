/**
 * Errors that map to a specific HTTP response. The error handler turns them
 * into `{ "error": { "code", "message" } }` with the given status code;
 * the message is shown to the client, so it must be safe and helpful.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingFileError extends AppError {
  readonly statusCode = 400;
  readonly code = 'MISSING_FILE';

  constructor() {
    super(
      'No file uploaded. Send the MP3 as multipart/form-data, ' +
        'e.g. curl -F "file=@song.mp3" <host>/file-upload',
    );
  }
}

export class EmptyFileError extends AppError {
  readonly statusCode = 400;
  readonly code = 'EMPTY_FILE';

  constructor() {
    super('The uploaded file is empty.');
  }
}

export class FileTooLargeError extends AppError {
  readonly statusCode = 413;
  readonly code = 'FILE_TOO_LARGE';

  constructor(maxFileSizeBytes: number) {
    super(
      `The uploaded file exceeds the maximum size of ${String(maxFileSizeBytes)} bytes.`,
    );
  }
}

export class InvalidMp3Error extends AppError {
  readonly statusCode = 422;
  readonly code = 'INVALID_MP3';

  constructor() {
    super(
      'No MPEG-1 Layer III frames were found. The file is not a valid MP3 ' +
        '(other MPEG versions and layers are not supported).',
    );
  }
}
