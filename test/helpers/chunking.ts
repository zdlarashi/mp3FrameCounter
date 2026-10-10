/** Deterministic PRNG (mulberry32) so "random" chunking is reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Splits `data` into chunks of a fixed size (the last may be shorter). */
export function fixedChunks(data: Buffer, size: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, i + size));
  }
  return chunks;
}

/** Splits `data` into chunks of random sizes between 1 and `maxSize`. */
export function randomChunks(
  data: Buffer,
  maxSize: number,
  seed: number,
): Buffer[] {
  const random = seededRandom(seed);
  const chunks: Buffer[] = [];
  let i = 0;
  while (i < data.length) {
    const size = 1 + Math.floor(random() * maxSize);
    chunks.push(data.subarray(i, i + size));
    i += size;
  }
  return chunks;
}
