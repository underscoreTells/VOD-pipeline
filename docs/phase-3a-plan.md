# Phase 3a Implementation Plan: Core Video Processing

## Overview

Implement the video processing pipeline foundation: FFmpeg operations (including scaling/framerate reduction), Whisper transcription, asset/chapter management, and transcript storage. Backend API only - no UI components.

**Timeline**: 2 weeks

**Dependencies**: Phase 1 (Infrastructure) and Phase 2 (Agent Foundation) complete

**Key Decisions**:
- FFmpeg: Existing installer + path detection with fallback cascade
- Whisper: faster-whisper (Python) via child_process, default model: base
- Python: Decision deferred (wrapper works with bundled or system Python)
- Audio: Auto-detect language with user override
- Encoding: H264 default, CRF 28, maintain aspect ratio, simple frame drop
- Scope: Backend API only - UI deferred to phases 3b/4

---

## Tasks

### Task 3a.1: FFmpeg Path Detection

**File**: `src/electron/ffmpeg-detector.ts`

**Functions**:
- `detectFFmpeg()` - Returns path, source type, and version string
- `getFFmpegVersion(executablePath)` - Extracts version from `ffprobe -version`

**Detection Order**:
1. Bundled binary (production): `process.resourcesPath/binaries/{platform}/ffmpeg`
2. Development directory: `./binaries/{platform}/ffmpeg`
3. User data directory: `app.getPath('userData')/binaries/ffmpeg`
4. System PATH: `ffmpeg` command

**Integration**:
- Call on app startup in `src/electron/main.ts`
- Store detected path for pipeline use
- Log detection result

**Milestone**: App logs FFmpeg version on startup

---

### Task 3a.2: FFmpeg Wrapper

**File**: `src/pipeline/ffmpeg.ts`

**Core Functions**:
- `getVideoMetadata(filePath)` - Returns duration, resolution, fps, codecs, audio streams
- `extractAudio(videoPath, outputPath, trackIndex)` - Extract specified audio track to WAV
- `cutVideo(inputPath, outputPath, startTime, endTime)` - Cut segment using `-ss` and `-to`
- `getDuration(filePath)` - Return video duration in seconds

**Scaling Functions**:
- `scaleVideo(inputPath, outputPath, options)` - Resize video with aspect ratio options
- `setFramerate(inputPath, outputPath, options)` - Reduce framerate (drop or interpolate)
- `generateProxy(inputPath, outputPath, options)` - Combined scale + framerate + codec
- `generateMultiResolutionProxies(inputPath, outputDir, resolutions)` - Batch proxy generation

**Proxy Presets** (export constant):
- AI_ANALYSIS: 640px, 5fps, H264
- ROUGH_CUT: 720px, 15fps, H264
- EDITABLE: 1280px, 24fps, H264
- REVIEW: 1920px, 30fps, ProRes

**Milestone**: Can extract metadata, cut video, scale, reduce framerate, generate proxies

---

### Task 3a.3: Whisper Wrapper

**File**: `src/pipeline/whisper.ts`

**Functions**:
- `transcribe(options, onProgress)` - Returns segments with timestamps

**Options**:
- audioPath (required)
- model: tiny/base/small/medium (default: base)
- language: code or auto-detect if omitted
- computeType: int8/float16 (default: int8)

**Progress Callback**:
- Receives percent (0-100) and status message

**Returns**:
- full transcript text
- detected language
- duration
- array of segments (id, start, end, text)

---

### Task 3a.4: Python Detection

**File**: `src/electron/python-detector.ts`

**Functions**:
- `detectPython()` - Returns path and source (bundled or system)

**Detection Order**:
1. Bundled Python (if exists)
2. System: `python3` then `python`

**Integration**:
- Used by Whisper wrapper to spawn processes
- No bundling yet - packaging deferred

**Milestone**: Returns Python path or null

---

### Task 3a.5: Database Layer - Assets

**File**: Update `src/electron/database/db.ts`

**Functions**:
- `createAsset(asset)` - Insert asset with metadata
- `getAsset(id)` - Retrieve single asset
- `getAssetsByProject(projectId)` - List all project assets
- `deleteAsset(id)` - Remove asset
- `deleteAssetsByProject(projectId)` - Cascade delete for project

**Asset Fields**:
- id, project_id, file_path, file_type (video/audio/image)
- duration, metadata (JSON string), created_at

**Milestone**: Full CRUD for assets

---

### Task 3a.6: Database Layer - Chapters

**File**: Update `src/electron/database/db.ts`

**Functions**:
- `createChapter(chapter)` - Insert with time range validation
- `getChapter(id)` - Retrieve single chapter
- `getChaptersByProject(projectId)` - List ordered by start_time
- `updateChapter(id, updates)` - Update fields (validate time range)
- `deleteChapter(id)` - Remove chapter (cascade deletes transcripts)
- `deleteChaptersByProject(projectId)` - Cascade for project

**Chapter Fields**:
- id, project_id, title, start_time, end_time, created_at

**Milestone**: Full CRUD for chapters

---

### Task 3a.7: Database Layer - Chapter Assets Linking

**File**: Update `src/electron/database/db.ts`

**Functions**:
- `addAssetToChapter(chapterId, assetId)` - Link many-to-many
- `removeAssetFromChapter(chapterId, assetId)` - Remove link
- `getAssetsForChapter(chapterId)` - Get all linked assets
- `getChaptersForAsset(assetId)` - Get all linked chapters

**Milestone**: Link/unlink assets to chapters

---

### Task 3a.8: Database Layer - Transcripts

**File**: Update `src/electron/database/db.ts`

**Functions**:
- `createTranscript(transcript)` - Insert single segment
- `getTranscriptsByChapter(chapterId)` - Get all segments ordered
- `getTranscriptsByProject(projectId)` - Get all project transcripts
- `deleteTranscriptsByChapter(chapterId)` - Clear chapter transcripts
- `batchInsertTranscripts(chapterId, segments)` - Bulk insert (transaction-wrapped)

**Transcript Fields**:
- id, chapter_id, text, start_time, end_time

**Performance**: Use prepared statements for batch inserts

**Milestone**: Efficient storage of Whisper segments

---

### Task 3a.9: Shared Types

**File**: `src/shared/types/database.ts`

**Exports**:
- Asset (interfaces matching DB schema)
- Chapter
- Transcript

**File**: `src/shared/types/pipeline.ts`

**Exports**:
- VideoMetadata
- TranscriptionSegment
- TranscriptionResult
- TranscriptionOptions
- ScaleOptions
- FramerateOptions
- FFmpegPathResult

**Milestone**: Type definitions centralized and exported

---

### Task 3a.10: IPC Channel Definitions

**File**: Update `src/electron/ipc/channels.ts`

**Add Channels**:
- Assets: ASSET_ADD, ASSET_GET, ASSET_GET_BY_PROJECT, ASSET_DELETE
- Chapters: CHAPTER_CREATE, CHAPTER_GET, CHAPTER_GET_BY_PROJECT, CHAPTER_UPDATE, CHAPTER_DELETE
- Chapter-Assets: CHAPTER_ADD_ASSET, CHAPTER_REMOVE_ASSET, CHAPTER_GET_ASSETS
- Transcription: TRANSCRIBE_CHAPTER, TRANSCRIBER_PROGRESS (event)

**Milestone**: All IPC channel constants defined

---

### Task 3a.11: IPC Handlers - Assets

**File**: Update `src/electron/ipc/handlers.ts`

**Handlers**:
- `ASSET_ADD` - Validate file, get metadata, determine type, insert DB
- `ASSET_GET` - Query, parse metadata JSON, return
- `ASSET_GET_BY_PROJECT` - Query all, parse metadata for each
- `ASSET_DELETE` - Delete, cascade handled by FK

**Error Handling**:
- File not found
- Unsupported format
- Database errors

**Milestone**: Assets manageable via IPC

---

### Task 3a.12: IPC Handlers - Chapters

**File**: Update `src/electron/ipc/handlers.ts`

**Handlers**:
- `CHAPTER_CREATE` - Validate range (start >= 0, end > start), insert
- `CHAPTER_GET_BY_PROJECT` - Query ordered by start_time
- `CHAPTER_UPDATE` - Validate updated range, update DB
- `CHAPTER_DELETE` - Delete, cascade deletes transcripts
- `CHAPTER_ADD_ASSET` - Create many-to-many link
- `CHAPTER_REMOVE_ASSET` - Remove link
- `CHAPTER_GET_ASSETS` - Query linked assets with metadata

**Milestone**: Chapters manageable via IPC with asset linking

---

### Task 3a.13: IPC Handler - Transcription

**File**: Update `src/electron/ipc/handlers.ts`

**Handler**:
- `TRANSCRIBE_CHAPTER` - Orchestrate full workflow

**Workflow Steps**:
1. Fetch chapter from DB
2. Fetch chapter's primary asset
3. Extract audio to temp file
4. Call Whisper with progress callback
5. On progress: send TRANSCRIBER_PROGRESS event to renderer
6. Batch insert segments to DB
7. Cleanup temp file (finally block)
8. Return transcription result

**Progress Event**:
- chapterId, progress (0-100), status message

**Error Cases**:
- Chapter not found
- No assets in chapter
- Audio extraction failure
- Whisper process crash
- DB insertion failure

**Milestone**: End-to-end transcription with progress streaming

---

### Task 3a.14: Error Handling & Logging

**Files**: All IPC handlers

**Error Response Pattern**:
- success: boolean
- error: string (descriptive)
- code: enum (FILE_NOT_FOUND, INVALID_FORMAT, etc.)
- details: optional object

**Logging**:
- Log all major operations with context
- Include error stacks via console.error
- Log subprocess outputs (FFmpeg, Whisper)

**Cleanup**:
- Ensure temp files always deleted
- Manage subprocess cleanup on cancellation

**Milestone**: Consistent error handling, comprehensive logging

---

### Task 3a.15: Python Script for Whisper

**File**: `python/transcribe.py`

**CLI Interface**:
- `--audio` (required)
- `--model` (default: base)
- `--language` (optional, auto-detect)
- `--compute-type` (default: int8)
- `--output-format` (only: json)

**Stderr Progress**:
- JSON lines: `PROGRESS:{"percent":45,"status":"..."}`

**Stdout Output**:
- JSON: `{text, language, duration, segments}`

**Milestone**: Whisper callable via subprocess

---

## File Structure

```
src/
├── electron/
│   ├── ffmpeg-detector.ts          (NEW)
│   ├── python-detector.ts          (NEW)
│   ├── ipc/
│   │   ├── handlers.ts             (UPDATED)
│   │   └── channels.ts             (UPDATED)
│   ├── preload.ts                  (UPDATED)
│   └── main.ts                     (UPDATED)
├── pipeline/
│   ├── ffmpeg.ts                   (NEW)
│   └── whisper.ts                  (NEW)
├── shared/
│   └── types/
│       ├── database.ts             (NEW)
│       └── pipeline.ts             (NEW)
└── renderer/
    └── (NO CHANGES)

python/
└── transcribe.py                   (NEW)
```

---

## Testing Strategy

**Unit Tests (Vitest)**:
- FFmpeg detection: Test fallback cascade, version parsing
- FFmpeg wrapper: Mock spawn, test command building
- Whisper wrapper: Mock subprocess, test progress parsing
- Database: CRUD operations, cascade deletes, batch inserts

**Manual Integration Tests**:
1. Import video file
2. Extract and verify metadata
3. Create chapter with time range
4. Link asset to chapter
5. Transcribe chapter
6. Verify DB records (asset, chapter, transcripts)

**Error Cases**:
- Invalid file format
- Missing FFmpeg
- Whisper crash
- DB constraint violations

---

## Success Criteria

- FFmpeg detected and version logged on startup
- Video import extracts metadata and stores in DB
- Chapter CRUD operations work via IPC
- Asset-chapter linking functional
- Transcription completes with progress events
- Transcripts stored with correct timestamps
- All operations logged appropriately
- Errors handled with descriptive messages
- No temp file leaks
- TypeScript compiles without errors

---

## Deferred to Later Phases

- UI components (Svelte, state, progress bars)
- Python bundling/packaging
- Large file optimizations
- Word-level timestamps
- Multiple audio track handling
- NLE exports
