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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chapters table
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  display_order INTEGER DEFAULT 0,      -- User-defined display order
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

-- Beats table (AI-generated narrative beats)
-- display_order: AI's suggested ordering within the chapter
-- sort_order: User-defined ordering after manual rearrangement
CREATE TABLE IF NOT EXISTS beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  role TEXT NOT NULL,
  why_essential TEXT,
  visual_dependency TEXT,
  is_essential BOOLEAN DEFAULT 1,
  display_order INTEGER DEFAULT 0,      -- Original AI-suggested order
  user_modified BOOLEAN DEFAULT 0,      -- Has user edited this beat?
  discard BOOLEAN DEFAULT 0,            -- Marked for deletion
  sort_order INTEGER,                   -- User-defined sort priority
  clip_id INTEGER,                      -- Linked clip on timeline
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE SET NULL
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

-- Timeline clips (represents cuts/beats on timeline)
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  track_index INTEGER DEFAULT 0,
  start_time REAL NOT NULL,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  role TEXT CHECK(role IN ('setup', 'escalation', 'twist', 'payoff', 'transition')),
  description TEXT,
  is_essential BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Timeline view state
CREATE TABLE IF NOT EXISTS timeline_state (
  project_id INTEGER PRIMARY KEY,
  zoom_level REAL DEFAULT 100.0,
  scroll_position REAL DEFAULT 0.0,
  playhead_time REAL DEFAULT 0.0,
  selected_clip_ids TEXT,  -- JSON array
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Multi-tier waveform cache
CREATE TABLE IF NOT EXISTS waveform_cache (
  asset_id INTEGER,
  track_index INTEGER DEFAULT 0,
  tier_level INTEGER CHECK(tier_level IN (1, 2, 3)),
  peaks BLOB NOT NULL,     -- JSON array of min/max pairs
  sample_rate INTEGER NOT NULL,
  duration REAL NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, track_index, tier_level),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Proxy videos for AI analysis (640px, 5fps)
CREATE TABLE IF NOT EXISTS proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  preset TEXT NOT NULL CHECK(preset IN ('ai_analysis')),
  width INTEGER,
  height INTEGER,
  framerate INTEGER,
  file_size INTEGER,
  duration REAL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- AI cut suggestions (pending user approval)
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  description TEXT,
  reasoning TEXT,  -- Why AI suggested this
  provider TEXT,   -- 'gemini' or 'kimi'
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME,
  clip_id INTEGER, -- Linked clip on timeline when applied
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_chapters_project_id ON chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_chapters_display_order ON chapters(display_order);
CREATE INDEX IF NOT EXISTS idx_chapter_assets_chapter_id ON chapter_assets(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_assets_asset_id ON chapter_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_chapter_id ON transcripts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_start_time ON transcripts(start_time);
CREATE INDEX IF NOT EXISTS idx_beats_chapter_id ON beats(chapter_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_clips_project_id ON clips(project_id);
CREATE INDEX IF NOT EXISTS idx_clips_asset_id ON clips(asset_id);
CREATE INDEX IF NOT EXISTS idx_clips_track_index ON clips(track_index);
CREATE INDEX IF NOT EXISTS idx_waveform_cache_asset_id ON waveform_cache(asset_id);
CREATE INDEX IF NOT EXISTS idx_proxies_asset_id ON proxies(asset_id);
CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_chapter_id ON suggestions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_provider ON suggestions(provider);
