import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  fetchMock.mockReset()
})

async function getProvider() {
  await import('./geminiProvider')
  const { getImageProvider } = await import('./index')
  const provider = getImageProvider('gemini')
  if (!provider) throw new Error('gemini provider not registered')
  return provider
}

function fakeOkResponse(b64 = 'AAA=') {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => '',
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ inlineData: { data: b64, mimeType: 'image/png' } }],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100 },
    }),
  } as unknown as Response
}

describe('geminiImageProvider — REST direct', () => {
  it('calls the REST endpoint with the correct URL and api key header', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('fake-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends imageConfig.imageSize at 4K in generationConfig (the SDK-bug bypass)', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key', undefined, { imageSize: '4K', aspectRatio: '16:9' })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: '4K', aspectRatio: '16:9' })
  })

  it('maps imageSize "0.5K" to "512" before sending', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { imageSize: '0.5K' })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.imageConfig.imageSize).toBe('512')
  })

  it('includes thinkingConfig HIGH for Flash by default', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'high',
    })
  })

  it('omits thinkingConfig when options.thinking === false on Flash', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { thinking: false })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.thinkingConfig).toBeUndefined()
  })

  it('omits thinkingConfig at imageSize 4K on Flash to avoid silent res degradation', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { imageSize: '4K', thinking: true })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.thinkingConfig).toBeUndefined()
    expect(body.generationConfig.imageConfig.imageSize).toBe('4K')
  })

  it('omits thinkingConfig at imageSize 2K on Flash to avoid silent res degradation', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { imageSize: '2K', thinking: true })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.thinkingConfig).toBeUndefined()
    expect(body.generationConfig.imageConfig.imageSize).toBe('2K')
  })

  it('keeps thinkingConfig at imageSize 1K on Flash', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3.1-flash-image-preview', 'fake-key', undefined, { imageSize: '1K', thinking: true })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'high',
    })
  })

  it('omits thinkingConfig for Pro Image regardless of options', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.generationConfig.thinkingConfig).toBeUndefined()
  })

  it('includes googleSearch tool when useGrounding=true', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse())
    const provider = await getProvider()
    await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key', undefined, { useGrounding: true })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.tools).toEqual([{
      googleSearch: {
        searchTypes: { webSearch: {}, imageSearch: {} },
      },
    }])
  })

  it('returns the b64 image and usage on success', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse('TEST_B64'))
    const provider = await getProvider()
    const result = await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key')
    expect(result.image_b64).toBe('TEST_B64')
    expect(result.status).toBe('OK')
    expect(result.usage).toBeDefined()
    expect(result.usage?.input_tokens).toBe(10)
    expect(result.usage?.output_tokens).toBe(100)
  })

  it('surfaces Google error message on !ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { message: 'Deadline expired before operation could complete.' } }),
    } as unknown as Response)
    const provider = await getProvider()
    const result = await provider.generateImage('hello', 'gemini-3-pro-image-preview', 'fake-key')
    expect(result.image_b64).toBeNull()
    expect(result.status).toContain('Deadline expired')
  })
})

describe('resolveModel — migration aliases (2026-05-14)', () => {
  it('maps the display name "Gemini 3.1 Flash-Lite" to the GA id', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('Gemini 3.1 Flash-Lite')).toBe('gemini-3.1-flash-lite')
  })

  it('migrates the legacy preview id to the GA id (saved canvases)', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('gemini-3.1-flash-lite-preview')).toBe('gemini-3.1-flash-lite')
  })

  it('migrates the legacy preview :thinking id to the GA :thinking id', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('gemini-3.1-flash-lite-preview:thinking')).toBe('gemini-3.1-flash-lite:thinking')
  })

  it('passes the GA id through unchanged', async () => {
    const { resolveModel } = await import('./geminiProvider')
    expect(resolveModel('gemini-3.1-flash-lite')).toBe('gemini-3.1-flash-lite')
  })
})
