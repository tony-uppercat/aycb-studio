import { describe, it, expect } from 'vitest'
import { readPngTextChunks } from './pngMeta'

/** Build a minimal PNG with tEXt chunks for testing. */
function buildPngWithText(chunks: Record<string, string>): Blob {
  const parts: Uint8Array[] = []

  // PNG signature
  parts.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  // IHDR chunk (13 bytes of dummy data)
  const ihdrData = new Uint8Array(13)
  parts.push(makeChunk('IHDR', ihdrData))

  // tEXt chunks
  for (const [key, value] of Object.entries(chunks)) {
    const encoder = new TextEncoder()
    const keyBytes = encoder.encode(key)
    const valBytes = encoder.encode(value)
    const data = new Uint8Array(keyBytes.length + 1 + valBytes.length)
    data.set(keyBytes, 0)
    data[keyBytes.length] = 0 // null separator
    data.set(valBytes, keyBytes.length + 1)
    parts.push(makeChunk('tEXt', data))
  }

  // IEND chunk
  parts.push(makeChunk('IEND', new Uint8Array(0)))

  return new Blob(parts)
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i)
  chunk.set(data, 8)
  // CRC placeholder (4 bytes of zeros — parser doesn't validate CRC)
  return chunk
}

describe('readPngTextChunks', () => {
  it('reads tEXt chunks from a valid PNG', async () => {
    const blob = buildPngWithText({ prompt: 'a cat', model: 'gemini-2' })
    const result = await readPngTextChunks(blob)
    expect(result.prompt).toBe('a cat')
    expect(result.model).toBe('gemini-2')
  })

  it('returns empty object for non-PNG file', async () => {
    const blob = new Blob(['not a png'], { type: 'text/plain' })
    const result = await readPngTextChunks(blob)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('returns empty object for PNG without tEXt chunks', async () => {
    const parts: Uint8Array[] = []
    parts.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    parts.push(makeChunk('IHDR', new Uint8Array(13)))
    parts.push(makeChunk('IEND', new Uint8Array(0)))
    const blob = new Blob(parts)
    const result = await readPngTextChunks(blob)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('handles multi-line prompt values', async () => {
    const prompt = 'line one\r\nline two\r\nline three'
    const blob = buildPngWithText({ prompt, source: 'aycb' })
    const result = await readPngTextChunks(blob)
    expect(result.prompt).toBe(prompt)
    expect(result.source).toBe('aycb')
  })

  it('handles empty blob', async () => {
    const blob = new Blob([])
    const result = await readPngTextChunks(blob)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('reads iTXt chunks (UTF-8 text)', async () => {
    const parts: Uint8Array[] = []
    parts.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    parts.push(makeChunk('IHDR', new Uint8Array(13)))

    // Build iTXt chunk: keyword\0 comprFlag(0) comprMethod(0) lang\0 transKeyword\0 text
    const encoder = new TextEncoder()
    const key = encoder.encode('prompt')
    const text = encoder.encode('a long prompt with unicode: caf\u00e9')
    // key + \0 + comprFlag(0) + comprMethod(0) + lang\0 + transKeyword\0 + text
    const data = new Uint8Array(key.length + 1 + 2 + 1 + 1 + text.length)
    data.set(key, 0)
    data[key.length] = 0     // null after keyword
    data[key.length + 1] = 0 // compression flag = 0 (uncompressed)
    data[key.length + 2] = 0 // compression method = 0
    data[key.length + 3] = 0 // empty language tag (null-terminated)
    data[key.length + 4] = 0 // empty translated keyword (null-terminated)
    data.set(text, key.length + 5)
    parts.push(makeChunk('iTXt', data))

    parts.push(makeChunk('IEND', new Uint8Array(0)))
    const blob = new Blob(parts)
    const result = await readPngTextChunks(blob)
    expect(result.prompt).toBe('a long prompt with unicode: caf\u00e9')
  })

  it('reads mixed tEXt and iTXt chunks', async () => {
    const parts: Uint8Array[] = []
    parts.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    parts.push(makeChunk('IHDR', new Uint8Array(13)))

    // tEXt chunk for model
    const enc = new TextEncoder()
    const modelKey = enc.encode('model')
    const modelVal = enc.encode('gemini-3')
    const tData = new Uint8Array(modelKey.length + 1 + modelVal.length)
    tData.set(modelKey, 0)
    tData[modelKey.length] = 0
    tData.set(modelVal, modelKey.length + 1)
    parts.push(makeChunk('tEXt', tData))

    // iTXt chunk for prompt
    const pKey = enc.encode('prompt')
    const pText = enc.encode('test prompt')
    const iData = new Uint8Array(pKey.length + 5 + pText.length)
    iData.set(pKey, 0)
    iData[pKey.length] = 0
    iData[pKey.length + 1] = 0
    iData[pKey.length + 2] = 0
    iData[pKey.length + 3] = 0
    iData[pKey.length + 4] = 0
    iData.set(pText, pKey.length + 5)
    parts.push(makeChunk('iTXt', iData))

    parts.push(makeChunk('IEND', new Uint8Array(0)))
    const blob = new Blob(parts)
    const result = await readPngTextChunks(blob)
    expect(result.model).toBe('gemini-3')
    expect(result.prompt).toBe('test prompt')
  })
})
