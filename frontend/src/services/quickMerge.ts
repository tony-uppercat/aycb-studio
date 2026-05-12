/**
 * Right-click "Merge" quick action: take a set of selected image
 * nodes, render them into a single merged PNG using the chosen layout,
 * persist to the media store, and hand back the new mediaId.
 *
 * Pure orchestration — no DOM, no React. Caller (FlowCanvas) places
 * the resulting node and handles undo snapshotting.
 */
import { loadMedia, saveMediaForProject, generateMediaId } from '../mediaStore'
import {
  fileToImage,
  renderImageMerge,
  defaultGridColumns,
  type LayoutMode,
} from '../utils/imageMergeRender'

export interface QuickMergeInput {
  /** Ordered list of mediaIds to merge (one per source image node). */
  mediaIds: string[]
  layout: LayoutMode
}

export interface QuickMergeResult {
  /** New mediaId of the merged PNG saved to mediaStore. */
  mediaId: string
}

/**
 * Render and persist the merged image. Returns the new mediaId so the
 * caller can spawn an imageUpload node referencing it. Throws if
 * fewer than 2 images can be loaded — the caller already gates on
 * selection size, so this guard is a defensive backstop.
 */
export async function runQuickMerge({ mediaIds, layout }: QuickMergeInput): Promise<QuickMergeResult> {
  const files: File[] = []
  for (const id of mediaIds) {
    const f = await loadMedia(id)
    if (f) files.push(f)
  }
  if (files.length < 2) {
    throw new Error('Quick merge needs at least 2 loadable images')
  }

  const images = await Promise.all(files.map(fileToImage))
  const blob = await renderImageMerge(images, {
    layout,
    columns: defaultGridColumns(images.length),
    gap: 4,
    bgColor: 'black',
    outputMode: 'auto',
    customW: 0,
    customH: 0,
  })

  const mediaId = generateMediaId()
  const file = new File([blob], `merge-${layout}-${Date.now()}.png`, { type: 'image/png' })
  await saveMediaForProject(mediaId, file)
  return { mediaId }
}
