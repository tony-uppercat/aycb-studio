/**
 * Compression utilities using native CompressionStream API.
 * Falls back to uncompressed if API not available.
 */

export async function compressBlob(input: Blob): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') {
    console.warn('[compress] CompressionStream not available, returning uncompressed')
    return input
  }
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()

  // Write input
  const inputBuf = await input.arrayBuffer()
  writer.write(new Uint8Array(inputBuf))
  writer.close()

  // Collect output
  const chunks: BlobPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  return new Blob(chunks, { type: 'application/gzip' })
}

export async function decompressBlob(input: Blob): Promise<Blob> {
  if (typeof DecompressionStream === 'undefined') {
    console.warn('[compress] DecompressionStream not available, returning as-is')
    return input
  }
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  const inputBuf = await input.arrayBuffer()
  writer.write(new Uint8Array(inputBuf))
  writer.close()

  const chunks: BlobPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  return new Blob(chunks, { type: 'application/json' })
}

/**
 * Check if a Blob/File starts with gzip magic bytes (1f 8b).
 */
export async function isGzipped(input: Blob): Promise<boolean> {
  if (input.size < 2) return false
  const header = new Uint8Array(await input.slice(0, 2).arrayBuffer())
  return header[0] === 0x1f && header[1] === 0x8b
}

/**
 * Compress a string to gzip Blob.
 */
export async function compressString(input: string): Promise<Blob> {
  const blob = new Blob([input], { type: 'application/json' })
  return compressBlob(blob)
}

/**
 * Decompress a gzip Blob to string.
 */
export async function decompressToString(input: Blob): Promise<string> {
  const decompressed = await decompressBlob(input)
  return decompressed.text()
}
