import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('generate-image manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('generateImage')
    expect(manifest.label).toBe('Generate Image')
    expect(manifest.category).toBe('media-model')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(2)
    expect(manifest.inputs[0]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.inputs[1]).toEqual({ type: 'image', handleId: 'image-0' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'image', handleId: 'image-out' })
  })

  it('has defaultData with model', () => {
    expect(manifest.defaultData.selectedModel).toBe('gpt-image-2')
    expect(manifest.defaultData.resolution).toBe('Draft')
    expect(manifest.defaultData.prompt).toBe('')
  })
})

describe('generate-image node integration', () => {
  it('exposes thinking and setThinking from the hook', async () => {
    // Sanity check that the useGenerateImage return shape contains the new fields.
    const mod = await import('./useGenerateImage')
    const hookFnSource = mod.useGenerateImage.toString()
    expect(hookFnSource).toContain('thinking')
    expect(hookFnSource).toContain('setThinking')
  })

  it('RESOLUTIONS includes 0.5K', async () => {
    const { RESOLUTIONS } = await import('./useGenerateImage')
    expect(RESOLUTIONS.some(r => r.value === '0.5K')).toBe(true)
  })
})

describe('planRun — async batch only for a standalone ×1 run', () => {
  const base = { asyncGen: true, asyncCapable: true, inChain: false, batchCount: 1, alreadyPending: false }

  it('async for a standalone, capable, single run with nothing pending', async () => {
    const { planRun } = await import('./useGenerateImage')
    expect(planRun(base)).toBe('async')
  })

  it('sync when async off or model not capable', async () => {
    const { planRun } = await import('./useGenerateImage')
    expect(planRun({ ...base, asyncGen: false })).toBe('sync')
    expect(planRun({ ...base, asyncCapable: false })).toBe('sync')
  })

  it('sync inside a chain run — downstream must not consume stale input (C1)', async () => {
    const { planRun } = await import('./useGenerateImage')
    expect(planRun({ ...base, inChain: true })).toBe('sync')
  })

  it('sync when batchCount > 1 — N async requests would collapse to 1 image (H2)', async () => {
    const { planRun } = await import('./useGenerateImage')
    expect(planRun({ ...base, batchCount: 4 })).toBe('sync')
  })

  it('skip when an async batch for this node is already in flight (H1, no double-submit)', async () => {
    const { planRun } = await import('./useGenerateImage')
    expect(planRun({ ...base, alreadyPending: true })).toBe('skip')
    // but a pending node still runs SYNC inside a chain (sync never double-submits a paid batch)
    expect(planRun({ ...base, alreadyPending: true, inChain: true })).toBe('sync')
  })

  it('runSingle wires planRun to the chain flag', async () => {
    const src = (await import('./useGenerateImage')).useGenerateImage.toString()
    expect(src).toContain('planRun')
    expect(src).toContain('isChainRunning')
  })
})
