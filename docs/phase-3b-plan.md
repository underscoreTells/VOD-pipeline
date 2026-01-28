# Phase 3b: Timeline Editor & Advanced Features

## Overview

Phase 3 extends the basic video processing pipeline (Phase 3a) with a fully featured timeline editor, waveform visualization, and refined export workflow.

**Estimated timeline**: 8-10 weeks

**Dependencies**:
- Phase 3a (Core Video Processing) must be complete
- Phase 2 (Agent Foundation) integrates with timeline for beat extraction

---

## Task 3.8: Timeline Editor Core (Weeks 1-3)

### Task 3.8.1: Canvas-Based Timeline Component

**Create `src/renderer/lib/components/Timeline.svelte`**

Implement a Canvas-based timeline rendering engine with:

**Core rendering:**
- Video track at top (single track, no layering)
- All audio tracks used by clips displayed below (stacked)
- Track headers with mute/solo/volume controls
- Timecode ruler at top (seconds, frames, or timecode format)
- Playhead indicator (red vertical line)

**Drawing primitives:**
```
Canvas layers (bottom to top):
1. Timeline background (grid lines, markers)
2. Waveform backgrounds (for audio tracks)
3. Clip rectangles (video + audio clips)
4. Selection highlights
5. Playhead and cursor
6. Tool cursor indicators (trim, move, etc.)
```

**Timeline data structure:**
```typescript
interface TimelineState {
  project_id: string;
  duration: number;              // Total duration in seconds
  clips: Clip[];                // All clips on timeline
  tracks: Track[];              // Video + audio track definitions
  selection: SelectionState;    // Currently selected clips/regions
  playhead: number;             // Playhead position in seconds
  zoom: number;                 // Pixels per second
  scrollX: number;              // Horizontal scroll position
  scrollY: number;              // Vertical scroll position
}

interface Clip {
  id: string;
  type: 'video' | 'audio';
  track_id: string;             // Which track (video or audio track N)
  start_time: number;           // Position on timeline (seconds)
  in_point: number;             // In point within source (seconds)
  out_point: number;            // Out point within source (seconds)
  source_asset_id: string;      // Reference to assets table
  audio_track_index?: number;   // For audio clips: which track from source
  metadata: ClipMetadata;
}

interface Track {
  id: string;
  type: 'video' | 'audio';
  label: string;
  height: number;               // Track height in pixels
  is_muted: boolean;
  is_solo: boolean;
  volume: number;               // 0.0 to 1.0
}
```

**Rendering optimization:**
- Virtualization: Only render clips visible in viewport
- Dirty rectangle tracking: Redraw only changed regions
- RequestAnimationFrame: Limit to 60fps max
- Canvas context reuse: Don't recreate on every frame

**Testing**: Write tests for Canvas rendering logic, virtualization, dirty rectangle tracking

---

### Task 3.8.2: Timeline Interactions (Mouse)

**Implement core mouse interactions:**

**Cursor detection:**
```typescript
// Determine tool based on mouse position relative to clip
enum Cursor {
  DEFAULT,           // Over empty space
  MOVE,              // Over clip center (drag entire clip)
  TRIM_IN,           // Over clip left edge
  TRIM_OUT,          // Over clip right edge
  RIPPLE_IN,         // Mod key + left edge
  RIPPLE_OUT,        // Mod key + right edge
}
```

**Interaction handlers:**
- `mousedown`: Detect cursor type, begin drag or trim operation
- `mousemove`: Update preview (ghost clip, trim preview, selection)
- `mouseup`: Finalize operation, record to undo/redo history
- `wheel`: Zoom in/out (horizontal scroll)
- `shift+wheel`: Pan timeline

**Snapping system:**
```
Snap targets (in order of priority):
1. Other clip edges (in/out points)
2. Playhead position
3. Timeline markers
4. Timecode grid (optional, for fine alignment)
```

**Snapping behavior:**
- Magnetic snap: Highlight snap target when within threshold (default: 10px)
- Snap indicator: Show orange vertical line when snapped
- Keyboard shortcut: Toggle snapping (S key, like DaVinci)

**Testing**: Write tests for cursor detection, hit testing, clip movement, collision detection

---

### Task 3.8.3: Timeline Interactions (Keyboard)

**Implement DaVinci-inspired keyboard shortcuts:**

**Navigation:**
| Shortcut | Action | Description |
|----------|--------|-------------|
| Space | Play/Pause | Toggle playback preview |
| Left/Right | Nudge | Move selection left/right 1 frame |
| Ctrl+Left/Right | Nudge | Move selection 1 second |
| Home/End | Jump to start/end | Jump to beginning/end of timeline |
| ↑/Down | Track navigation | Move selection up/down between tracks |
| Scroll | Playback speed | Change forward/backward playback speed |

**Editing:**
| Shortcut | Action | Description |
|----------|--------|-------------|
| Delete | Delete | Remove selection, leave gap |
| Shift+Delete | Ripple Delete | Remove selection, close gap |
| Ctrl+D | Deselect | Clear selection |
| Ctrl+A | Select All | Select all clips in timeline |
| I | Set In Point | Set in point at playhead (for split) |
| O | Set Out Point | Set out point at playhead |
| Ctrl+B | Split | Split clip at playhead (using I/O points) |

**Undo/Redo:**
| Shortcut | Action | Description |
|----------|--------|-------------|
| Ctrl+Z / Cmd+Z | Undo | Undo last action |
| Ctrl+Shift+Z / Cmd+Shift+Z | Redo | Redo last undo |
| Ctrl+Y / Cmd+Y | Redo | Redo (Windows alternative) |

**Zoom:**
| Shortcut | Action | Description |
|----------|--------|-------------|
| +/- | Zoom | Zoom in/out |
| 0-9 | Zoom presets | Quick zoom levels (1 = overview, 9 = max detail) |
| Ctrl+Wheel | Zoom | Mouse wheel zoom |

**Tools:**
| Shortcut | Action | Description |
|----------|--------|-------------|
| A | Selection | Select tool (default) |
| V | Trim | Edge trim tool (like DaVinci) |
| Delete | Delete | Delete selection |

**Testing**: Write tests for keyboard handler, command routing, shortcut execution

---

### Task 3.8.4: Multi-Track Audio Display

**Display all audio tracks used by clips:**

Logic:
1. Query all clips on timeline
2. Extract unique `audio_track_index` values from audio clips
3. For each unique index, create one audio track on timeline
4. Display track label (e.g., "Audio 1", "Audio 2", "Audio 3 - Spanish")
5. Group audio clips by their `audio_track_index` and render on corresponding track

**Example scenario:**
```
Import: VOD.mkv with 4 audio tracks (English, Spanish, Commentary, Music)
User adds to timeline: English track + Music track
Timeline displays:
┌─────────────────────────────────┐
│ Video Track                     │
├─────────────────────────────────┤
│ Audio 1 - English               │
├─────────────────────────────────┤
│ Audio 2 - Music                 │
└─────────────────────────────────┘
```

**Track header controls:**
- Mute button (speaker icon with slash)
- Solo button (S icon)
- Volume slider (0-100%)
- Track label (click to rename)

**Track height:**
- Default: 60px
- Drag bottom edge to resize
- Minimum: 30px, Maximum: 200px
- Height saved to `timeline_state` table

**Testing**: Write tests for track grouping, audio track extraction, mute/solo logic

---

### Task 3.8.5: Clip Selection & Manipulation

**Implement clip operations:**

**Selection modes:**
- Single click: Select clip
- Ctrl+click: Toggle clip selection (multi-select)
- Shift+click: Range select
- Drag on empty space: Rectangular marquee selection (select clips in region)
- Alt+click: Select track (all clips on track)

**Clip operations:**
```typescript
// Move clip(s)
MoveClips(selection: Clip[], delta_time: number): Command

// Trim clip edge
TrimClip(clip: Clip, edge: 'in' | 'out', new_time: number): Command

// Split clip
SplitClip(clip: Clip, position: number): Command[]

// Delete clips (leave gap)
DeleteClips(selection: Clip[]): Command

// Ripple delete (close gap) - move all following clips left
RippleDelete(selection: Clip[]): Command

// Slip (move content within same duration)
SlipClip(clip: Clip, delta: number): Command

// Slide (move clip, adjust adjacent to maintain duration)
SlideClip(clip: Clip, delta: number): Command
```

**Visual feedback:**
- Selected clips: Blue border + slightly brighter
- Hover: Slight brightness increase
- Invalid drop position: Red highlight

**Testing**: Write tests for clip move, trim, split, delete, ripple delete, slip, slide commands

---

### Task 3.8.6: Timeline State Persistence

**Save timeline state to database:**

**Create table:**
```sql
CREATE TABLE timeline_state (
  project_id INTEGER PRIMARY KEY,
  zoom REAL DEFAULT 100.0,              -- Pixels per second
  scroll_x REAL DEFAULT 0.0,
  scroll_y REAL DEFAULT 0.0,
  playhead REAL DEFAULT 0.0,
  track_heights JSONB,                 -- { track_id: height }
  selected_clip_ids JSONB,             -- Array of clip IDs
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**Auto-save:**
- Save on every operation (debounced to 500ms)
- Save on window close (before shutdown)
- Load on project open

**State schema:**
```typescript
interface TimelineStateDB {
  project_id: string;
  zoom: number;
  scroll_x: number;
  scroll_y: number;
  playhead: number;
  track_heights: Record<string, number>;
  selected_clip_ids: string[];
}
```

**Testing**: Write tests for save/load state, state schema validation

---

### Task 3.8.7: Timeline Performance Optimization

**Optimize for long timelines:**

**Virtualization:**
- Calculate visible time range based on zoom + scroll
- Only render clips intersecting visible range
- Clip visibility predicate: `clip.start_time < visible_end && clip.end_time > visible_start`

**Canvas optimization:**
```typescript
// Only redraw dirty regions
const dirtyRegions: Rect[] = [];
// Track dirty rects during operations
ctx.save();
dirtyRegions.forEach(rect => {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  // Redraw affected area
});
ctx.restore();
```

**Data clustering:**
- Group adjacent clips into "track segments" for faster hit detection
- Use spatial index (R-tree or similar) for O(log n) queries

**Memory management:**
- Limit undo/redo history size (max 50 operations)
- Clear waveform data for tracks not currently visible
- Reuse canvas context (don't recreate on every frame)

**Testing**: Write tests for virtualization accuracy, memory limits, performance benchmarks

---

## Task 3.9: Waveform Generation & Rendering (Weeks 4-5)

### Task 3.9.1: 5-Tier LOD Waveform System

**Implement Level of Detail (LOD) system matching NLE standards:**

**Tiers:**

| Tier | Samples/Sec | Precision | Use Case | Generate on |
|------|-------------|-----------|----------|-------------|
| 5 | 100 samples/sec | 10 ms | Sample-accurate editing, beat matching | User zoom to max |
| 4 | 50 samples/sec | 20 ms | Precision cutting, dialogue | User zoom tier 4 |
| 3 | 20 samples/sec (**default**) | 50 ms | Standard timeline view | Asset import |
| 2 | 10 samples/sec | 100 ms | Bin/thumbnail view | Asset import |
| 1 | 5 samples/sec | 200 ms | Clip icon/overview | Asset import |

**Why this matches professional NLEs:**
- DaVinci/Premiere/FCP all use multi-tier LOD
- Default tier (3) provides 50ms precision (exceeds ±2 frame broadcast standard)
- Storage: ~1MB for 8-hour VOD (0.4% of original audio)
- No lag at any zoom (all tiers pre-computed)

**Data structure:**
```typescript
interface WaveformLOD {
  asset_id: string;
  tier: 1 | 2 | 3 | 4 | 5;
  samples: Int8Array;           // Normalized to [-128, 127]
  sample_rate: number;          // Samples per second
  duration: number;             // Audio duration in seconds
}

interface WaveformCache {
  asset_id: string;
  tiers: {
    tier1?: WaveformLOD;
    tier2?: WaveformLOD;
    tier3?: WaveformLOD;
    tier4?: WaveformLOD;
    tier5?: WaveformLOD;
  };
  generated_at: Date;
  source_checksum: string;      // For cache invalidation
}
```

**Testing**: Write tests for tier selection algorithm, LOD boundaries

---

### Task 3.9.2: FFmpeg Waveform Extraction

**Create `src/pipeline/waveform-extractor.ts`:**

**Waveform generation strategy:**

1. **Extract audio** (if not yet extracted):
```bash
ffmpeg -i input.mkv -map 0:a:0 -ar 1000 -ac 1 -f s16le -vn - output.pcm
```

2. **Process PCM to 5 tiers**:
```typescript
class WaveformGenerator {
  generateTiers(pcmData: Float32Array, pcmRate: number): {
    tier1: Int8Array;  // 5 samples/sec
    tier2: Int8Array;  // 10 samples/sec
    tier3: Int8Array;  // 20 samples/sec
    tier4: Int8Array;  // 50 samples/sec
    tier5: Int8Array;  // 100 samples/sec
  }
}
```

3. **Peak calculation algorithm**:
```typescript
// For each tier, calculate min/max over sample windows
function calculatePeaks(audio: Float32Array[], targetSamples: number): Int8Array {
  const step = audio.length / targetSamples;
  const peaks = new Int8Array(targetSamples);

  for (let i = 0; i < targetSamples; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let min = Infinity;
    let max = -Infinity;

    for (let j = start; j < end; j++) {
      if (audio[j] < min) min = audio[j];
      if (audio[j] > max) max = audio[j];
    }

    // Scale to [-128, 127]
    peaks[i] = Math.floor((max * 127) + (-min * -128));
  }

  return peaks;
}
```

**Optimization:**
- Stream processing: Don't load entire audio into memory
- Use `buffer-size` in FFmpeg to handle large files
- Parallel generation: Generate tiers 1-3 concurrently, 4-5 in background
- Progress reporting: Update UI after each tier

**Testing**: Write tests for PCM parsing, peak calculation, multi-tier generation

---

### Task 3.9.3: Waveform Caching System

**Store waveforms with hybrid caching strategy:**

**Database schema (add to `waveform_cache`):**
```sql
CREATE TABLE waveform_cache (
  asset_id INTEGER,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4, 5)),
  samples BLOB NOT NULL,         -- Int8Array as BLOB
  sample_rate REAL NOT NULL,     -- Samples per second
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, tier),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

-- Cache metadata (optional, for quick lookups)
CREATE TABLE waveform_metadata (
  asset_id INTEGER PRIMARY KEY,
  duration REAL NOT NULL,
  source_checksum TEXT NOT NULL,
  has_tier1 BOOLEAN DEFAULT TRUE,
  has_tier2 BOOLEAN DEFAULT TRUE,
  has_tier3 BOOLEAN DEFAULT TRUE,
  has_tier4 BOOLEAN DEFAULT FALSE,  -- Generated on demand
  has_tier5 BOOLEAN DEFAULT FALSE,  -- Generated on demand
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);
```

**Cache generation policy:**
- **Tiers 1-3**: Generate immediately on asset import (fast, ~8 sec for 8-hour video)
- **Tiers 4-5**: Generate in background when user zooms in
- **Cache invalidation**: Regenerate if `source_checksum` changes

**Fallback to file cache:**
- For very large waveforms (Tier 5 for 8+ hour videos), store as files instead of BLOB
- Store in: `~/.vod-pipeline/cache/waveforms/asset_id/tier5.bin`
- Hybrid: SQLite for metadata + file system for big data

**Testing**: Write tests for cache hit/miss, invalidation, tier generation

---

### Task 3.9.4: Canvas Waveform Rendering

**Create `src/renderer/lib/components/WaveformCanvas.svelte`:**

**Rendering strategy:**
```typescript
function renderWaveform(
  ctx: CanvasRenderingContext2D,
  samples: Int8Array,
  sampleRate: number,
  x: number,
  y: number,
  width: number,
  height: number,
  zoom: number  // Pixels per second
) {
  // Determine visible sample range
  const startSample = Math.floor(scrollX / zoom * sampleRate);
  const endSample = Math.floor((scrollX + width) / zoom * sampleRate);

  // Draw each sample as vertical line
  const sampleWidth = zoom / sampleRate;  // Width of each sample in pixels

  ctx.beginPath();
  ctx.strokeStyle = '#00ff00';  // Green for normal levels

  for (let i = startSample; i < Math.min(endSample, samples.length); i++) {
    const pixelX = (i / sampleRate) * zoom - scrollX;
    const value = samples[i];

    // Normalize to [-1, 1] for amplitude
    const normalized = value / 128;
    const amplitude = normalized * (height / 2);

    // Draw line from center
    ctx.moveTo(pixelX, y + (height / 2));
    ctx.lineTo(pixelX, y + (height / 2) + amplitude);
  }

  ctx.stroke();
}
```

**Color coding (like DaVinci):**
```typescript
function getWaveformColor(amplitude: number): string {
  const abs = Math.abs(amplitude);
  if (abs < 0.7) return '#00ff00';      // Green: normal
  if (abs < 0.9) return '#ffff00';      // Yellow: warning
  return '#ff0000';                     // Red: clipping
}
```

**Performance optimization:**
```typescript
// Use offscreen canvas for cached waveforms
const waveformCache = new Map<string, OffscreenCanvas>();

function renderCachedWaveform(assetId: string, tier: number) {
  const cacheKey = `${assetId}_${tier}`;

  if (!waveformCache.has(cacheKey)) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // Render waveform once
    renderWaveform(ctx, ...);
    waveformCache.set(cacheKey, canvas);
  }

  // Draw cached waveform
  ctx.drawImage(waveformCache.get(cacheKey)!, ...);
}
```

**Testing**: Write tests for drawing accuracy, color mapping, performance

---

### Task 3.9.5: Dynamic Tier Selection Based on Zoom

**Select appropriate tier based on timeline zoom level:**

**Tier selection algorithm:**
```typescript
function selectTier(zoom: number): 1 | 2 | 3 | 4 | 5 {
  // Calculate samples per screen pixel
  const samplesPerPixel = getSamplesPerPixel(zoom);

  // Select tier where samples per pixel ~= tier sample rate / zoom
  // Higher zoom = higher tier needed
  if (samplesPerPixel < 10) return 5;   // Max zoom
  if (samplesPerPixel < 20) return 4;
  if (samplesPerPixel < 50) return 3;   // Default range
  if (samplesPerPixel < 100) return 2;
  return 1;                             // Overview
}
```

**Smooth tier transitions:**
- Fade from old tier to new tier during zoom (optional)
- Preload adjacent tiers during zoom for seamless transition
- Generate higher tier in background when user zooms in deeply

**Testing**: Write tests for zoom-to-tier mapping, smooth transitions

---

## Task 3.10: Timeline Interactions (Weeks 6-7)

### Task 3.10.1: Advanced Trimming Operations

**Implement professional trim modes:**

**Trim types:**
```typescript
enum TrimMode {
  STANDARD_TRIM,      // Resize clip edge independently
  ROLL_TRIM,          // Move edit point, adjust adjacent clips
  SLIP_TRIM,          // Move clip content, keep duration/position
  SLIDE_TRIM,         // Move clip, adjust adjacent to keep duration
}
```

**Roll trim (DaVinci-style):**
- Move edit point where two clips meet
- Adjust both clips simultaneously
- Total timeline duration unchanged
- Visual feedback: Show "ghost clip" of moved content

**Ripple trim (Shift+edge drag):**
- Delete content, close gap
- All clips after edit point shift left
- Total timeline duration reduces by trim amount

**Slip trim:**
- Move content within clip bounds
- Clip position and duration unchanged
- Only `in_point` and `out_point` change
- Use I/O points set by user (default: clip boundaries)

**Slide trim:**
- Move clip, adjust adjacent clips
- Total timeline duration unchanged
- Like "roll" but moving entire clip, not just edge

**Testing**: Write tests for roll trim, slip trim, slide trim calculations

---

### Task 3.10.2: Clip Reordering

**Implement drag-and-drop reordering:**

**Operation types:**
1. **Same-track reorder**: Move clip before/after other clips on same track
2. **Cross-track move**: Move clip to different track
3. **Multi-track selection**: Move all selected clips together

**Conflict resolution:**
- Detect collisions: Clips cannot overlap on same track
- Auto-snap: Move adjacent clips to make room
- Auto-ripple: Move all following clips to maintain order (optional)

**Visual feedback during drag:**
- Ghost clip at new position
- Highlight destination track/position
- Red highlight if invalid position (collision)

**Implementation:**
```typescript
function moveClips(
  clips: Clip[],
  newTrackId: string,
  newStartTime: number
): Command {
  // Check for collisions
  const collisions = detectCollisions(clips, newTrackId, newStartTime);
  if (collisions) {
    // Auto-snap or reject
    return null;
  }

  // Calculate ripple if needed
  const rippleOffset = calculateRippleOffset(clips, newTrackId, newStartTime);

  return {
    execute: () => {
      // Move clips and ripple subsequent clips
    },
    undo: () => {
      // Restore original positions
    }
  };
}
```

**Testing**: Write tests for drag-and-drop, collision detection, auto-ripple

---

### Task 3.10.3: Audio Track Controls

**Enhance audio track header with full controls:**

**Per-track controls:**
- **Mute**: Disable audio from this track
- **Solo**: Mute all other tracks, play only this track
- **Volume**: 0-100% slider
- **Pan**: Left-Right balance (optional, for stereo)
- **Rename**: Click track label to edit

**Mute/Solo logic:**
```typescript
interface AudioTrack {
  id: string;
  label: string;
  is_muted: boolean;
  is_solo: boolean;
  volume: number;        // 0.0 to 1.0
}

function calculateFinalVolume(track: AudioTrack, allTracks: AudioTrack[]): number {
  // Solo takes precedence
  const hasAnySolo = allTracks.some(t => t.is_solo);

  if (hasAnySolo) {
    return track.is_solo ? track.volume : 0.0;
  }

  return track.is_muted ? 0.0 : track.volume;
}
```

**Visual indication:**
- Muted track: Gray waveform, speaker icon with slash
- Solo track: Yellow waveform, "S" icon
- Volume < 100%: Dimmed waveform

**Testing**: Write tests for mute/solo logic, volume calculation

---

### Task 3.10.4: Snapping System Enhancement

**Implement smart snapping:**

**Snap targets (in priority order):**
1. **Clip edges** (in/out points)
2. **Playhead position**
3. **Timeline markers** (Phase 1, maybe defer)
4. **Beat markers** (from AI agent)
5. **Zero-crossings** (audio waveform silent points, optional)
6. **Grid lines** (optional, at low zoom)

**Snapping behavior:**
```typescript
interface SnapConfig {
  enabled: boolean;
  threshold: number;      // Pixels (default: 10)
  snap_to_playhead: boolean;
  snap_to_clips: boolean;
  snap_to_markers: boolean;
  snap_to_grid: boolean;
}

function findSnapTarget(
  time: number,
  clips: Clip[],
  playhead: number,
  config: SnapConfig
): { target: number; source: SnapSource } | null {
  // Check each snap target in priority order
  // Return first match within threshold
}
```

**Visual feedback:**
- Orange vertical line at snap position
- Snap source indicator (e.g., "Clip edge", "Playhead")
- Audio snap: Optional ripple effect when snapped to zero-crossing

**Keyboard toggle:**
- `S`: Toggle snapping (like DaVinci)

**Testing**: Write tests for snap target detection, threshold logic

---

### Task 3.10.5: Undo/Redo Integration

**Implement comprehensive undo/redo for all timeline operations:**

**Command pattern implementation:**
```typescript
interface Command {
  description: string;          // "Move clip 3", "Delete clips", etc.
  execute(): Promise<void>;
  undo(): Promise<void>;
  canUndo(): boolean;           // Always true after execute
  canRedo(): boolean;           // Always true after undo
}
```

**Command examples:**
```typescript
// Move single clip
class MoveClipCommand implements Command {
  description = "Move clip";
  constructor(
    private clip: Clip,
    private originalTrack: string,
    private originalStartTime: number,
    private newTrack: string,
    private newStartTime: number
  ) {}

  async execute() {
    this.clip.track_id = this.newTrack;
    this.clip.start_time = this.newStartTime;
  }

  async undo() {
    this.clip.track_id = this.originalTrack;
    this.clip.start_time = this.originalStartTime;
  }
}

// Delete clips with ripple
class RippleDeleteCommand implements Command {
  description = "Ripple delete";
  constructor(
    private clipsToDelete: Clip[],
    private timeline: Timeline
  ) {}

  async execute() {
    this.affectedClips = this.timeline.getClipsAfter(this.clipsToDelete);
    this.timeline.deleteClips(this.clipsToDelete);
    this.timeline.rippleClips(this.clipsToDelete[0].start_time);
  }

  async undo() {
    this.timeline.restoreClips(this.clipsToDelete);
    this.timeline.rippleClipsReverse(this.affectedClips);
  }
}
```

**History management (.svelte.ts):**
```typescript
// src/renderer/lib/state/undo-redo.svelte.ts
export const undoStack = $state<Command[]>([]);
export const redoStack = $state<Command[]>([]);
export const canUndo = $derived(undoStack.length > 0);
export const canRedo = $derived(redoStack.length > 0);

export async function executeCommand(command: Command) {
  await command.execute();
  undoStack.push(command);
  redoStack.length = 0;  // Clear redo stack

  // Limit history size
  if (undoStack.length > 50) {
    undoStack.shift();
  }

  // Save to database for persistence
  saveHistory(command);
}

export async function undo() {
  const command = undoStack.pop();
  if (command) {
    await command.undo();
    redoStack.push(command);
  }
}

export async function redo() {
  const command = redoStack.pop();
  if (command) {
    await command.execute();
    undoStack.push(command);
  }
}
```

**Coalescing:**
- Debounce rapid changes (e.g., slider dragging): Wait 500ms before saving
- Collapse identical operations: Multiple single-clip moves → one multi-clip move
- Group related operations: Trim in + Trim out = "Trim clip both edges"

**Exclude from history:**
- Playhead changes (scrubbing)
- Zoom/pan changes
- Selection changes (not destructive)

**Testing**: Write tests for command execution, undo/redo operations, coalescing

---

## Task 3.11: Cut Review & Export (Weeks 8-10)

### Task 3.11.1: Beat List Panel (Synced with Timeline)

**Create beat list UI component:**

**Two-column panel layout:**
```
┌─────────────────────────────────────┬─────────────────────────┐
│ Beat List Panel                      │ Clip Preview Panel       │
│ ┌─────────────────────────────────┐ │ ┌─────────────────────┐ │
│ │ [Beat 1]  00:00:30 - 00:01:00  │ │ │ [Video Player]      │ │
│ │ Setup - The challenge begins   │ │ │ └───────────────────┘ │
│ │ [▶ Play] [Edit] [× Discard]   │ │ │ In: 00:00:30.000      │ │
│ ├─────────────────────────────────┤ │ Out: 00:01:00.000     │ │
│ │ [Beat 2]  00:01:15 - 00:02:00  │ │ [-1f] [+1f] buttons    │ │
│ │ Escalation - Things get hard  │ │                         │ │
│ │ [▶ Play] [Edit] [× Discard]   │ │ │ [Waveform highlight]│ │
│ └─────────────────────────────────┘ │ └─────────────────────┘ │
└─────────────────────────────────────┴─────────────────────────┘
```

**Synchronization:**
- Click beat → Select clip on timeline, scroll to view
- Select clip on timeline → Highlight corresponding beat
- Discard beat → Mark beat as `discard: true`, remove from timeline
- Restore beat → Unmark discard, add back to timeline

**Beat list state:**
```typescript
interface Beat {
  id: string;
  chapter_id: string;
  start_time: number;
  end_time: number;
  role: 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition';
  description: string;
  why_essential: string;
  visual_dependency: 'none' | 'important' | 'critical';
  discard: boolean;
  user_modified: boolean;
}
```

**Testing**: Write tests for list-timeline sync, beat selection, discard logic

---

### Task 3.11.2: Clip Preview Component

**Create video player for previewing clips:**

**Player features:**
- Standard HTML5 video player (or custom Electron player for better codecs)
- In/out point display and editing
- Fine-tune controls: ±1 frame buttons (using frame rate to convert)
- Waveform visualization with highlighted in/out region
- Loop playback of selected clip
- Keyboard shortcuts (Space for play/pause)

**In/out point editing:**
```
Controls:
[00:00:30.000] ─━━━━━●━━━━━━━━━━━━━━ [00:01:00.000]
                   In point
[00:00:30.000] ━━━━━━━━━━━○━━━━━━━ [00:01:00.000]
                              Out point

Buttons:
[-1f]  Move in/out point back 1 frame
[+1f]  Move in/out point forward 1 frame
```

**Waveform highlight:**
```typescript
// Draw waveform with in/out region highlighted
function drawClipWaveform(ctx, clip, selectedRegion) {
  drawWaveform(ctx, clip.waveform, '#00ff00');

  // Highlight in/out selection
  const inPixel = timeToPixel(clip.in_point);
  const outPixel = timeToPixel(clip.out_point);

  ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
  ctx.fillRect(inPixel, 0, outPixel - inPixel, height);
}
```

**Testing**: Write tests for in/out point editing, frame calculations

---

### Task 3.11.3: Export Panel & Format Selection

**Create export configuration panel:**

**Export format options:**
- **JSON Cut List** (primary) - Internal format, everything preserved
- **XML (FCPXML)** - For DaVinci Resolve / Final Cut Pro
- **EDL (CMX 3600)** - For DaVinci / Premiere / Avid (basic cuts only)

**Export settings:**
```typescript
interface ExportSettings {
  format: 'json' | 'xml' | 'edl';
  frame_rate: '23.976' | '24' | '25' | '29.97' | '30' | '50' | '59.94' | '60';
  audio_tracks: 'all' | 'mix' | 'selected';  // Which tracks to export
  mix_down: boolean;                         // Mix all audio to stereo
  include_markers: boolean;                  // Include beat markers
  include_waveforms: boolean;                // Include waveform data (JSON only)
}
```

**Export format comparison:**
| Format | Features | NLE Support | Best For |
|--------|----------|-------------|----------|
| **JSON** | All data, markers, waveforms, metadata | Custom | VOD Pipeline |
| **XML** | Clips, markers, effects, transitions | DaVinci, FCP, Premiere | Full-featured export |
| **EDL** | Basic cuts only | All NLEs | Backup, compatibility |

**Testing**: Write tests for format selection, settings validation

---

### Task 3.11.4: Audio Track Selection for Export

**Audio export options:**

**Export all tracks** (default):
- Export each audio track separately in XML
- Preserves track assignments
- Best for DaVinci with multi-track workflows

**Mix down to stereo**:
- Mix all audio tracks to single stereo track
- Volume levels preserved from timeline
- Best for Premiere Pro with simpler workflows

**Export selected tracks only**:
- User selects which tracks to include in export
- Muted tracks not automatically excluded (user choice)
- For selective export (e.g., export English track only)

**Implementation:**
```typescript
function generateAudioTracksForExport(
  clips: Clip[],
  audioTracks: AudioTrack[],
  settings: ExportSettings
): ExportAudioTrack[] {
  switch (settings.audio_tracks) {
    case 'all':
      return audioTracks.map(t => ({
        source_file: getAudioSourceFile(t),
        volume: t.volume,
        clips: clips.filter(c => c.audio_track_index === t.index)
      }));

    case 'mix':
      return [{
        source_file: generateMixdown(clips, audioTracks),
        volume: 1.0,
        is_mixdown: true
      }];

    case 'selected':
      const selected = audioTracks.filter(t => t.export_selected);
      return selected.map(t => ({
        source_file: getAudioSourceFile(t),
        volume: t.volume,
        clips: clips.filter(c => c.audio_track_index === t.index)
      }));
  }
}
```

**Testing**: Write tests for track filtering, mixdown calculation

---

### Task 3.11.5: Save Project State

**Persist all user modifications:**

**Database updates:**
```sql
-- Add to beats table
ALTER TABLE beats ADD COLUMN discard BOOLEAN DEFAULT FALSE;
ALTER TABLE beats ADD COLUMN user_modified BOOLEAN DEFAULT FALSE;
ALTER TABLE beats ADD COLUMN sort_order INTEGER;

-- Audio export selections
CREATE TABLE audio_export_selections (
  asset_id INTEGER,
  track_index INTEGER,
  export_selected BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  PRIMARY KEY (asset_id, track_index)
);

-- Project metadata
CREATE TABLE project_metadata (
  project_id INTEGER PRIMARY KEY,
  last_save_time DATETIME,
  save_count INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**Save operation:**
```typescript
async function saveProject(projectId: string) {
  // Save timeline state
  await saveTimelineState(projectId, timelineState);

  // Save beat modifications
  await saveBeats(projectId, beats);

  // Save audio track selections
  await saveAudioExportSelections(projectId, audioTracks);

  // Save undo/redo history (optional, for crash recovery)
  await saveHistory(projectId, undoStack);
}
```

**Load operation:**
```typescript
async function loadProject(projectId: string) {
  // Load timeline state
  timelineState = await loadTimelineState(projectId);

  // Load beats (including user modifications)
  beats = await loadBeats(projectId);

  // Load audio tracks and selections
  audioTracks = await loadAudioTracks(projectId);

  // Reconstruct timeline clips from beats + assets
  clips = reconstructClips(beats, assets);

  // Restore undo/redo history
  undoStack = await loadHistory(projectId);
}
```

**Testing**: Write tests for save/load, state integrity

---

## Task 3.12: Testing & Refinement (Weeks 9-10)

### Task 3.12.1: Integration Tests

**Test end-to-end workflows:**
- Import video → Generate waveforms → Timeline display
- Beat extraction → Timeline clips → Export to JSON/XML
- Timeline edits → Undo/Redo → Save/Load project
- Multi-track audio → Export with track selections

**Testing framework**: Use existing test framework (Jest, Vitest, or similar)

---

### Task 3.12.2: Performance Tests

**Test with large datasets:**
- 8-hour video with 50,000 frames
- Timeline with 100+ clips
- Waveform visualization at different zoom levels
- Undo/redo history with 500 operations
- Memory usage monitoring

**Performance benchmarks:**
- Timeline rendering FPS target: 60 FPS
- Zoom/pan response time: < 16ms (60 FPS)
- Waveform generation time: < 10 seconds for 8-hour video
- Undo/redo execution time: < 50ms

---

### Task 3.12.3: User Testing (Manual)

**Test real-world workflows:**
- Twitch VOD → AI beat extraction → Timeline editing → Export
- Compare DaVinci import with manual cuts vs. VOD Pipeline export
- Refine timeline interactions based on usage patterns
- Validate NLE compatibility (DaVinci Resolve, Premiere Pro, FCP)

---

## Database Schema Summary (Phase 3b)

### New Tables

```sql
-- Timeline state
CREATE TABLE timeline_state (
  project_id INTEGER PRIMARY KEY,
  zoom REAL DEFAULT 100.0,
  scroll_x REAL DEFAULT 0.0,
  scroll_y REAL DEFAULT 0.0,
  playhead REAL DEFAULT 0.0,
  track_heights JSONB,
  selected_clip_ids JSONB,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Waveform cache
CREATE TABLE waveform_cache (
  asset_id INTEGER,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3, 4, 5)),
  samples BLOB NOT NULL,
  sample_rate REAL NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, tier),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

-- Waveform metadata
CREATE TABLE waveform_metadata (
  asset_id INTEGER PRIMARY KEY,
  duration REAL NOT NULL,
  source_checksum TEXT NOT NULL,
  has_tier1 BOOLEAN DEFAULT TRUE,
  has_tier2 BOOLEAN DEFAULT TRUE,
  has_tier3 BOOLEAN DEFAULT TRUE,
  has_tier4 BOOLEAN DEFAULT FALSE,
  has_tier5 BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

-- History commands
CREATE TABLE history_commands (
  project_id INTEGER,
  command_order INTEGER,
  command_type TEXT,
  command_data JSONB,
  inverted_command_data JSONB,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, command_order),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Audio export selections
CREATE TABLE audio_export_selections (
  asset_id INTEGER,
  track_index INTEGER,
  export_selected BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  PRIMARY KEY (asset_id, track_index)
);

-- Project metadata
CREATE TABLE project_metadata (
  project_id INTEGER PRIMARY KEY,
  last_save_time DATETIME,
  save_count INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

### Modified Tables

```sql
-- Existing assets table
ALTER TABLE assets ADD COLUMN audio_tracks JSONB;
ALTER TABLE assets ADD COLUMN waveform_generated BOOLEAN DEFAULT FALSE;

-- Existing beats table
ALTER TABLE beats ADD COLUMN discard BOOLEAN DEFAULT FALSE;
ALTER TABLE beats ADD COLUMN user_modified BOOLEAN DEFAULT FALSE;
ALTER TABLE beats ADD COLUMN sort_order INTEGER;
```

---

## Phase 3b Summary

**Total tasks**: 12 subtasks across 4 main areas
**Estimated timeline**: 8-10 weeks

**Dependencies**:
- Phase 3a (Core Video Processing) must be complete
- Phase 2 (Agent Foundation) integrates with timeline for beat extraction
- Research complete on: NLE timeline features, waveform resolution, rendering options, undo/redo patterns

**Key deliverables**:
1. Fully featured canvas-based timeline editor (no external library)
2. 5-tier waveform LOD system (matching NLE standards)
3. Comprehensive undo/redo for all timeline operations
4. Multi-track audio display and export
5. Beat list panel synced with timeline
6. Clip preview with in/out editing
7. JSON/XML/EDL export with audio track selection
8. Project state persistence

**Testing strategy**:
- Write unit tests after each subtask completion (not TDD)
- Integration tests at end of phase
- Performance tests with real large datasets
- Manual user testing for workflows

**Next phase**: Phase 4 - UI Refinement (if planned later)
