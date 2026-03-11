/** Minimum payload size to attempt compression (bytes). Below this threshold, compression overhead exceeds savings. */
const MIN_COMPRESS_SIZE = 256;

/**
 * Compress data using raw deflate (no gzip/zlib headers).
 * Returns null if the input is too small or compression doesn't reduce size.
 */
export async function compressPayload(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length < MIN_COMPRESS_SIZE) {
    return null;
  }

  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(data as unknown as BufferSource);
  writer.close();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    totalLength += value.length;
  }

  // Skip if compression didn't help
  if (totalLength >= data.length) {
    return null;
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompress raw deflate data.
 */
export async function decompressPayload(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(data as unknown as BufferSource);
  writer.close();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    totalLength += value.length;
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
