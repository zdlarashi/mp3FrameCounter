#!/usr/bin/env bash
# Generates small MP3 test fixtures with ffmpeg (libmp3lame):
#
# - test/fixtures/generated/: valid MPEG-1 Layer III files, with the frame
#   count ffprobe reports for each one in manifest.json
# - test/fixtures/errors/: uploads the API must reject (empty, not audio,
#   other MPEG versions/layers)
#
# The generated files are committed, so the tests don't need ffmpeg. Run this
# only to regenerate or add fixtures:
#
#   ./scripts/generate-fixtures.sh
#
# Requires: ffmpeg and ffprobe built with libmp3lame.
set -euo pipefail

FIXTURES_DIR="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures"
OUT_DIR="$FIXTURES_DIR/generated"
ERR_DIR="$FIXTURES_DIR/errors"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$OUT_DIR" "$ERR_DIR"
rm -f "$OUT_DIR"/*.mp3 "$OUT_DIR/manifest.json" "$ERR_DIR"/*

# 1 second of a 440 Hz tone (a varying signal so VBR frame sizes change)
SOURCE=(-f lavfi -i "sine=frequency=440:duration=1,volume='0.2+0.8*t':eval=frame")

# Common output options: no metadata unless a fixture asks for it
NO_TAGS=(-map_metadata -1 -id3v2_version 0 -write_id3v1 0)

encode() {
  local name="$1"
  shift
  ffmpeg -v error -y "$@" "$OUT_DIR/$name"
}

encode cbr-128k-stereo-44k.mp3 "${SOURCE[@]}" -ac 2 -ar 44100 -c:a libmp3lame -b:a 128k "${NO_TAGS[@]}"
encode vbr-stereo-44k.mp3      "${SOURCE[@]}" -ac 2 -ar 44100 -c:a libmp3lame -q:a 4    "${NO_TAGS[@]}"
encode cbr-64k-mono-44k.mp3    "${SOURCE[@]}" -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k  "${NO_TAGS[@]}"
encode vbr-mono-44k.mp3        "${SOURCE[@]}" -ac 1 -ar 44100 -c:a libmp3lame -q:a 4    "${NO_TAGS[@]}"
encode cbr-192k-stereo-48k.mp3 "${SOURCE[@]}" -ac 2 -ar 48000 -c:a libmp3lame -b:a 192k "${NO_TAGS[@]}"
encode cbr-96k-stereo-32k.mp3  "${SOURCE[@]}" -ac 2 -ar 32000 -c:a libmp3lame -b:a 96k  "${NO_TAGS[@]}"
encode cbr-128k-no-xing.mp3    "${SOURCE[@]}" -ac 2 -ar 44100 -c:a libmp3lame -b:a 128k "${NO_TAGS[@]}" -write_xing 0

# ID3v2 tag with embedded JPEG cover art (JPEG data starts with FF D8 FF)
ffmpeg -v error -y -f lavfi -i "testsrc=size=64x64:duration=1" -frames:v 1 "$WORK_DIR/cover.jpg"
encode id3v2-cover-art.mp3 "${SOURCE[@]}" -i "$WORK_DIR/cover.jpg" \
  -map 0:a -map 1:v -c:a libmp3lame -b:a 128k -c:v copy -disposition:v attached_pic \
  -id3v2_version 3 -metadata title="Fixture" -metadata artist="mp3FrameCounter" -write_id3v1 0

# ID3v1 tag (128 bytes, "TAG") after the last frame. ffmpeg only writes ID3v1
# when ID3v2 is enabled too, so this file has both (common in real files).
encode id3v1-trailer.mp3 "${SOURCE[@]}" -c:a libmp3lame -b:a 128k \
  -id3v2_version 3 -metadata title="Fixture" -write_id3v1 1

describe() {
  case "$1" in
    cbr-128k-stereo-44k.mp3) echo "CBR 128 kbps stereo 44.1 kHz (Info tag)" ;;
    vbr-stereo-44k.mp3) echo "VBR stereo 44.1 kHz (Xing tag)" ;;
    cbr-64k-mono-44k.mp3) echo "CBR 64 kbps mono 44.1 kHz (Info tag at mono offset)" ;;
    vbr-mono-44k.mp3) echo "VBR mono 44.1 kHz (Xing tag at mono offset)" ;;
    cbr-192k-stereo-48k.mp3) echo "CBR 192 kbps stereo 48 kHz (Info tag)" ;;
    cbr-96k-stereo-32k.mp3) echo "CBR 96 kbps stereo 32 kHz (Info tag)" ;;
    cbr-128k-no-xing.mp3) echo "CBR 128 kbps without a Xing/Info frame" ;;
    id3v2-cover-art.mp3) echo "ID3v2.3 tag with embedded JPEG cover art" ;;
    id3v1-trailer.mp3) echo "ID3v2.3 tag and an ID3v1 tag after the last frame" ;;
  esac
}

frame_count() {
  ffprobe -v error -select_streams a:0 -count_packets \
    -show_entries stream=nb_read_packets -of csv=p=0 "$1"
}

{
  echo "["
  first=1
  for file in "$OUT_DIR"/*.mp3; do
    name="$(basename "$file")"
    [[ $first -eq 1 ]] || echo ","
    first=0
    printf '  {\n    "file": "%s",\n    "description": "%s",\n    "frameCount": %s\n  }' \
      "$name" "$(describe "$name")" "$(frame_count "$file")"
  done
  echo
  echo "]"
} > "$OUT_DIR/manifest.json"

# --- Files the API must reject -------------------------------------------

# 0 bytes → 400 EMPTY_FILE
: > "$ERR_DIR/empty.mp3"

# Text with an .mp3 extension → 422 INVALID_MP3
printf 'This is a text file with an .mp3 extension, not audio.\n' > "$ERR_DIR/not-an-mp3.mp3"

# Real MP3s outside the MPEG-1 Layer III scope → 422 INVALID_MP3.
# Sample rates below 32 kHz make libmp3lame write MPEG-2 (22.05 kHz) or
# MPEG-2.5 (11.025 kHz) frames.
ffmpeg -v error -y "${SOURCE[@]}" -ar 22050 -c:a libmp3lame -b:a 64k "${NO_TAGS[@]}" "$ERR_DIR/mpeg2-layer3-22k.mp3"
ffmpeg -v error -y "${SOURCE[@]}" -ar 11025 -c:a libmp3lame -b:a 32k "${NO_TAGS[@]}" "$ERR_DIR/mpeg25-layer3-11k.mp3"
# MPEG-1 Layer II (.mp2)
ffmpeg -v error -y "${SOURCE[@]}" -ar 44100 -c:a mp2 -b:a 128k "${NO_TAGS[@]}" "$ERR_DIR/mpeg1-layer2.mp2"

echo "Generated fixtures in $OUT_DIR:"
cat "$OUT_DIR/manifest.json"
echo
echo "Generated error fixtures in $ERR_DIR:"
ls -l "$ERR_DIR"
