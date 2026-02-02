# Phase 5: Integration & Testing

## Tasks

### 16. Test Both Import Paths with Multiple VODs Scenario
**Priority:** Low  
**Type:** Testing & Validation

## Test Scenarios

### Scenario A: Import Full VOD Path
**Steps:**
1. Create new project
2. Select "Import Full VOD"
3. Choose a 2-hour VOD file
4. Wait for asset creation
5. Define chapters using timeline scrubber:
   - Chapter 1: 0:00 - 15:00 (Intro)
   - Chapter 2: 15:00 - 45:00 (Main Content)
   - Chapter 3: 45:00 - 2:00:00 (Outro)
6. Click "Create All"
7. Verify:
   - 3 chapters created in DB
   - All linked to VOD asset
   - Transcription started for each
   - Chapters appear in sidebar grouped under VOD
   - Can select each chapter and view timeline
   - Auto-naming generates titles (if enabled)

### Scenario B: Import Individual Files Path
**Steps:**
1. Create new project
2. Select "Import Individual Files"
3. Drop 5 video files:
   - intro.mp4
   - segment_1.mp4
   - segment_2.mp4
   - bonus.mp4
   - outro.mp4
4. Verify:
   - 5 assets created
   - 5 chapters auto-created with titles:
     - "intro"
     - "segment_1"
     - "segment_2"
     - "bonus"
     - "outro"
   - Chapters linked to respective assets
   - Transcription started for each
   - Chapters appear in "Individual Files" group

### Scenario C: Duplicate Filenames
**Steps:**
1. Import files:
   - clip.mp4
   - clip.mkv
   - clip.mov
2. Verify:
   - Chapters named: "clip", "clip_1", "clip_2"
   - No naming collisions
   - Each chapter linked to correct asset

### Scenario D: Multiple VODs
**Steps:**
1. Import VOD_A.mp4 (3 chapters)
2. Import VOD_B.mp4 (2 chapters)
3. Import individual files (2 chapters)
4. Verify UI shows:
   ```
   📹 VOD_A.mp4
   ├── Chapter 1
   ├── Chapter 2
   └── Chapter 3
   
   📹 VOD_B.mp4
   ├── Chapter 1
   └── Chapter 2
   
   📁 Individual Files
   ├── File 1
   └── File 2
   ```
5. Verify reordering works within groups
6. Verify selecting each chapter shows correct timeline

### Scenario E: Drag-and-Drop Reordering
**Steps:**
1. Have 5 chapters in a VOD group
2. Drag Chapter 5 to position 2
3. Verify:
   - UI updates immediately
   - Order persists after reload
   - Transcript timestamps still correct
   - Timeline displays correctly for reordered chapters

### Scenario F: Auto-Naming
**Steps:**
1. Enable auto-naming in settings
2. Import VOD and create chapters
3. Wait for transcription
4. Verify:
   - Chapters get AI-generated titles
   - Titles are 3-5 words
   - Titles reflect content
5. Disable auto-naming
6. Import another VOD
7. Verify chapters get default names ("Chapter 1", etc.)

### Scenario G: Transcription Accuracy
**Steps:**
1. Import VOD, create 3 chapters with precise boundaries
2. Wait for transcription
3. Verify:
   - Each chapter's transcript starts at correct timestamp
   - No overlap between chapters
   - Full coverage (no gaps if chapters are contiguous)
   - Transcript text actually matches video content

### Scenario H: Chapter to Timeline Workflow
**Steps:**
1. Select a chapter
2. AI generates beats (or manually create some)
3. View beats in BeatPanel
4. Apply a beat to create timeline clip
5. Verify:
   - Clip appears in timeline at correct position
   - Clip has correct in/out points
   - Clip references correct asset
   - Can export timeline with clip

## Automated Testing (Future)

### Unit Tests to Add
```typescript
// chapters.svelte.ts
- createChapter creates DB record
- selectChapter updates state
- reorderChapters persists order
- autoCreateChaptersFromFiles generates correct titles

// ChapterDefinition.svelte
- Mark Start/End updates selection
- Add Chapter creates draft
- Draft chapters don't save to DB
- Create All persists to DB

// ChapterPanel.svelte
- Groups chapters by asset
- Click selects chapter
- Delete removes from DB
- Drag-and-drop updates order
```

### Integration Tests
```typescript
// Full workflows
- VOD import creates chapters correctly
- Files import auto-creates chapters
- Transcription runs per-chapter
- Auto-naming generates titles
- Reordering persists correctly
```

## Performance Testing

### Large VOD Test
- Import 8-hour VOD
- Create 20 chapters
- Measure:
  - Asset creation time
  - Chapter creation time
  - Timeline responsiveness
  - Transcription queue processing

### Many Chapters Test
- Import 100 individual files
- Verify:
  - UI performance (no lag)
  - Scroll performance in sidebar
  - Memory usage
  - Transcription queue handling

## Edge Cases to Test

1. **Empty chapter name:** What if title is empty string?
2. **Very long filenames:** How does UI handle 200-char filenames?
3. **Unicode filenames:** Non-ASCII characters in filenames
4. **Zero-duration chapters:** Start = End time
5. **Negative timestamps:** Start < 0
6. **Overlapping chapters:** Two chapters with same time range
7. **Deleted asset:** Chapter linked to deleted asset
8. **Network interruption:** During transcription
9. **Concurrent edits:** Multiple windows editing same project

## Regression Testing

Ensure existing features still work:
- [ ] Regular asset import still works
- [ ] Clip creation still works
- [ ] Timeline editing still works
- [ ] Export still works
- [ ] AI chat still works
- [ ] Settings persist correctly

## Documentation

### User Documentation to Create
1. **Quick Start Guide:**
   - How to import VOD and create chapters
   - How to import individual files
   - How to reorder chapters

2. **Settings Reference:**
   - Auto-naming enabled/disabled
   - Model selection
   - Auto-transcribe on import

3. **FAQ:**
   - "Why are my chapters named 'Chapter 1'?" → Enable auto-naming
   - "Can I merge chapters?" → Not in MVP
   - "Can I split a chapter?" → Delete and recreate

---

## Success Criteria

- [ ] All test scenarios pass
- [ ] No critical bugs
- [ ] UI is responsive with large projects
- [ ] Documentation complete
- [ ] User can successfully:
  - Import a VOD and define chapters
  - Import individual files as chapters
  - Reorder chapters via drag-and-drop
  - Get auto-generated chapter titles
  - View beats for each chapter
  - Convert beats to timeline clips
  - Export final video

---

## Testing Checklist

### Pre-Release Testing
- [ ] Test on macOS
- [ ] Test on Windows
- [ ] Test on Linux
- [ ] Test with various video formats (MP4, MKV, MOV, AVI)
- [ ] Test with large files (>4GB)
- [ ] Test with long filenames (>100 chars)
- [ ] Test with special characters in filenames
- [ ] Test with non-English filenames

### Beta User Testing
- [ ] Recruit 3-5 beta users
- [ ] Provide test VODs and files
- [ ] Gather feedback on:
  - Import flow clarity
  - Chapter definition UX
  - Auto-naming quality
  - Overall workflow
- [ ] Iterate based on feedback

### Final Validation
- [ ] All tests pass
- [ ] No open critical issues
- [ ] Documentation complete
- [ ] Ready for release
