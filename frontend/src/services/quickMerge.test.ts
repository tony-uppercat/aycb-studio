import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be declared before importing the module under test.
vi.mock('../mediaStore', () => ({
  loadMedia: vi.fn(),
  saveMediaForProject: vi.fn(),
  generateMediaId: vi.fn(() => 'media-test-1234'),
}))

vi.mock('../utils/imageMergeRender', async () => {
  const actual = await vi.importActual<typeof import('../utils/imageMergeRender')>('../utils/imageMergeRender')
  return {
    ...actual,
    fileToImage: vi.fn(async () => ({ naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement)),
    renderImageMerge: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
  }
})

import { runQuickMerge } from './quickMerge'
import { loadMedia, saveMediaForProject } from '../mediaStore'
import { renderImageMerge } from '../utils/imageMergeRender'

const mockLoadMedia = loadMedia as ReturnType<typeof vi.fn>
const mockSaveMedia = saveMediaForProject as ReturnType<typeof vi.fn>
const mockRender = renderImageMerge as ReturnType<typeof vi.fn>

function fakeFile(name: string): File {
  return new File([new Uint8Array([0])], name, { type: 'image/png' })
}

describe('runQuickMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadMedia.mockReset()
    mockSaveMedia.mockReset()
  })

  it('renders, persists, and returns the new mediaId', async () => {
    mockLoadMedia
      .mockResolvedValueOnce(fakeFile('a.png'))
      .mockResolvedValueOnce(fakeFile('b.png'))
    mockSaveMedia.mockResolvedValue(undefined)

    const result = await runQuickMerge({
      mediaIds: ['m-a', 'm-b'],
      layout: 'grid',
    })

    expect(result.mediaId).toBe('media-test-1234')
    expect(mockRender).toHaveBeenCalledTimes(1)
    expect(mockRender.mock.calls[0][1].layout).toBe('grid')
    expect(mockRender.mock.calls[0][1].columns).toBeGreaterThanOrEqual(1)
    expect(mockSaveMedia).toHaveBeenCalledTimes(1)
    const [savedId, savedFile] = mockSaveMedia.mock.calls[0]
    expect(savedId).toBe('media-test-1234')
    expect(savedFile).toBeInstanceOf(File)
    expect((savedFile as File).type).toBe('image/png')
    expect((savedFile as File).name).toMatch(/^merge-grid-/)
  })

  it('forwards horizontal/vertical layout choices', async () => {
    mockLoadMedia
      .mockResolvedValueOnce(fakeFile('a.png'))
      .mockResolvedValueOnce(fakeFile('b.png'))
    mockSaveMedia.mockResolvedValue(undefined)

    await runQuickMerge({ mediaIds: ['m-a', 'm-b'], layout: 'horizontal' })
    expect(mockRender.mock.calls.at(-1)?.[1].layout).toBe('horizontal')

    mockLoadMedia
      .mockResolvedValueOnce(fakeFile('a.png'))
      .mockResolvedValueOnce(fakeFile('b.png'))
    await runQuickMerge({ mediaIds: ['m-a', 'm-b'], layout: 'vertical' })
    expect(mockRender.mock.calls.at(-1)?.[1].layout).toBe('vertical')
  })

  it('throws when fewer than 2 images can be loaded', async () => {
    mockLoadMedia
      .mockResolvedValueOnce(fakeFile('only.png'))
      .mockResolvedValueOnce(null)

    await expect(
      runQuickMerge({ mediaIds: ['m-a', 'm-missing'], layout: 'grid' }),
    ).rejects.toThrow(/at least 2/)
    expect(mockRender).not.toHaveBeenCalled()
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('skips missing mediaIds and proceeds when 2+ remain', async () => {
    mockLoadMedia
      .mockResolvedValueOnce(fakeFile('a.png'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeFile('c.png'))
    mockSaveMedia.mockResolvedValue(undefined)

    const result = await runQuickMerge({
      mediaIds: ['m-a', 'm-missing', 'm-c'],
      layout: 'grid',
    })
    expect(result.mediaId).toBe('media-test-1234')
    expect(mockRender).toHaveBeenCalledTimes(1)
  })
})
