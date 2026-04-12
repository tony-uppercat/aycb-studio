/**
 * Read PNG tEXt and iTXt chunks from a File/Blob in the browser.
 * Returns a key→value map of all text metadata found.
 *
 * PNG spec: each chunk is [4-byte length][4-byte type][data][4-byte CRC].
 * tEXt: "keyword\0value" (Latin-1 encoded).
 * iTXt: "keyword\0 compressionFlag(1) compressionMethod(1) langTag\0 translatedKeyword\0 text" (UTF-8).
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export async function readPngTextChunks(file: Blob): Promise<Record<string, string>> {
  const buf = await file.arrayBuffer()
  const view = new DataView(buf)
  const result: Record<string, string> = {}

  // Verify PNG signature (need at least 8 bytes)
  if (buf.byteLength < 8) return result
  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) return result
  }

  let offset = 8
  const latin1 = new TextDecoder('latin1')
  const utf8 = new TextDecoder('utf-8')

  while (offset + 12 <= buf.byteLength) {
    const chunkLen = view.getUint32(offset)
    const typeBytes = new Uint8Array(buf, offset + 4, 4)
    const type = String.fromCharCode(...typeBytes)

    if (type === 'IEND') break

    if (type === 'tEXt' && chunkLen > 0) {
      const data = new Uint8Array(buf, offset + 8, chunkLen)
      const nullIdx = data.indexOf(0)
      if (nullIdx > 0) {
        const key = latin1.decode(data.subarray(0, nullIdx))
        const value = latin1.decode(data.subarray(nullIdx + 1))
        result[key] = value
      }
    }

    if (type === 'iTXt' && chunkLen > 0) {
      const data = new Uint8Array(buf, offset + 8, chunkLen)
      const keyEnd = data.indexOf(0)
      if (keyEnd > 0) {
        const key = utf8.decode(data.subarray(0, keyEnd))
        // Skip: compressionFlag(1) + compressionMethod(1)
        let pos = keyEnd + 3
        // Skip language tag (null-terminated)
        const langEnd = data.indexOf(0, pos)
        if (langEnd >= pos) pos = langEnd + 1
        // Skip translated keyword (null-terminated)
        const transEnd = data.indexOf(0, pos)
        if (transEnd >= pos) pos = transEnd + 1
        // Remaining bytes are the UTF-8 text value
        result[key] = utf8.decode(data.subarray(pos))
      }
    }

    // Skip to next chunk: 4 (length) + 4 (type) + chunkLen (data) + 4 (CRC)
    offset += 12 + chunkLen
  }

  return result
}
