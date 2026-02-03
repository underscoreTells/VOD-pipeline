# Chapter Media Rendering Fix Plan

## Goals

- Show a working video player when defining chapters from a VOD.
- Render waveforms for chapter timelines without local-file load errors.
- Persist timeline state without IPC validation errors.
- Reduce noisy startup logs from missing .env (optional).

## Current Issues and Root Causes

1. **No video player while defining chapters**
   - `src/renderer/lib/components/ChapterDefinition.svelte` does not render a `<video>` element at all.

2. **No waveform visible when selecting chapters**
   - `src/renderer/lib/components/ProjectDetail.svelte` builds `file://` URLs for audio.
   - The renderer runs from `http://localhost:5173`, so Electron blocks `file://` loads.
   - `WaveSurfer.load()` fails with `Not allowed to load local resource`.

3. **Timeline state save error**
   - IPC handler expects `projectId` but the renderer sends `project_id`, so `projectId` is undefined.
   - The log shows `IPC: timeline:state-save undefined` and validation errors.

4. **Missing .env noise (non-blocking)**
   - `dotenv.config()` logs an error when `.env` is absent; this is expected on dev machines.

## Approach Overview

Introduce a custom `vod://` protocol for safe, fetchable local media, then use it everywhere the UI
needs to load audio or video. Fix the timeline state payload to match IPC expectations and wire in
a real video player for chapter definition and clip preview.

## Implementation Steps

### 1) Main Process: Media Protocol

- Register `vod://` with `protocol.registerSchemesAsPrivileged` **before** `app.whenReady()`.
- Add a `registerMediaProtocol()` helper in `src/electron/main.ts` (or new `src/electron/media-protocol.ts`).
- URL shape: `vod://asset/<assetId>`.
- Handler logic:
  - Parse asset ID from URL.
  - Load the asset with `getAsset()` from `src/electron/database/db.ts`.
  - Verify the file exists and return `404` if not.
  - Serve the file using `protocol.handle()` + `net.fetch(pathToFileURL(filePath))`.
  - If range requests fail, switch to `protocol.registerStreamProtocol()` and implement manual
    range handling (required for smooth video seeking).
- Restrict access to assets by ID only to avoid arbitrary path access.

### 2) Renderer: Media URL Helper

- Add `src/renderer/lib/utils/media.ts` with `buildAssetUrl(assetId: number): string` that returns
  `vod://asset/${assetId}`.
- Optionally add `getAssetMimeType(asset)` using extension or `asset.metadata` to set `<source type>`.

### 3) Timeline Waveform URL Fix

- Update `src/renderer/lib/components/ProjectDetail.svelte` to build `audioUrls` from `buildAssetUrl(asset.id)`.
- Ensure `TimelineTrack.svelte` continues to use the same URL for `WaveSurfer.load()`.

### 4) Chapter Definition Video Player

- Add a `<video>` element in `src/renderer/lib/components/ChapterDefinition.svelte`:
  - `src` uses `buildAssetUrl(asset.id)`.
  - `bind:this={videoRef}` for control.
  - `ontimeupdate` keeps `playheadTime` in sync.
  - Scrubber interactions update `videoRef.currentTime`.
- Use the video element to preview selection ranges (play from `selectionStart` to `selectionEnd`).

### 5) Clip Preview Video Player

- Update `src/renderer/lib/components/ClipPreview.svelte`:
  - Map `selectedClip.asset_id` to `projectDetail.assets`.
  - Set `<source src={buildAssetUrl(asset.id)}>`.
  - On clip change, seek to `selectedClip.in_point` and optionally autoplay.
  - Implement loop logic to stop at `selectedClip.out_point` instead of the asset end.

### 6) Timeline State Save Payload

- Fix payload mismatch by updating **either** side:
  - Renderer: send `{ projectId, zoomLevel, scrollPosition, playheadTime, selectedClipIds }`.
  - Or IPC: accept `project_id` and `selected_clip_ids` as aliases for backward compatibility.
- Ensure `saveProjectTimelineState()` bails early if `projectId` is missing.

### 7) Optional: .env Log Cleanup

- In `src/electron/main.ts`, check `fs.existsSync('.env')` before `dotenv.config()`.
- Only log an error if a `.env` exists but fails to parse; otherwise log at `debug` or skip.

## Validation Checklist

- `pnpm dev` starts without `Not allowed to load local resource` errors.
- Chapter definition view shows a playable video and scrubber sync works.
- Selecting a chapter renders waveform tracks (no `WaveSurfer` fetch errors).
- Selecting a clip loads video in ClipPreview and loops between in/out points.
- `timeline:state-save` logs a valid project id and no validation errors.

## Risks and Mitigations

- **Range support**: If `protocol.handle()` fails to honor `Range`, switch to
  `protocol.registerStreamProtocol()` with manual range handling.
- **Missing assets**: Return 404 with a renderer-friendly error message to avoid silent failures.
- **Large files**: Avoid full-file buffering; stream directly from disk.

## Rollback

- If protocol streaming fails, temporarily gate the feature behind a flag and fall back to
  a minimal HTTP server or disable playback until the protocol layer is fixed.
