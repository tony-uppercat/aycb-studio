/** Central registry of all custom DOM events dispatched in AYCB canvas. */
export const CANVAS_EVENTS = {
  /** Split an ImageUpload node into a grid of new nodes. */
  IMAGE_SPLIT_GRID: 'image-split-grid',
  /** Crop a region of an image and create a new node. */
  IMAGE_CROP_AS_NEW: 'image-crop-as-new',
  /** Export all images from a BatchNode as separate nodes. */
  BATCH_EXPORT_IMAGES: 'batch-export-images',
  /** Import a media file from the FullscreenMediaBrowser into the active project. */
  MEDIA_IMPORT_TO_PROJECT: 'media-import-to-project',
  /** Trigger a manual canvas save (dispatched by SaveIndicator). */
  AYCB_MANUAL_SAVE: 'aycb-manual-save',
  /** Duplicate a specific node by ID (dispatched from ImageUploadNode context menu). */
  DUPLICATE_NODE: 'duplicate-node',
} as const

export type CanvasEventType = typeof CANVAS_EVENTS[keyof typeof CANVAS_EVENTS]
