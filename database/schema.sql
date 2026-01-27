-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Assets table
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  duration REAL,
  metadata TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chapters table
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chapter assets (many-to-many relationship)
CREATE TABLE IF NOT EXISTS chapter_assets (
  chapter_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  PRIMARY KEY (chapter_id, asset_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Beats table
CREATE TABLE IF NOT EXISTS beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  role TEXT NOT NULL,
  why_essential TEXT,
  visual_dependency TEXT,
  is_essential BOOLEAN DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Agent conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_chapters_project_id ON chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_chapter_assets_chapter_id ON chapter_assets(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_assets_asset_id ON chapter_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_chapter_id ON transcripts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_start_time ON transcripts(start_time);
CREATE INDEX IF NOT EXISTS idx_beats_chapter_id ON beats(chapter_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
