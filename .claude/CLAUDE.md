# Project memory — mp3FrameCounter

TypeScript API (`POST /file-upload`) that counts MPEG-1 Layer III frames in an
uploaded MP3. This is a graded technical assessment: reviewers judge code
quality, tooling, error handling, scalability, **git usage and evidence of a
structured approach**.

The full plan is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Follow it
step by step and keep it up to date if decisions change.

## Workflow

- **Test-driven development, always.** Red → green → refactor (plan §7, Step 0):
  - Write the smallest failing test first and confirm it fails for the right reason.
  - Write the minimum code to pass.
  - Refactor with the tests green.
  - Don't add behaviour to `src/` without a test that failed first.
- **Commit at the end of each plan step, once that step's tests pass.** Don't
  wait to be asked at a step boundary. Before committing, run
  `npm test && npm run lint && npm run typecheck`.
- Use conventional-commit messages (`chore:`, `test:`, `feat:`, `fix:`,
  `docs:`, `refactor:`), one focused commit per step or green cycle.
- Keep `.claude/` (this file and the plan) tracked in git. It is part of the
  submission.
- Don't use an npm package to parse MP3 frame data; that is an assignment rule.
  Generic utilities and the HTTP framework are fine.

## Key facts

- Sample fixture: `test/fixtures/sample.mp3`. Expected `frameCount` is
  **6089**, verified with ffprobe and the file's Xing header.
- Leave the Xing/Info/VBRI header frame out of the count (plan §3.3).
- Ground truth for other files:
  `ffprobe -v error -select_streams a:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 <file>`
