# Phase 3b: Timeline Editor

**Timeline**: 8-10 weeks  
**Status**: Ready to implement  
**Dependencies**: Phase 3a (Core Video Processing) complete  

## Overview

Build a professional timeline editor using wavesurfer.js v7 with TypeScript. Features multi-track audio display, high-resolution waveforms, advanced clip editing, and NLE export compatibility.

## Technical Stack

- **Waveform Rendering**: wavesurfer.js v7 with Regions, Timeline, Zoom plugins
- **State Management**: Svelte 5 runes API (`.svelte.ts` files)
- **Undo/Redo**: Command pattern with persistent command history
- **Exports**: FCPXML (Final Cut Pro/DaVinci), JSON, EDL

## Waveform Resolution Strategy

Professional DAW-style multi-tier approach:

### Tier 1 - Overview (Always Cached)
- **Ratio**: 256:1 from original audio
- **Resolution**: 44.1kHz audio → 172 samples/sec (5.8ms precision)
- **Storage**: ~5MB for 8-hour video
- **Use**: Initial zoomed-out view, navigation

### Tier 2 - Standard Edit (Cached Per Project)
- **Ratio**: 16:1 from original audio
- **Resolution**: 44.1kHz audio → 2,756 samples/sec (0.36ms precision)
- **Storage**: ~80MB for 8-hour video
- **Use**: Normal editing, cuts, beat placement

### Tier 3 - Fine Edit (On-Demand)
- **Ratio**: 4:1 from original audio
- **Resolution**: 44.1kHz audio → 11,025 samples/sec (0.09ms precision)
- **Storage**: Memory-only, generated when zoom > 200px/sec
- **Use**: Precise cuts, frame-accurate trimming
- **Cleanup**: Discarded when zooming out

### Performance Targets
- **Generation**: ~7 seconds for 8-hour video (background thread)
- **Timeline scroll**: 60 FPS sustained
- **Zoom response**: <16ms
- **Memory**: <200MB for 8-hour project with all tiers

## Task Breakdown

### Task 3.8: Timeline Core (Weeks 1-3)

#### 3.8.1: Install Dependencies
Install wavesurfer.js v7 with proper TypeScript support:
- Package: `wavesurfer.js`
- Plugins: Regions, Timeline, Zoom (included in main package)
- Import pattern: `import WaveSurfer from 'wavesurfer.js'`

**Milestone**: Package installed, TypeScript imports working

---

#### 3.8.2: Database Schema Updates
Extend database schema with timeline-specific tables:

**New Tables**:
1. **clips** - Timeline clips with track assignment
   - id, project_id, asset_id, track_index
   - start_time (timeline position), in_point, out_point
   - role (setup/escalation/twist/payoff/transition)
   - description, is_essential, created_at

2. **timeline_state** - View state per project
   - project_id, zoom_level (px/sec), scroll_position (sec)
   - playhead_time (sec), selected_clip_ids (JSON array)

3. **waveform_cache** - Tiered waveform storage
   - asset_id, track_index, tier_level (1/2/3)
   - peaks (JSON array), sample_rate, duration
   - generated_at

4. **Modify beats table** - Link AI beats to clips
   - Add: user_modified, discard, sort_order, clip_id

**Milestone**: Schema migrations run successfully

---

#### 3.8.3: Multi-Tier Waveform Generator
Create `src/pipeline/waveform.ts`:

**Core Functions**:
- `generateWaveformTiers(audioPath, trackIndex)` - Generates all 3 tiers
- `generateTier(audioPath, trackIndex, ratio)` - Single tier generation
- `saveWaveformToDB(assetId, trackIndex, tier, peaks)` - Persistent storage
- `loadWaveformFromDB(assetId, trackIndex, tier)` - Retrieval

**FFmpeg Strategy**:
- Extract audio to raw PCM (mono, 16-bit) per track
- Process in chunks for memory efficiency
- Calculate min/max pairs over N-sample windows
- Tier 1: window=256 samples → 172 px/sec
- Tier 2: window=16 samples → 2,756 px/sec
- Tier 3: window=4 samples → 11,025 px/sec (on-demand only)

**Background Processing**:
- Spawn FFmpeg in separate thread/process
- Stream progress to renderer
- Cache Tier 1+2 immediately, Tier 3 on-demand

**Milestone**: Can generate and store all 3 waveform tiers

---

#### 3.8.4: Database Layer - Timeline Operations
Extend `src/electron/database/db.ts`:

**Clip Operations**:
- `createClip(clipData)` - Insert new clip
- `getClipsByProject(projectId)` - List all clips sorted by track/time
- `getClipsByAsset(assetId)` - Clips using specific asset
- `updateClip(id, updates)` - Modify position, in/out points, metadata
- `deleteClip(id)` - Remove clip
- `batchUpdateClips(updates[])` - Batch update for undo/ripple operations

**Timeline State Operations**:
- `saveTimelineState(state)` - Persist view state
- `loadTimelineState(projectId)` - Restore view state
- `updateTimelineState(projectId, partialUpdates)` - Incremental updates

**Waveform Cache Operations**:
- `getWaveform(assetId, trackIndex, tier)` - Load peaks
- `saveWaveform(assetId, trackIndex, tier, peaks)` - Store peaks
- `checkWaveformExists(assetId, trackIndex, tier)` - Cache validation

**Milestone**: Full database layer with tests

---

#### 3.8.5: IPC Channels & Handlers
Create timeline-specific IPC channels:

**Clip Channels**:
- `CLIP_CREATE` - Create new clip
- `CLIP_GET_BY_PROJECT` - Get all project clips
- `CLIP_GET_BY_ASSET` - Get clips for asset
- `CLIP_UPDATE` - Update clip properties
- `CLIP_DELETE` - Delete clip
- `CLIP_BATCH_UPDATE` - Batch updates

**Timeline State Channels**:
- `TIMELINE_STATE_SAVE` - Save view state
- `TIMELINE_STATE_LOAD` - Load view state

**Waveform Channels**:
- `WAVEFORM_GENERATE` - Generate all tiers (background)
- `WAVEFORM_GET` - Load specific tier
- `WAVEFORM_GENERATE_TIER` - On-demand Tier 3 generation

**Export Channels**:
- `EXPORT_GENERATE` - Generate export file
- `EXPORT_GET_FORMATS` - List available formats

**Handler Pattern**:
All handlers return `{ success: boolean, data?: any, error?: string }`

**Milestone**: All IPC handlers implemented and tested

---

#### 3.8.6: Timeline State Management
Create `src/renderer/lib/state/timeline.svelte.ts`:

**State Structure**:
```typescript
timelineState = {
  projectId: number | null,
  clips: Clip[],
  zoomLevel: number,        // pixels per second
  scrollPosition: number,   // seconds from start
  playheadTime: number,     // current position
  selectedClipIds: Set<number>,
  isPlaying: boolean,
  isLoading: boolean,
  error: string | null
}
```

**Derived State**:
- `selectedClips` - Array of selected clip objects
- `totalDuration` - Project duration from clips
- `clipsByTrack` - Map of track index to clip arrays

**Actions**:
- `loadTimeline(projectId)` - Load project data from database
- `createClip(data)` - Add new clip
- `updateClip(id, updates)` - Modify clip (triggers undo registration)
- `deleteClip(id)` - Remove clip
- `selectClip(id, multiSelect)` - Selection management
- `clearSelection()` - Deselect all
- `setPlayhead(time)` - Move playhead
- `setZoom(level)` - Change zoom
- `setScroll(position)` - Scroll timeline
- `togglePlayback()` - Play/pause
- `saveTimelineState()` - Persist view state (debounced)

**Milestone**: State management working with IPC integration

---

#### 3.8.7: Multi-Track WaveSurfer Component
Create `src/renderer/lib/components/Timeline.svelte`:

**Component Architecture**:
- One WaveSurfer instance per audio track
- All instances synced (shared zoom/scroll state)
- Video track placeholder (thumbnails or color bar)
- Track headers with mute/solo/visibility controls

**WaveSurfer Configuration**:
- Container per track (dynamic height)
- Plugins: Regions (for clips), Timeline (time ruler)
- MinPxPerSec bound to `timelineState.zoomLevel`
- Pre-decoded peaks loaded from database

**Region Management**:
- Each clip becomes a region
- Region ID = clip.id
- Drag to move (updates clip.start_time)
- Resize handles (updates clip.in_point/out_point)
- Click to select
- Color coding by role (setup=red, escalation=orange, etc.)

**Event Handling**:
- `region-updated` → Save clip position/bounds
- `region-clicked` → Select clip, prevent propagation
- `timeupdate` → Update playhead state
- `scroll` → Sync other tracks, update scroll state

**Tier Loading Logic**:
- Zoom < 100 px/sec: Use Tier 1 (overview)
- Zoom 100-200 px/sec: Use Tier 2 (standard)
- Zoom > 200 px/sec: Generate/load Tier 3 (fine, on-demand)

**Milestone**: Multi-track timeline displaying clips, zoom/pan working

---

#### 3.8.8: Timeline Toolbar
Create `src/renderer/lib/components/TimelineToolbar.svelte`:

**Controls**:
- Play/Pause button (syncs with all tracks)
- Timecode display (HH:MM:SS:FF at 30fps)
- Zoom slider (10-1000 px/sec, logarithmic)
- Zoom to fit button
- Selection info ("3 clips selected")
- Undo/Redo buttons with descriptions ("Undo move clip")

**Styling**:
- Dark theme matching app
- Compact height (60px)
- Monospace timecode display

**Milestone**: Toolbar functional with all controls

---

### Task 3.9: Undo/Redo System (Week 4)

#### 3.9.1: Command Pattern Implementation
Create `src/renderer/lib/state/undo-redo.svelte.ts`:

**Command Interface**:
- `description` - Human-readable action name
- `execute()` - Perform action
- `undo()` - Reverse action

**Command Types**:
1. **MoveClipCommand** - Change clip start_time
2. **ResizeClipCommand** - Change in/out points
3. **MultiMoveCommand** - Batch move (for ripple edit)
4. **DeleteClipCommand** - Delete with restore capability
5. **CreateClipCommand** - Create with delete capability

**State Management**:
- `undoStack: Command[]` - Up to 50 commands
- `redoStack: Command[]` - Cleared on new action
- `canUndo` / `canRedo` - Derived booleans
- `lastCommandDescription` - For UI display

**Integration**:
- `executeCommand(cmd)` - Execute and push to undo stack
- `undo()` - Pop from undo, execute undo(), push to redo
- `redo()` - Pop from redo, execute(), push to undo
- Auto-save timeline state after undo/redo

**Milestone**: All clip operations support undo/redo

---

#### 3.9.2: Keyboard Shortcuts
Create `src/renderer/lib/state/keyboard.svelte.ts`:

**DaVinci Resolve Inspired Shortcuts**:
- `Space` - Play/Pause
- `←/→` - Nudge playhead 1 frame (33ms at 30fps)
- `Shift + ←/→` - Nudge 10 frames
- `Ctrl+Z` - Undo
- `Ctrl+Shift+Z` or `Ctrl+Y` - Redo
- `Delete` or `Backspace` - Delete selected clips
- `+/-` - Zoom in/out
- `Ctrl+A` - Select all clips
- `Escape` - Deselect all
- `S` - Toggle snapping (when implemented)
- `I/O` - Set in/out points on selected clip
- `F` - Zoom to fit selection
- `?` - Show keyboard shortcut help

**Implementation**:
- Global keydown listener (skip if in input field)
- Prevent default for handled keys
- Async imports to avoid circular dependencies

**Milestone**: All keyboard shortcuts working

---

### Task 3.10: Beat Panel & Preview (Week 5)

#### 3.10.1: Beat/Clip List Panel
Create `src/renderer/lib/components/BeatPanel.svelte`:

**Layout**:
- Width: 300px fixed
- Scrollable list grouped by role
- Each role has colored header

**Features**:
- Group clips by role (setup, escalation, twist, payoff, transition)
- Show count per role
- Display: time range, description, track indicator
- Click clip to: select on timeline, scroll to position, set playhead
- Visual states: selected (highlight), discarded (dimmed), essential (icon)

**Sync**:
- Reactive to `timelineState.clips`
- Updates when clips modified
- Selection synced with timeline

**Milestone**: Beat panel displaying all clips, synced with timeline

---

#### 3.10.2: Clip Preview Component
Create `src/renderer/lib/components/ClipPreview.svelte`:

**Video Player**:
- HTML5 video element
- Shows selected clip only
- Loops within in/out points
- Current time display

**Fine-Tune Controls**:
- In point: time display + nudge buttons (-1 frame, +1 frame)
- Out point: time display + nudge buttons (-1 frame, +1 frame)
- Frame duration: ~33ms at 30fps, ~16.7ms at 60fps
- Loop toggle checkbox

**Clip Info**:
- Duration (calculated)
- Role badge
- Track indicator
- Description (editable?)

**Milestone**: Can preview and frame-accurate trim selected clips

---

### Task 3.11: Export System (Weeks 6-7)

#### 3.11.1: FCPXML Generator
Create `src/pipeline/export/xml.ts`:

**Format**: FCPXML 1.10 (Final Cut Pro X, DaVinci Resolve, Premiere Pro compatible)

**Structure**:
- `<resources>`: Format definition, asset references per track
- `<project>`: Project container
- `<sequence>`: Timeline with frame rate, timecode
- `<spine>`: Linear clip arrangement
- `<clip>` elements: References to assets with offsets, durations

**Per-Clip Data**:
- Asset reference (by track index)
- Timeline offset (start_time)
- Source offset (in_point)
- Duration (out_point - in_point)
- Optional note (description)

**Frame Rates**: Support 23.976, 24, 25, 29.97, 30, 50, 59.94, 60

**Milestone**: Valid FCPXML generated, tested in DaVinci Resolve

---

#### 3.11.2: JSON Export
Create `src/pipeline/export/json.ts`:

**Schema**:
```typescript
{
  version: "1.0",
  projectId: number,
  projectName: string,
  exportedAt: ISO8601,
  frameRate: number,
  totalDuration: seconds,
  clips: [
    {
      id: number,
      assetId: number,
      trackIndex: number,
      role: string,
      startTime: seconds,
      inPoint: seconds,
      outPoint: seconds,
      isEssential: boolean,
      description: string
    }
  ],
  audioTracks: [
    { index: number, sourceFile: string }
  ]
}
```

**Use**: Internal backup, debugging, future import

**Milestone**: JSON export working

---

#### 3.11.3: EDL Export
Create `src/pipeline/export/edl.ts`:

**Format**: CMX 3600 standard
- Title line
- Edit entries: EVENT#, REEL, CHANNEL, TRANSITION, DURATION
- Source timecodes, record timecodes
- Limited metadata (no roles, descriptions)

**Use**: Legacy NLE compatibility (Avid, older systems)

**Milestone**: EDL export working

---

#### 3.11.4: Export Panel
Create `src/renderer/lib/components/ExportPanel.svelte`:

**UI Elements**:
- Format dropdown: FCPXML (recommended), JSON, EDL
- Frame rate dropdown: Auto-detect or manual selection
- Include audio tracks: Checkbox (default: all)
- Export button: Triggers native save dialog
- Progress indicator during generation
- Result display: Success with file path, or error message

**Handler Flow**:
1. User clicks Export
2. Show save dialog (suggest filename based on project)
3. Query clips from database
4. Generate format-specific content
5. Write to selected path
6. Show success/error

**Milestone**: End-to-end export working for all 3 formats

---

### Task 3.12: Testing & Refinement (Weeks 8-10)

#### 3.12.1: Integration Tests
Create test suite in `tests/integration/timeline/`:

**Test Scenarios**:
1. **End-to-End Workflow**:
   - Import 2-hour video with 3 audio tracks
   - Wait for waveform generation
   - Verify all tiers created
   - Create 20 clips from AI beats
   - Edit positions and boundaries
   - Export to FCPXML
   - Import into DaVinci Resolve
   - Verify clip positions match exactly

2. **Performance Test**:
   - Load 8-hour video
   - Verify Tier 1 loads instantly (<100ms)
   - Verify Tier 2 loads in <2 seconds
   - Scroll timeline for 60 seconds
   - Monitor FPS (target: 60)
   - Monitor memory (target: <200MB)

3. **Undo/Redo Test**:
   - Perform 20 operations
   - Undo all 20
   - Redo all 20
   - Verify state matches original
   - Verify database persistence

4. **Multi-Track Sync Test**:
   - Create 5 audio tracks
   - Scroll one track
   - Verify all tracks scroll to same position
   - Zoom one track
   - Verify all tracks zoom equally

**Milestone**: All integration tests passing

---

#### 3.12.2: Performance Optimization
**Targets**:
- Timeline render: 60 FPS sustained
- Waveform generation (8-hour): <10 seconds
- Memory usage: <200MB for large projects
- Zoom response: <16ms

**Optimizations**:
- Use `requestAnimationFrame` for renders
- Debounce scroll events (16ms)
- Lazy load waveforms (Tier 3 only when needed)
- Clear Tier 3 from memory on zoom out
- Dispose WaveSurfer instances when switching projects
- Limit undo history to 50 commands
- Use `OffscreenCanvas` if available

**Profiling**:
- Chrome DevTools Performance tab
- Memory heap snapshots
- Identify and fix memory leaks

**Milestone**: Performance validated with 8-hour test file

---

#### 3.12.3: UI Polish & Error Handling
**Visual Polish**:
- Consistent dark theme across all components
- Smooth transitions (150-300ms)
- Hover states on all interactive elements
- Loading spinners for async operations
- Empty states ("No clips yet", "Select a project")

**Error Handling**:
- Try-catch all IPC calls
- User-friendly error messages (not stack traces)
- Retry logic for waveform generation
- Graceful degradation if database unavailable
- Toast notifications for errors/success

**Accessibility**:
- ARIA labels on interactive elements
- Keyboard-only navigation support
- High contrast mode consideration
- Screen reader compatibility (where feasible)

**Documentation**:
- Keyboard shortcut overlay (press ?)
- Tooltip hints on buttons
- Contextual help in empty states

**Milestone**: UI polished, errors handled gracefully

---

## File Structure

```
src/
├── renderer/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Timeline.svelte              (multi-track wavesurfer)
│   │   │   ├── TimelineToolbar.svelte       (controls)
│   │   │   ├── BeatPanel.svelte             (clip list)
│   │   │   ├── ClipPreview.svelte           (video player)
│   │   │   ├── ExportPanel.svelte           (export UI)
│   │   │   └── KeyboardHelp.svelte          (shortcuts overlay)
│   │   └── state/
│   │       ├── timeline.svelte.ts           (timeline state)
│   │       ├── undo-redo.svelte.ts          (command pattern)
│   │       └── keyboard.svelte.ts           (shortcuts)
├── electron/
│   ├── database/
│   │   └── db.ts                            (clip/timeline CRUD)
│   └── ipc/
│       ├── channels.ts                      (new channels)
│       └── handlers.ts                      (timeline handlers)
├── pipeline/
│   ├── waveform.ts                          (tiered generator)
│   └── export/
│       ├── xml.ts                           (FCPXML)
│       ├── json.ts                          (JSON)
│       └── edl.ts                           (EDL)
├── shared/
│   └── types/
│       └── database.ts                      (Clip, TimelineState types)
└── tests/
    └── integration/
        └── timeline/                        (test suite)

database/
└── schema.sql                               (migration: clips, timeline_state, waveform_cache)
```

## Database Schema Changes

### New Tables

```sql
-- Timeline clips (represents cuts/beats on timeline)
CREATE TABLE clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  track_index INTEGER DEFAULT 0,
  start_time REAL NOT NULL,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  role TEXT CHECK(role IN ('setup', 'escalation', 'twist', 'payoff', 'transition')),
  description TEXT,
  is_essential BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- Timeline view state
CREATE TABLE timeline_state (
  project_id INTEGER PRIMARY KEY,
  zoom_level REAL DEFAULT 100.0,
  scroll_position REAL DEFAULT 0.0,
  playhead_time REAL DEFAULT 0.0,
  selected_clip_ids TEXT,  -- JSON array
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Multi-tier waveform cache
CREATE TABLE waveform_cache (
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

-- Modify beats table
ALTER TABLE beats ADD COLUMN user_modified BOOLEAN DEFAULT FALSE;
ALTER TABLE beats ADD COLUMN discard BOOLEAN DEFAULT FALSE;
ALTER TABLE beats ADD COLUMN sort_order INTEGER;
ALTER TABLE beats ADD COLUMN clip_id INTEGER REFERENCES clips(id);

-- Indexes
CREATE INDEX idx_clips_project_id ON clips(project_id);
CREATE INDEX idx_clips_asset_id ON clips(asset_id);
CREATE INDEX idx_clips_track_index ON clips(track_index);
CREATE INDEX idx_waveform_cache_asset_id ON waveform_cache(asset_id);
```

## Dependencies

```json
{
  "dependencies": {
    "wavesurfer.js": "^7.12.1"
  }
}
```

## Success Criteria

- [ ] Multi-track timeline displays all audio tracks
- [ ] Waveforms render at 60 FPS with 2,756 samples/sec
- [ ] On-demand Tier 3 (11,025 samples/sec) generates in <2 seconds
- [ ] Clip editing (drag, resize) works with visual feedback
- [ ] Undo/redo supports all operations with 50-step history
- [ ] Keyboard shortcuts match DaVinci Resolve conventions
- [ ] FCPXML exports open correctly in DaVinci Resolve
- [ ] 8-hour video timeline maintains 60 FPS
- [ ] All database operations persist correctly
- [ ] UI is responsive and visually polished

## Notes

- **wavesurfer.js v7**: Built-in TypeScript support, no @types needed
- **Multi-tier waveforms**: Industry standard (DAWs use 16:1 and 4:1 ratios)
- **FCPXML**: Most compatible format across NLEs
- **Performance**: Pre-calculation is key, never visualize raw samples
- **Undo/Redo**: Command pattern provides clean implementation
- **Testing**: Validate with 8-hour test file before completion
