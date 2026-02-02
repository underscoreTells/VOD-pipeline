# Dual-Path Import Implementation Plan

## Overview

This implementation adds a dual-path import system that allows users to either:
1. **Import Full VOD**: Import a single large VOD file and manually define chapters via timeline scrubber
2. **Import Individual Files**: Import pre-cut files that are automatically treated as chapters

The UI is redesigned to be **chapters-first**, making chapters the primary organizational unit instead of assets.

## User Specifications

| Feature | Decision |
|---------|----------|
| **Auto-chapter naming** | Yes, with setting to enable/disable. Uses cheap LLM (GPT-4o nano) on transcript |
| **Chapter reordering** | Drag-and-drop in sidebar |
| **Multiple VODs** | Yes, support multiple full VODs per project |
| **Transcription** | Per-chapter extraction (not full VOD) |

## UI Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Project: "My Video"                      [Import] [Export] │
├────────────────────────────┬───────────────────────────────┤
│ 📹 Chapters                │  Main View (Contextual)       │
│                            │                               │
│ Stream 1: vod_001.mp4      │  [No chapter selected]        │
│ ├── ○ Chapter 1 (2:34)     │  or                           │
│ ├── ○ Chapter 2 (1:45) ⬅️  │  [Timeline with beats]        │
│ └── ○ Chapter 3 (3:12)     │                               │
│                            │                               │
│ Stream 2: vod_002.mp4      │                               │
│ ├── ○ Chapter 4 (5:30)     │                               │
│ └── ○ Chapter 5 (1:20)     │                               │
│                            │                               │
│ ─────────────────────────  │                               │
│ 📁 Individual Files        │                               │
│ ├── ○ intro_clip (0:45)    │                               │
│ └── ○ outro_clip (1:10)    │                               │
│                            │                               │
│ [+ Import VOD/Files]       │                               │
└────────────────────────────┴───────────────────────────────┘
```

## Implementation Phases

1. **Phase 1: Settings & Foundation** - Settings, IPC exposure, state management
2. **Phase 2: Import Flows** - ImportChoice, ChapterDefinition, chapter creation
3. **Phase 3: UI Organization** - Drag-and-drop, ProjectDetail redesign, ChapterPanel
4. **Phase 4: Smart Features** - Auto-naming, multiple VODs, transcription, beats
5. **Phase 5: Integration & Testing** - Full testing of both paths

## Current Architecture Issues

1. **Chapters exist in backend but frontend can't access them** - Preload API doesn't expose chapter operations
2. **Chapter-asset linking is many-to-many but only uses first asset** - Works for our use case but needs clarification
3. **Chapter times are absolute seconds** - Must be relative to linked asset (0 to duration)
4. **AI agent is chapter-centric** - But UI currently bypasses chapters entirely (Assets → Clips)
5. **Transcription happens at chapter level** - Not asset level, which is correct for our design

## Files

- [01-phase-1-settings-foundation.md](./01-phase-1-settings-foundation.md) - Phase 1 details
- [02-phase-2-import-flows.md](./02-phase-2-import-flows.md) - Phase 2 details
- [03-phase-3-ui-organization.md](./03-phase-3-ui-organization.md) - Phase 3 details
- [04-phase-4-smart-features.md](./04-phase-4-smart-features.md) - Phase 4 details
- [05-phase-5-integration-testing.md](./05-phase-5-integration-testing.md) - Phase 5 details
