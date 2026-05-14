import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockGenerateContent: ReturnType<typeof vi.fn>

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    this.models = { generateContent: mockGenerateContent }
  }),
}))

// Must import after mock is set up
import type { ImageProvider } from './index'

beforeEach(() => {
  mockGenerateContent = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
})

function fakeImageResponse() {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: 'AAA=', mimeType: 'image/png' } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100 },
  }
}

// Import the provider after mocks are set up
let provider: ImageProvider | undefined

beforeEach(async () => {
  const mod = await import('./geminiProvider')
  // Extract provider from the module (it's registered, we need to get it)
  const { getImageProvider } = await import('./index')
  provider = getImageProvider('gemini')
  if (!provider) {
    throw new Error('gemini provider not registered')
  }
})

describe('geminiImageProvider', () => {
  it('includes thinkingConfig HIGH by default', async () => {
    mockGenerateContent.mockResolvedValue(fakeImageResponse())
    if (!provider) throw new Error('provider not initialized')
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key')
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'HIGH',
    })
  })

  it('omits thinkingConfig when options.thinking === false', async () => {
    mockGenerateContent.mockResolvedValue(fakeImageResponse())
    if (!provider) throw new Error('provider not initialized')
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { thinking: false })
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toBeUndefined()
  })

  it('omits thinkingConfig for Pro Image regardless of options', async () => {
    mockGenerateContent.mockResolvedValue(fakeImageResponse())
    if (!provider) throw new Error('provider not initialized')
    // Pro Image has auto-thinking; we must not send thinkingConfig.
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key')
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toBeUndefined()
  })

  it('maps imageSize "0.5K" to "512" in the SDK config', async () => {
    mockGenerateContent.mockResolvedValue(fakeImageResponse())
    if (!provider) throw new Error('provider not initialized')
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { imageSize: '0.5K' })
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.imageConfig.imageSize).toBe('512')
  })

  it('passes imageSize "4K" through unchanged', async () => {
    mockGenerateContent.mockResolvedValue(fakeImageResponse())
    if (!provider) throw new Error('provider not initialized')
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key', undefined, { imageSize: '4K' })
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.imageConfig.imageSize).toBe('4K')
  })
})
