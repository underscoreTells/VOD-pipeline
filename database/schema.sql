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
  rough_cut_completed_at DATETIME,
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

-- Recoverable chapter ranges created while cutting a full VOD
CREATE TABLE IF NOT EXISTS vod_cut_drafts (
  project_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  ranges_json TEXT NOT NULL,
  view_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, asset_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  words_json TEXT,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Detailed transcript windows (high precision, generated on demand)
CREATE TABLE IF NOT EXISTS detailed_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  window_start REAL NOT NULL,
  window_end REAL NOT NULL,
  model TEXT NOT NULL,
  compute_type TEXT NOT NULL,
  word_timestamps BOOLEAN DEFAULT 0,
  text TEXT NOT NULL,
  segments_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  UNIQUE(chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps)
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

-- Persistent chapter-locked conversations (multiple per chapter)
CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  reasoning_effort TEXT,
  thread_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  thinking_markdown TEXT,
  trace_json TEXT,
  mentions_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- Timeline clips (represents cuts/beats on timeline)
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  track_index INTEGER DEFAULT 0,
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

-- Chapter-trimmed proxy videos for visual analysis
CREATE TABLE IF NOT EXISTS chapter_proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  preset TEXT NOT NULL CHECK(preset IN ('ai_analysis_chapter')),
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  width INTEGER,
  height INTEGER,
  framerate INTEGER,
  file_size INTEGER,
  duration REAL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  UNIQUE(chapter_id, asset_id, preset)
);

-- AI cut suggestions (pending user approval)
--   clip_id           linked clip on the timeline; for 'applied' rows this is the
--                     committed clip; for 'pending' rows (preview state) this is
--                     the transient preview clip (create_clip) or the in-place
--                     edited target clip (update_clip).
--   preview_snapshot_json  for 'pending' update_clip previews, the pre-preview
--                     snapshot of the target clip used to undo the preview.
--                     Cleared on apply/cancel/reject. Both columns are retained
--                     on the schema for the v3 preview reconciliation migration.
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  conversation_id INTEGER,
  chat_message_id INTEGER,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  description TEXT,
  reasoning TEXT,  -- Why AI suggested this
  provider TEXT,   -- 'gemini' or 'kimi'
  action_type TEXT DEFAULT 'create_clip' CHECK(action_type IN ('create_clip', 'update_clip', 'delete_clip', 'split_clip')),
  target_clip_id INTEGER,
  action_payload_json TEXT,
  preview_snapshot_json TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected', 'superseded')),
  supersedes_suggestion_id INTEGER,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME,
  clip_id INTEGER, -- Linked clip on timeline when applied
  range_space TEXT, -- NULL until the v5 migration classifies the row; 'chapter_local' afterwards
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (target_clip_id) REFERENCES clips(id) ON DELETE SET NULL,
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE SET NULL,
  FOREIGN KEY (supersedes_suggestion_id) REFERENCES suggestions(id) ON DELETE SET NULL
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
CREATE INDEX IF NOT EXISTS idx_detailed_transcripts_chapter_id ON detailed_transcripts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_detailed_transcripts_window ON detailed_transcripts(chapter_id, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_beats_chapter_id ON beats(chapter_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_project_chapter ON chat_conversations(project_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_conversation_id ON suggestions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_chat_message_id ON suggestions(chat_message_id);
CREATE INDEX IF NOT EXISTS idx_clips_project_id ON clips(project_id);
CREATE INDEX IF NOT EXISTS idx_clips_asset_id ON clips(asset_id);
CREATE INDEX IF NOT EXISTS idx_clips_track_index ON clips(track_index);
CREATE INDEX IF NOT EXISTS idx_waveform_cache_asset_id ON waveform_cache(asset_id);
CREATE INDEX IF NOT EXISTS idx_chapter_proxies_chapter_asset ON chapter_proxies(chapter_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_chapter_proxies_status ON chapter_proxies(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_chapter_id ON suggestions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_provider ON suggestions(provider);
