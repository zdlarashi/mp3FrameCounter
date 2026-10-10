# Implementation Plan — MP3 Frame Counter API

## Goal

A TypeScript HTTP service exposing `POST /file-upload` that accepts an MP3 upload,
parses the MPEG-1 Layer III frame headers itself (no MP3 parsing libraries), and
responds with `application/json`:

```json
{ "frameCount": 6089 }
```

Assessed on: correctness, code quality / TS usage, tooling, error handling,
scalability (large files), and git hygiene / structured approach.

---

## 1. Tech stack

| Concern        | Choice                                                                    | Why                                                                                                                 |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Node 22 (installed: v22.22.1)                                             | Current LTS; native `stream`, `fetch`, etc.                                                                         |
| Language       | TypeScript, `strict: true`, `noUncheckedIndexedAccess`                    | Required; strict flags catch table lookup bugs                                                                      |
| HTTP framework | Fastify + `@fastify/multipart`                                            | TS-first, streams multipart parts (no buffering whole file), built-in JSON serialisation & `app.inject()` for tests |
| Dev runner     | `tsx` (watch mode)                                                        | Zero-config TS execution                                                                                            |
| Build          | `tsc` → `dist/`                                                           | Simple, no bundler needed                                                                                           |
| Tests          | Vitest                                                                    | Fast, native TS/ESM                                                                                                 |
| Lint / format  | ESLint (flat config + `typescript-eslint` strict-type-checked) + Prettier | "Standardised tooling" criterion                                                                                    |
| Verification   | `ffprobe` (installed) and/or `mediainfo` (`sudo apt install mediainfo`)   | Ground truth for frame counts                                                                                       |

Scripts in `package.json`: `dev`, `build`, `start`, `test`, `test:watch`,
`lint`, `format`, `format:check`, `typecheck`.

Optional extras if time allows: `Dockerfile`, GitHub Actions CI running
lint + typecheck + test, `.nvmrc`, `.editorconfig`.

---

## 2. Project structure

```
src/
  server.ts              # entry point: reads config, builds app, listens
  app.ts                 # buildApp(): registers plugins, routes, error handler (testable, no listen)
  config.ts              # PORT, HOST, MAX_FILE_SIZE from env with defaults
  errors.ts              # AppError class hierarchy (status code + error code + message)
  routes/
    fileUpload.ts        # POST /file-upload — pipes the multipart file stream into the counter
  mp3/
    constants.ts         # bitrate & sample-rate tables, header bit masks
    frameHeader.ts       # parseFrameHeader(bytes) -> FrameHeader | null ; frameLength(header)
    id3.ts               # ID3v2 tag size detection (header + syncsafe int)
    xing.ts              # detect Xing / Info / VBRI tag in first frame
    Mp3FrameCounter.ts   # streaming, chunk-boundary-safe state machine
    countFrames.ts       # countFrames(stream: Readable): Promise<CountResult>
test/
  helpers/buildFrame.ts  # synthesise valid MPEG-1 L3 frames/tags for unit tests
  mp3/*.test.ts          # unit tests
  routes/fileUpload.test.ts  # integration tests via app.inject()
  fixtures/sample.mp3    # provided sample file
  fixtures/generated/    # ffmpeg-generated fixtures + manifest.json (step 6)
scripts/
  generate-fixtures.sh   # regenerates test/fixtures/generated
```

Key design principle: **the MP3 parsing is framework-agnostic** — pure functions plus
a streaming counter that only knows about `Buffer` chunks. The HTTP layer is a thin
adapter. This keeps the core easily unit-testable and swappable.

---

## 3. MP3 domain knowledge to implement

### 3.1 Frame header (4 bytes, 32 bits — `AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM`)

| Bits   | Field           | MPEG-1 Layer III requirement                               |
| ------ | --------------- | ---------------------------------------------------------- |
| A (11) | Frame sync      | all `1` → `byte0 === 0xFF && (byte1 & 0xE0) === 0xE0`      |
| B (2)  | Version         | `11` = MPEG-1 (reject others: out of scope)                |
| C (2)  | Layer           | `01` = Layer III                                           |
| D (1)  | Protection      | `0` → 16-bit CRC follows header (affects Xing offset only) |
| E (4)  | Bitrate index   | `0000` = free format (unsupported → invalid), `1111` = bad |
| F (2)  | Sample rate idx | `11` reserved → invalid                                    |
| G (1)  | Padding         | adds 1 byte to frame                                       |
| I (2)  | Channel mode    | `11` = mono (affects side-info size for Xing detection)    |

**MPEG-1 Layer III bitrates (kbps)**, index 1–14:
`32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320`

**MPEG-1 sample rates (Hz)**, index 0–2: `44100, 48000, 32000`

**Frame length (bytes):** `Math.floor(144 * bitrate * 1000 / sampleRate) + padding`
(144 = 1152 samples per frame / 8 bits).

Model as a typed `FrameHeader` interface (`bitrateKbps`, `sampleRate`, `padding`,
`channelMode`, `hasCrc`, `frameLength`) and use `as const` tables + union types
for channel mode etc. `parseFrameHeader` returns `null` for anything that isn't a
valid MPEG-1 L3 header (no exceptions on the hot path).

### 3.2 Things in the file that are NOT audio frames

1. **ID3v2 tag** at start: `"ID3"`, 2 version bytes, 1 flags byte, 4-byte
   _syncsafe_ size (7 bits per byte). Total skip = `10 + size` (+10 if footer flag
   `0x10` set). Must be skipped explicitly — tag payload can contain false sync bytes.
2. **Xing / Info / VBRI header frame**: the first frame of LAME-encoded files is a
   valid-looking frame whose payload holds metadata, not audio. Located after the
   side info: offset `4 (+2 if CRC) + (mono ? 17 : 32)` for Xing/Info; fixed offset
   `36` for VBRI.
3. **Trailing tags**: ID3v1 (`"TAG"`, 128 bytes), APEv2, Lyrics3 — handled by the
   resync logic (they won't parse as valid consecutive frames).

### 3.3 Counting decision — Xing/Info frame

**Decision: exclude the Xing/Info/VBRI frame from the count**, because it carries
no audio and both `mediainfo` and `ffprobe` exclude it. This is the most likely
"correct" answer for the sample (verified: see "Sample file facts"). Document
the decision in the README and in a code comment. (Could expose
`includeTagFrame` as an option if needed.)

### 3.4 Sync / robustness strategy

- After a frame, the next header is expected at exactly `offset + frameLength`.
- If the bytes there are not a valid header (corrupt data, junk), **scan forward
  byte-by-byte** for the next sync.
- To avoid false positives during a scan (random `0xFFFx` bytes in junk), only
  accept a resynced header if **the following header (at `+frameLength`) is also
  valid** — or the stream ends exactly there. Same check applies to the very first
  frame. Keep this simple: one confirmation frame.
- Track `bytesSkipped` / `resyncCount` internally for logging; useful for debugging
  and a talking point.

---

## 4. Streaming design (scalability)

Never buffer the whole upload in memory.

- `@fastify/multipart`'s `request.file()` yields the file as a `Readable` stream.
- `Mp3FrameCounter` is a state machine consuming `Buffer` chunks:
  - `push(chunk: Buffer): void`
  - `finish(): CountResult` (`{ frameCount, ... }`)
- State held between chunks:
  - `bytesToSkip` — remaining bytes of the current frame/tag that span chunks
    (skipped without copying).
  - A small **carry-over buffer** holding a partial header / partial ID3 header /
    the first ~40 bytes of frame 1 (for Xing detection) / look-ahead for the
    confirmation-frame check. Bounded size (well under 2 KB, max frame is 1441 bytes),
    so memory is O(1) regardless of file size.
- `countFrames(stream)` iterates `for await (const chunk of stream)` → `push` →
  `finish`. Backpressure is natural with async iteration.
- Work per byte is O(1) on the happy path (we jump frame to frame; we only touch
  4 header bytes per ~417-byte frame), so it's effectively I/O bound.
- Simpler alternative if time is short: buffer to a temp file / memory and parse
  with offsets. Start with the streaming version since chunk boundaries are the
  only real complexity, and tests can cover them by feeding 1-byte chunks.

**Measured (step 7):** streaming 1 GiB of synthetic 128 kbps frames in 64 KB
chunks through `countFrames` gives the exact count (2,574,921) at about 8 GB/s,
with the heap staying under 18 MB. The sample file takes about 5 ms. Parsing
is far faster than any network upload, so throughput is I/O bound.

Upload size limit via `@fastify/multipart` `limits.fileSize` (configurable,
default e.g. 200 MB); detect `file.truncated` / the plugin's limit error → 413.

---

## 5. HTTP API behaviour

**Request:** `POST /file-upload`, `Content-Type: multipart/form-data`, file in
field `file`.

```bash
curl -F "file=@test/fixtures/sample.mp3" http://localhost:3000/file-upload
```

**Responses** (all `Content-Type: application/json; charset=utf-8`):

| Case                                   | Status    | Body                                                        |
| -------------------------------------- | --------- | ----------------------------------------------------------- |
| Success                                | 200       | `{ "frameCount": n }`                                       |
| Not multipart / no file part           | 400       | `{ "error": { "code": "MISSING_FILE", "message": "..." } }` |
| Empty file                             | 400       | `EMPTY_FILE`                                                |
| File exceeds size limit                | 413       | `FILE_TOO_LARGE`                                            |
| No valid MPEG-1 Layer III frames found | 422       | `INVALID_MP3`                                               |
| Unknown route / wrong method           | 404 / 405 | Fastify default, normalised to same error shape             |
| Unexpected                             | 500       | `INTERNAL_ERROR` (generic message, details logged only)     |

Notes:

- Don't trust the client's MIME type / file extension (browsers & curl vary);
  validate by _content_. Optionally log a warning for unexpected mimetypes.
- Define the success response with a Fastify JSON schema (`response: { 200: … }`)
  for fast serialisation + a typed contract. Use a TypeBox or plain schema + TS
  type — keep it lightweight.
- Central `setErrorHandler` maps `AppError` subclasses → status/body; everything
  else → 500. Fastify's logger (pino) logs errors with request id.
- Add `GET /health` (cheap, useful for deployment talk).

---

## 6. Testing strategy

**Unit (pure, synthetic data via `test/helpers/buildFrame.ts`):**

- `parseFrameHeader`: valid header for each sample rate; rejects MPEG-2/2.5,
  Layer I/II, bitrate index 0 and 15, sample rate idx 3, bad sync.
- `frameLength`: known values (128 kbps / 44.1 kHz → 417 or 418 with padding;
  320 kbps / 48 kHz → 960).
- ID3v2 size: syncsafe decoding, footer flag.
- Xing/Info/VBRI detection for mono vs stereo and with CRC.
- `Mp3FrameCounter`:
  - N plain frames → N
  - ID3v2 tag + frames → N (incl. tag containing fake `0xFFFB` bytes)
  - Xing frame + frames → N (excluded)
  - trailing ID3v1 → N
  - junk between frames → resyncs correctly
  - truncated final frame → counted if its header is intact (matches ffprobe;
    see Open items)
  - **same input fed in 1-byte chunks, random chunk sizes** → identical result
  - empty / non-MP3 input → 0 → maps to 422
  - VBR (mixed bitrates) frames

**Integration (`app.inject()`):**

- Sample file → 200, correct `frameCount`, `content-type` is JSON.
- No file / wrong field / non-multipart body → 400.
- Text file renamed `.mp3` → 422.
- Oversized upload (with a tiny limit configured in test) → 413.

**Ground truth:**

```bash
ffprobe -v error -select_streams a:0 -count_packets \
  -show_entries stream=nb_read_packets -of csv=p=0 sample.mp3
mediainfo --Inform="Audio;%FrameCount%" sample.mp3
```

**Encoder-generated fixtures (step 6).** Synthetic frames come from our own
test helper, so they share our understanding of the format. Real encoder
output, checked against ffprobe, tests against reality:

- `scripts/generate-fixtures.sh` (`npm run fixtures:generate`) makes ~1 s clips with `ffmpeg`/libmp3lame
  and writes `test/fixtures/generated/manifest.json` with each file's
  description and ffprobe frame count.
- The generated `.mp3` files and the manifest are committed, so running the
  tests doesn't need ffmpeg. The script is there to show how they were made and
  to regenerate them.
- One parametrised test runs every fixture through the counter and compares
  the result with the manifest.

| Fixture                         | What it exercises                                           |
| ------------------------------- | ----------------------------------------------------------- |
| CBR 128k, stereo, 44.1 kHz      | `Info` tag in the first frame                               |
| VBR (`-q:a 4`)                  | `Xing` tag, varying frame sizes                             |
| Mono                            | Xing tag at the mono offset (17 bytes of side info, not 32) |
| 48 kHz, 32 kHz                  | the other sample rates with real frame sizes                |
| No Xing (`-write_xing 0`)       | the first frame is audio and must be counted                |
| ID3v2 + embedded JPEG cover art | sync-like bytes (`FF D8 FF`) inside the tag                 |
| ID3v1 trailer                   | trailing tag after the last frame                           |

VBRI headers (Fraunhofer encoder only) and CRC-protected frames can't be
produced with ffmpeg, so they stay covered by synthetic tests.

---

## 7. Step-by-step execution (each step = 1+ focused commit)

### Step 0 — Test-driven development workflow (applies to every step below)

All production code is written **test-first** using red → green → refactor:

1. **Red** — write the smallest failing test that describes the next behaviour
   (e.g. "rejects MPEG-2 headers", "counts frames split across 1-byte chunks").
   Run `npm test` and confirm it fails _for the expected reason_.
2. **Green** — write the minimum code to make it pass. No speculative features.
3. **Refactor** — tidy names, extract helpers, remove duplication with the tests
   green. Run `npm run lint && npm run typecheck`.
4. Repeat for the next behaviour.

Rules of engagement:

- No file in `src/` gets new behaviour without a test that first failed.
- Work outside-in where it helps: write the **acceptance test first**
  (`POST /file-upload` with `sample.mp3` → `200 { "frameCount": 6089 }`). It stays
  red until the end and is the definition of done. Then drive the internals
  bottom-up with unit tests (header → ID3 → counter → Xing → HTTP).
- Use `npm run test:watch` (Vitest watch mode) during development.
- **Git history shows the TDD cycle.** Commit at meaningful points: either a
  `test:` commit (failing spec) followed by a `feat:` commit (implementation), or
  one combined commit per green cycle. Every commit on `main` except a deliberate
  `test:` red commit should build and pass. (Use `it.todo` / `it.fails` for specs
  checked in ahead of their implementation so CI stays green.)
- Keep the coverage report (`vitest --coverage`) as a sanity check, not a target.

### Steps

1. ✅ **Scaffold** — `npm init`, TS config (strict), ESLint, Prettier, Vitest
   (+ `@vitest/coverage-v8`), `.gitignore`, `.nvmrc`, npm scripts. Move the
   sample to `test/fixtures/sample.mp3`. Add one trivial test to prove
   the test runner works. Commit: `chore: scaffold TypeScript project with tooling`.
2. ✅ **Acceptance test (red)** — integration test for `POST /file-upload` with the
   sample expecting `{ frameCount: 6089 }` and a JSON content type. Marked
   `it.fails`/`it.todo` until step 8 makes it pass.
3. ✅ **Header parsing (TDD)** — `buildFrame` test helper first, then tests for
   valid/invalid headers and frame lengths → `constants.ts`, `frameHeader.ts`.
   Commit: `feat(mp3): parse MPEG-1 Layer III frame headers`.
4. ✅ **ID3v2 skipping (TDD)** — syncsafe/footer tests → `id3.ts`.
5. ✅ **Streaming counter (TDD)** — tests for N frames, junk/resync, trailing
   ID3v1, truncated final frame, 1-byte & random chunking → `Mp3FrameCounter`.
6. ✅ **Xing/Info/VBRI exclusion (TDD)**
   1. Add `scripts/generate-fixtures.sh`, the generated fixtures and the
      manifest (§6), plus a parametrised test comparing the counter with
      ffprobe. **Red:** files with an Info/Xing tag are off by one.
   2. Unit tests for detecting the tag at the stereo, mono and CRC offsets
      (Xing, Info) and at VBRI's fixed offset → `xing.ts`.
   3. Counter tests showing the tag frame is excluded only when it is the
      first frame → integrate into `Mp3FrameCounter`. Fixture test turns green.
7. ✅ **Sample-file unit test** — `countFrames(createReadStream(sample))` → 6089.
8. **HTTP layer (TDD)** — integration tests for each status code in §5 first →
   `app.ts`, `server.ts`, `config.ts`, route, error classes, error handler.
   The step-2 acceptance test turns green.
9. **Docs** — README: requirements, install, run (dev/prod), curl example, test /
   lint commands, TDD approach, design decisions (streaming, Xing exclusion,
   out-of-scope formats), and a "with more time" section.
10. **Polish (optional)** — Dockerfile, CI workflow (lint + typecheck + test).

Commit early and often with conventional-commit messages.

---

## 8. Out of scope (document in README)

- MPEG-2 / 2.5 and Layer I/II (header parser rejects them; adding them is mostly
  extra table entries + `72 * bitrate / sampleRate` for MPEG-2 L3).
- Free-format bitrate streams.
- CRC validation of frames.
- Auth, rate limiting, persistence.

## 9. "With more time" talking points

- Support other MPEG versions/layers via table-driven config.
- Use Xing/VBRI frame count as a fast path (with caveat that it can be wrong).
- Accept raw `audio/mpeg` request bodies in addition to multipart.
- Worker threads / horizontal scaling (parser is already O(1) memory, I/O bound).
- Property-based tests (fast-check) for chunk-splitting invariance.
- Request timeouts, rate limiting, OpenAPI docs via `@fastify/swagger`.

---

## Sample file facts (verified)

- Currently at repo root as `sample (2).mp3`; to be moved to
  `test/fixtures/sample.mp3` in step 1.
- MPEG-1 Layer III, 44.1 kHz, stereo, VBR (~73 kbps average).
- Starts with an ID3v2.4 tag (10-byte header + 34-byte payload → first frame at
  byte offset 44).
- First frame is a **Xing** header frame; its frame-count field is `0x17C9` = 6089.
- `ffprobe -count_packets` → **6089** frames.
- ⇒ Expected `frameCount` = **6089** (Xing frame excluded), confirming §3.3.
- No trailing ID3v1 tag.

## Open items

- [ ] Optionally cross-check with `mediainfo` (`sudo apt install mediainfo`).
- [x] Truncated final frame: **counted** if its 4-byte header is intact and
      in sync. Matches ffprobe (a 128 kbps file cut 200 or 410 bytes short
      still reports all 78 packets). A partial header (< 4 bytes) is not counted.
