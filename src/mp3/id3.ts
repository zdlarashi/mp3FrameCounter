/** ID3v2 tags start with a fixed 10-byte header (and may end with a 10-byte footer). */
export const ID3V2_HEADER_SIZE = 10;

const ID3V2_FOOTER_SIZE = 10;
const FOOTER_PRESENT_FLAG = 0x10;

/** "ID3" in ASCII */
const ID3V2_IDENTIFIER = [0x49, 0x44, 0x33] as const;

/**
 * Decodes a 4-byte "syncsafe" integer: 7 bits per byte, most significant
 * byte first, so the high bit of every byte stays 0 (never mistaken for an
 * MPEG frame sync).
 */
export function decodeSyncsafe(bytes: Uint8Array, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value = (value << 7) | ((bytes[offset + i] ?? 0) & 0x7f);
  }
  return value;
}

/**
 * Returns the total size of the ID3v2 tag at `offset` (header + body +
 * optional footer), or null if the bytes there are not an ID3v2 header.
 *
 * Header layout (10 bytes): "ID3", major version, revision, flags,
 * 4-byte syncsafe size of the tag body (excluding header and footer).
 *
 * The tag must be skipped as a whole: its body can contain bytes that look
 * like MPEG frame headers.
 */
export function getId3v2TagSize(bytes: Uint8Array, offset = 0): number | null {
  if (offset + ID3V2_HEADER_SIZE > bytes.length) return null;

  const header = bytes.subarray(offset, offset + ID3V2_HEADER_SIZE);
  const [, , , majorVersion, revision, flags] = header;

  const hasIdentifier = ID3V2_IDENTIFIER.every((byte, i) => header[i] === byte);
  const hasValidVersion = majorVersion !== 0xff && revision !== 0xff;
  const hasSyncsafeSize = header.subarray(6).every((byte) => byte < 0x80);
  if (!hasIdentifier || !hasValidVersion || !hasSyncsafeSize) return null;

  const footerSize =
    ((flags ?? 0) & FOOTER_PRESENT_FLAG) !== 0 ? ID3V2_FOOTER_SIZE : 0;

  return ID3V2_HEADER_SIZE + decodeSyncsafe(header, 6) + footerSize;
}
