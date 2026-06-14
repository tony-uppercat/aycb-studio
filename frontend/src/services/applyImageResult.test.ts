import { vi, test, expect, beforeEach } from 'vitest'
import { applyImageResult } from './applyImageResult'

vi.mock('../mediaStore', () => ({
  generateMediaId: () => 'media-123',
  saveMediaForProject: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../utils/reviewStatus', () => ({ saveMediaMeta: vi.fn(), registerBridgeStem: vi.fn() }))
vi.mock('../api', () => ({ bridgeMedia: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => vi.clearAllMocks())

test('applyImageResult saves media and returns the new mediaId', async () => {
  const b64 = 'iVBORw0KGgo='
  const out = await applyImageResult({
    nodeId: 'n1',
    result: { image_b64: b64, status: 'ok', usage: { cost_usd: 0.05 } },
    prompt: 'cat', model: 'gemini-3.1-flash-image-preview', modelName: 'Nano Banana 2',
    resolution: '1K',
  })
  expect(out.mediaId).toBe('media-123')
})

test('applyImageResult uses a provided mediaId', async () => {
  const out = await applyImageResult({
    nodeId: 'n1', mediaId: 'pre-made', result: { image_b64: 'iVBORw0KGgo=', status: 'ok' },
    prompt: 'x', model: 'm', modelName: 'M',
  })
  expect(out.mediaId).toBe('pre-made')
})

test('applyImageResult throws when image_b64 is null', async () => {
  await expect(applyImageResult({
    nodeId: 'n1', result: { image_b64: null, status: 'boom' },
    prompt: 'x', model: 'm', modelName: 'M',
  })).rejects.toThrow('boom')
})
