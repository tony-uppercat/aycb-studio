/** Central registry of all localStorage keys used by AYCB. */
export const STORAGE_KEYS = {
  // Settings & API config
  SETTINGS: 'aycb_settings',

  // UI state — Zustand persist name
  UI_STATE: 'aycb_ui',

  // Feedback panel
  FEEDBACK: 'aycb_feedback',
  FEEDBACK_WIDTH: 'aycb_fb_width',

  // Console panel height
  CONSOLE_HEIGHT: 'aycb_console_height',

  // Workflow presets
  PRESETS: 'aycb_presets',

  // User-defined node templates
  USER_TEMPLATES: 'aycb_user_templates',

  // Canvas (legacy — used during IDB migration, then removed)
  CANVAS: 'aycb_canvas',

  // Active project — fast-path localStorage cache (source of truth is IDB)
  ACTIVE_PROJECT_ID: 'activeProjectId',
  ACTIVE_PROJECT_NAME: 'activeProjectName',

  // Review Hub bridge — mediaId → stem mapping
  BRIDGE_STEMS: 'aycb_bridge_stems',

  // Media metadata cache (cloud/offline mode fallback)
  MEDIA_META: 'aycb_media_meta',

  // Async batch image-gen job queue
  ASYNC_JOBS: 'aycb_async_jobs',
} as const

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]
