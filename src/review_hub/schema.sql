PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT,
    directory TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    thumbnail_path TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    author TEXT,
    content TEXT,
    x_position REAL,
    y_position REAL,
    annotation_type TEXT DEFAULT 'pin',
    box_width REAL,
    box_height REAL,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    status TEXT DEFAULT 'favorite',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(media_id, user_name),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    author TEXT,
    strokes_json TEXT,
    thumbnail_data TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS [references] (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_path TEXT,
    processed_path TEXT,
    thumbnail_path TEXT,
    uploaded_by TEXT,
    tags TEXT,
    notes TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'bug',
    author TEXT,
    urgent INTEGER DEFAULT 0,
    resolved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT,
    device TEXT,
    socket_id TEXT,
    connected_at TEXT DEFAULT (datetime('now')),
    disconnected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_directory ON media(directory);
CREATE INDEX IF NOT EXISTS idx_media_filename ON media(filename);
CREATE INDEX IF NOT EXISTS idx_comments_media_id ON comments(media_id);
CREATE INDEX IF NOT EXISTS idx_favorites_media_id ON favorites(media_id);
CREATE INDEX IF NOT EXISTS idx_drawings_media_id ON drawings(media_id);
CREATE INDEX IF NOT EXISTS idx_references_uploaded_by ON [references](uploaded_by);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT,
    directory TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    thumbnail_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_directory ON assets(directory);
CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(filename);

CREATE TABLE IF NOT EXISTS media_asset_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    directory TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(media_id, directory),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_asset_links_media ON media_asset_links(media_id);
CREATE INDEX IF NOT EXISTS idx_media_asset_links_dir ON media_asset_links(directory);
