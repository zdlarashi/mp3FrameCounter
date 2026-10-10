# mp3FrameCounter

[![CI](https://github.com/zdlarashi/mp3FrameCounter/actions/workflows/ci.yml/badge.svg)](https://github.com/zdlarashi/mp3FrameCounter/actions/workflows/ci.yml)

A TypeScript API that counts the frames in an uploaded MP3 file. The MPEG
frame parsing is written from scratch: no MP3 or audio libraries are used.

```bash
$ curl -F "file=@test/fixtures/sample.mp3" http://localhost:3000/file-upload
{"frameCount":6089}
```

## Quick start

Requires **Node.js 22+** (see `.nvmrc`).

```bash
npm ci
npm run dev          # start with auto-reload on http://localhost:3000
```

Or build and run the compiled version:

```bash
npm run build
npm start
```

Then, in another terminal:

```bash
curl -F "file=@test/fixtures/sample.mp3" http://localhost:3000/file-upload
# {"frameCount":6089}
```

## API

### `POST /file-upload`

Upload an MP3 as `multipart/form-data`. The first file in the form is used
(the field name doesn't matter; `file` is conventional).

**200 OK** (`Content-Type: application/json; charset=utf-8`)

```json
{ "frameCount": 6089 }
```

**Errors** all use the same shape:

```json
{
  "error": {
    "code": "INVALID_MP3",
    "message": "No MPEG-1 Layer III frames were found. ..."
  }
}
```

| Status | `code`                           | When                                                    |
| ------ | -------------------------------- | ------------------------------------------------------- |
| 400    | `MISSING_FILE`                   | No body, a non-form body (e.g. JSON), or no file part   |
| 400    | `EMPTY_FILE`                     | The uploaded file is 0 bytes                            |
| 413    | `FILE_TOO_LARGE`                 | The file exceeds `MAX_FILE_SIZE_MB`                     |
| 415    | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | Unsupported content type (e.g. a raw `audio/mpeg` body) |
| 422    | `INVALID_MP3`                    | No MPEG-1 Layer III frames found in the file            |
| 404    | `NOT_FOUND`                      | Unknown route                                           |
| 500    | `INTERNAL_ERROR`                 | Unexpected error (details are logged, not returned)     |

More examples, using files in [`test/fixtures/`](test/fixtures/):

```bash
URL=http://localhost:3000/file-upload

# Other valid MP3s → 200 (expected counts in test/fixtures/generated/manifest.json)
curl -F "file=@test/fixtures/generated/vbr-mono-44k.mp3" $URL        # {"frameCount":40}
curl -F "file=@test/fixtures/generated/id3v2-cover-art.mp3" $URL     # {"frameCount":40}

# Empty file → 400 EMPTY_FILE
curl -F "file=@test/fixtures/errors/empty.mp3" $URL

# Text file named .mp3 → 422 INVALID_MP3
curl -F "file=@test/fixtures/errors/not-an-mp3.mp3" $URL

# Real MP3s outside the MPEG-1 Layer III scope → 422 INVALID_MP3
curl -F "file=@test/fixtures/errors/mpeg2-layer3-22k.mp3" $URL       # MPEG-2 Layer III
curl -F "file=@test/fixtures/errors/mpeg25-layer3-11k.mp3" $URL      # MPEG-2.5 Layer III
curl -F "file=@test/fixtures/errors/mpeg1-layer2.mp2" $URL           # MPEG-1 Layer II

# No file → 400 MISSING_FILE
curl -X POST $URL

# Too large → 413 FILE_TOO_LARGE (start the server with a 1 MiB limit first)
MAX_FILE_SIZE_MB=1 npm start
curl -F "file=@test/fixtures/sample.mp3" $URL
```

### `GET /health`

Returns `{ "status": "ok" }`.

## Configuration

Set with environment variables. Invalid values stop the server at startup
with a message naming the variable.

| Variable           | Default   | Description                                                  |
| ------------------ | --------- | ------------------------------------------------------------ |
| `PORT`             | `3000`    | Port to listen on                                            |
| `HOST`             | `0.0.0.0` | Interface to bind                                            |
| `MAX_FILE_SIZE_MB` | `200`     | Upload size limit in MiB                                     |
| `LOG_LEVEL`        | `info`    | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

```bash
PORT=8080 MAX_FILE_SIZE_MB=50 npm start
```

## Development

| Command                     | What it does                                       |
| --------------------------- | -------------------------------------------------- |
| `npm test`                  | Run all tests once                                 |
| `npm run test:watch`        | Re-run tests on save                               |
| `npm run test:coverage`     | Tests with a coverage report (`coverage/`)         |
| `npm run lint`              | ESLint (typescript-eslint strict, type-checked)    |
| `npm run typecheck`         | TypeScript type check                              |
| `npm run format`            | Format with Prettier (`format:check` to verify)    |
| `npm run fixtures:generate` | Regenerate the ffmpeg test fixtures (needs ffmpeg) |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs format check,
lint, type check, tests and build on every push and pull request.

Tooling: TypeScript (strict, plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`), Fastify, Vitest, ESLint, Prettier.

## How it works

### MP3 frames in brief

An MP3 file is a sequence of independent **frames**, each with a 4-byte
header starting with 11 set bits (the "frame sync"). The header gives the
bitrate, sample rate and padding, from which the frame's length follows:

```
frameLength = floor(144 × bitrate / sampleRate) + padding
```

So counting frames means jumping from header to header. A real file also
contains things that aren't audio frames:

- an **ID3v2 tag** at the start (title, artist, cover art), whose size is in
  its 10-byte header. It is skipped as a whole, because its contents (e.g.
  JPEG data) can contain bytes that look like frame headers.
- a **Xing/Info/VBRI frame**: encoders often make the first frame a
  valid-looking frame that holds metadata (total frames, seek table)
  instead of audio. It is **not counted**, matching ffprobe and mediainfo.
- **trailing tags** (ID3v1, APE) or junk after the last frame.

### Streaming design

The upload is never held in memory or written to disk. The multipart stream
is passed chunk by chunk to `Mp3FrameCounter`, a small state machine:

- **start**: checks for an ID3v2 tag and skips it, even across many chunks.
- **synced**: expects the next header exactly where the last frame ended,
  counts it, and skips the frame body without copying it.
- **searching**: when out of sync (junk, corruption), jumps to the next `0xFF`
  byte. A header found here only counts if **another valid header follows
  it**, so stray bytes aren't mistaken for frames.

At most one partial frame (< 1.5 KB) is carried between chunks, so memory
use doesn't grow with file size. Async iteration gives backpressure, so the
upload is read no faster than it's counted.

**Measured:**

- 1 GiB of synthetic frames counted from memory at about 8 GB/s, with the
  heap under 18 MB
- a 146 MB upload over HTTP counted in 0.1 s, with the server's RSS rising
  about 29 MB

Throughput is limited by the network, not by parsing.

### Project structure

```
src/
  server.ts               entry point: config, listen, graceful shutdown
  app.ts                  buildApp(): plugins, routes, error handling (no listen, for tests)
  config.ts               environment variables, validated
  errors.ts               AppError subclasses → HTTP status + error code
  routes/fileUpload.ts    POST /file-upload
  mp3/
    constants.ts          bitrate / sample-rate tables, channel modes
    frameHeader.ts        parse and validate a 4-byte frame header
    id3.ts                detect an ID3v2 tag and its size
    xing.ts               detect a Xing / Info / VBRI tag frame
    Mp3FrameCounter.ts    streaming frame counter (state machine)
    countFrames.ts        count frames in any byte stream
test/
  acceptance.test.ts      end-to-end: sample upload → 6089
  routes/, mp3/, …        unit and integration tests
  helpers/                builders for synthetic frames and tags
  fixtures/sample.mp3     provided sample
  fixtures/generated/     ffmpeg-made fixtures + ffprobe frame counts
  fixtures/errors/        uploads that must be rejected (empty, text, MPEG-2/2.5, Layer II)
scripts/
  generate-fixtures.sh    regenerates test/fixtures/generated
```

The MP3 code in `src/mp3/` doesn't depend on Fastify, so it can be tested
on its own and reused elsewhere.

## Testing and verification

The project was built **test-first** (red → green → refactor), one step at a
time. The plan and the workflow are in [`.claude/`](.claude/), and each
commit corresponds to a step with its tests passing.

The tests come in three layers:

1. **Synthetic frames**: a test helper builds headers from raw bits, so tests
   cover every bitrate, sample rate and channel mode as well as invalid
   headers, junk, false syncs, truncation and tags. The helper keeps its own
   lookup tables, so it checks the code independently. Every input is also
   fed in 1-byte, fixed-size and random-size chunks, and the result must be
   the same.
2. **Real encoder output**: `scripts/generate-fixtures.sh` uses ffmpeg to make
   CBR, VBR, mono, 32/44.1/48 kHz files, plus files with no Xing frame, with
   ID3v2 cover art, and with an ID3v1 trailer. Their ffprobe frame counts are
   stored in `manifest.json` and the counter must match each one. The script
   also makes files the API must reject in `test/fixtures/errors/`: an empty
   file, a text file, and genuine MPEG-2, MPEG-2.5 and Layer II files. The
   files are committed, so ffmpeg isn't needed to run the tests.
3. **HTTP**: every status code is tested through Fastify's `inject()`. Every
   fixture file is also uploaded through the endpoint, plus the acceptance
   test with the sample.

To check any file yourself against ffprobe or mediainfo:

```bash
ffprobe -v error -select_streams a:0 -count_packets \
  -show_entries stream=nb_read_packets -of csv=p=0 file.mp3
mediainfo --Inform="Audio;%FrameCount%" file.mp3
```

## Design decisions

- **Xing/Info/VBRI frame not counted.** It carries metadata, not audio, and
  ffprobe and mediainfo exclude it. For the sample, ffprobe reports 6089 and
  the Xing header's own frame-count field is also 6089.
- **A truncated last frame is counted** if its 4-byte header is intact. That
  matches ffprobe, which counts it too.
- **Any form field name is accepted.** The spec doesn't name one, so
  requiring `file` would only cause avoidable errors.
- **Validated by content, not MIME type or extension.** Clients label
  uploads inconsistently (`audio/mpeg`, `audio/mp3`,
  `application/octet-stream`), so the parser decides.
- **Only MPEG-1 Layer III is supported**, as the spec allows. Other versions
  and layers are treated as invalid headers, so a file made only of them
  returns 422. They are rejected twice over: by the version/layer check, and,
  even without it, by the rule that the next header must follow, because the
  frame lengths from MPEG-1 tables don't match (checked by temporarily
  disabling the version check).

## Out of scope

- MPEG-2/2.5 and Layers I/II
- free-format bitrate streams
- CRC verification
- authentication and rate limiting

## With more time

- **Fail fast on non-MP3 uploads**: give up after the first few MB without a
  valid frame instead of reading the whole file.
- **Accept raw `audio/mpeg` bodies** as well as multipart.
- **Other MPEG versions and layers**: mostly extra table entries (MPEG-2
  Layer III uses `72 × bitrate / sampleRate`).
- **Property-based tests** (e.g. fast-check) for the chunking invariance.
- **Operations**: request timeouts, rate limiting, OpenAPI docs via
  `@fastify/swagger`.
