# DaVinci Resolve Cut Page Timeline Features Research

## Executive Summary

DaVinci Resolve's Cut Page is designed for speed and efficiency in editing, particularly for tight deadlines and fast turnaround projects. It introduces innovative timeline features that differ from traditional NLEs (Non-Linear Editors) like Premiere Pro or Final Cut Pro.

**Key Philosophy**: "Action-based" editing where every click does something, eliminating wasted time on media management and tool selection.

---

## 1. Core Timeline Cutting Features

### 1.1 Dual Timeline Design

**Concept**: Two timelines displayed simultaneously:
- **Upper Timeline**: Shows the entire program (full timeline overview)
- **Lower Timeline**: Shows a zoomed-in area where you're working

**Benefits**:
- Never need to zoom in/out repeatedly
- Trim tools always work at perfect zoom level
- See both edit point and full timeline simultaneously
- Both timelines are fully functional
- Can drag clips between timelines to move anywhere in edit

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - This is the signature Cut Page feature
- Implementation complexity: Medium-High
- Requires synchronized rendering of two timeline views
- Can start with simpler version: mini-map + main timeline

### 1.2 Automatic Trim Tools

**How it works**:
- Move mouse around edit point
- Trim tool selected automatically based on mouse position
- Mouse cursor changes to indicate selected tool
- Trim editor appears in viewer when trimming starts

**Trim Modes**:
1. **Trim In/Out**: Drag left/right of transition point
2. **Roll Edit**: Click middle of transition, slide forward/back
3. **Slip**: Click slip icon at clip midpoint, changes content without changing duration
4. **Slide**: Shift+slip, moves clip without affecting duration (neighbor clips adjust)
5. **Duration**: Click edge of transition icon to adjust transition length

**Visual Feedback**:
- Mouse cursor changes based on tool selected
- Trim editor shows A/B clips in filmstrip format
- Frame counters for precise editing
- Audio waveform magnifies during audio trim

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Automatic trim selection is core to "fast editing"
- Implementation complexity: Medium
- Can start with basic trim/drag, add roll/slip/slide later
- Cursor changes and visual feedback should be implemented from start

### 1.3 Smart Indicator & Intelligent Editing

**Smart Indicator**:
- Points to where edits will be performed
- Moves from edit to edit as you scroll timeline
- Eliminates need to set in/out points most of the time

**Intelligent Edit Modes** (work without in/out points):
1. **Smart Insert**: Insert clip at nearest edit point, timeline ripples
2. **Append at End**: Add clip to end of timeline regardless of playhead
3. **Place On Top**: Add clip to next upper track at current scroll position
4. **Ripple Overwrite**: Replace clip with new clip, adjust timeline length
5. **Source Overwrite**: Add synchronized cutaway on track above

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Speed-focused editing requires fewer clicks
- Implementation complexity: Medium
- Smart indicator is innovative but complex to implement correctly
- Can start with simpler: drag-to-playhead insertion
- Add smart indicator in Phase 3b after basic timeline works

### 1.4 Clip Selection & Manipulation

**Selection Patterns**:
- Click to select clip
- Drag clip middle to move
- Drag clip edges to resize (trim)
- Multiple selection mode (Ctrl/Cmd+click for non-contiguous, Shift+click for range)

**Clip Manipulation**:
- Move clips within timeline
- Resize clips (trim in/out)
- Move clips between tracks
- Drag from media pool to timeline

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Basic clip manipulation is fundamental
- Implementation complexity: Low-Medium
- Should implement single clip selection first, add multiple in Phase 3b

### 1.5 Multi-Track Audio Handling

**Display**:
- Audio tracks displayed below video tracks
- Waveforms shown in audio clips
- Track headers with mute/solo controls
- Volume meters displayed

**Controls**:
- Mute button per track
- Solo button per track
- Volume adjustment handles on clips
- Pan controls

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Basic multi-track support needed
- Implementation complexity: Low-Medium
- Can start with simple waveform display, add mute/solo later
- Volume/pan controls can be Phase 3b

---

## 2. User Experience Patterns

### 2.1 Zoom Controls

**DaVinci Approach**:
- Dual timeline eliminates need for zoom in/out
- No horizontal/vertical scroll bars in Cut Page
- Search dial (hardware) controls zoom level
- Lower timeline always at perfect zoom for trimming

**Traditional Alternatives**:
- Scroll wheel to zoom (other NLEs)
- Zoom slider at bottom of timeline
- Keyboard shortcuts (+/-) for zoom

**Feasibility Assessment**:
- ⚠️ **Optional for Phase 3a** - Dual timeline handles most zoom needs
- Implementation complexity: Low
- Recommend: Add scroll-to-zoom as basic option
- Full dual timeline can be MVP feature

### 2.2 Timeline Navigation

**Horizontal Scrolling**:
- Mouse drag on timeline to scroll
- Search dial (hardware) for precise control
- Keyboard arrow keys
- Click on upper timeline to jump to that location

**Jump to Cursor**:
- "View All" button to see full timeline
- "Fit to Window" option
- Scroll to specific timecode

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Basic navigation is required
- Implementation complexity: Low
- Mouse drag + keyboard shortcuts should be implemented
- "View All" and timecode jump can be Phase 3b

### 2.3 Undo/Redo Behavior

**DaVinci Approach**:
- Standard undo/redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
- Full history maintained
- Can undo through multiple operations
- Redo stack maintained until new action

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Undo/redo is safety net for editing
- Implementation complexity: Low-Medium
- Standard pattern, implement early

### 2.4 Delete vs Remove vs Ripple Delete

**DaVinci Cut Page Actions**:
1. **Delete Backspace**: Removes clip, leaves gap (black/empty space)
2. **Ripple Delete (Delete)**: Removes clip, closes gap, timeline ripples
3. **Close Up Gap**: Right-click, Close Up (manually closes gap after clip removal)

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Ripple delete is crucial for efficient editing
- Implementation complexity: Low
- Implement both delete modes from start
- Right-click context menu can be Phase 3b

---

## 3. Waveform Display

### 3.1 Waveform Visualization

**Display Characteristics**:
- Waveforms shown in audio clips on timeline
- Resolution scales with zoom level
- Color coding for audio levels (typically green/yellow for standard, red for clipping)
- Magnified waveform view during audio trim

**Quality/Resolution**:
- Dynamic resolution based on zoom
- Low-res at overview level, high-res when zoomed in
- Smooth scaling between resolutions
- Performance optimization for long clips

### 3.2 Color Coding

**DaVinci Approach**:
- Green: Normal audio levels
- Yellow: Warning levels (approaching clipping)
- Red: Clipping/distortion
- Gradient transitions between levels

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Waveforms are crucial for audio editing
- Implementation complexity: Medium
- Basic waveform display can be simple
- Dynamic resolution is performance optimization (can be basic version initially)
- Color coding can be simple (green/red) initially, add gradients in Phase 3b

### 3.3 Performance Considerations

** optimizations DaVinci Uses**:
- Cached waveform data
- Progressive loading for long clips
- Skip samples without sacrificing visual accuracy
- GPU-accelerated rendering

**For Our Implementation**:
- Can use simplified waveform generation (FFmpeg or Web Audio API)
- Cache waveform data per clip
- Use canvas for efficient rendering
- Implement basic LOD (Level of Detail) system

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Waveforms needed for rough cutting
- Implementation complexity: Medium
- Can start with basic waveform, optimize in Phase 3b
- Don't need DaVinci-level performance initially

---

## 4. What Makes it "Fast" and "Easy"

### 4.1 Keyboard Shortcuts

**DaVinci Cut Page Shortcuts**:
```
- Space: Play/Pause
- J/K/L: Reverse/Pause/Forward (variable speed)
- Tab: Jump to next edit
- Shift+Tab: Jump to previous edit
- I: Mark In
- O: Mark Out
- F: Match frame
- Cmd/Ctrl+B: Ripple Delete
- Cmd/Ctrl+[: Trim Start
- Cmd/Ctrl+]: Trim End
- Cmd/Ctrl+[: Trim Start (Ripple)
- Cmd/Ctrl+]: Trim End (Ripple)
```

**Speed Editor Hardware**:
- Dedicated edit function keys (insert, append, place on top, etc.)
- Search dial for timeline scrubbing
- Transport controls (play, stop, fast forward, rewind)
- Source tape buttons

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Keyboard shortcuts make editing fast
- Implementation complexity: Low
- Implement basic shortcuts (Space, Delete, Tab, etc.)
- Hardware panel support not needed initially (can be future feature)

### 4.2 Right-Click Context Menus

**DaVinci Cut Page Context Menus**:
- Edit clip settings (duration, speed)
- Close up gap
- Make into compound clip
- Enable/disable clip
- Render in place

**Feasibility Assessment**:
- ⚠️ **Optional for Phase 3a** - Nice to have but not core
- Implementation complexity: Low
- Basic context menu can be added quickly
- Advanced options (compound clip, etc.) can be Phase 3b

### 4.3 Drag-and-Drop Interactions

**DaVinci Cut Page Drag & Drop**:
- Drag from media pool to timeline (append, insert, place on top)
- Drag clips within timeline to move
- Drag clip edges to trim
- Drag clips between tracks
- Drag from source tape to timeline

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Drag-and-drop is intuitive
- Implementation complexity: Low-Medium
- Support basic drag-to-timeline initially
- Advanced drag modes (append vs insert vs place on top) can be Phase 3b

### 4.4 Snap/Alignment Features

**DaVinci Cut Page Snapping**:
- Automatic snapping to edit points
- Snapping to playhead
- Snapping to clip boundaries
- Visual indicators when snap occurs
- Toggle on/off

**Feasibility Assessment**:
- ✅ **Essential for Phase 3a** - Snapping makes editing precise
- Implementation complexity: Low-Medium
- Basic snapping to edit points should be implemented
- Advanced snapping (snap to markers, etc.) can be Phase 3b

---

## 5. Feasibility Assessment & Recommendations

### 5.1 Essential Features for Phase 3a (Basic Cutting View)

**Must-Have for MVP Timeline Editor:**

1. **Basic Timeline Display**
   - Single timeline view (simplified dual timeline if possible)
   - Timecode ruler
   - Track headers (video/audio)
   - Zoom/scroll support

2. **Clip Display & Selection**
   - Video clips with thumbnails
   - Audio clips with waveforms
   - Clip selection (single)
   - Clip dragging (move, resize)

3. **Basic Trimming**
   - Drag edges to trim
   - Drag middle to move
   - Visual feedback (cursor changes, selection highlighting)

4. **Basic Edit Operations**
   - Delete (leave gap)
   - Ripple delete (close gap)
   - Undo/redo

5. **Waveform Display**
   - Basic waveform visualization
   - Simple color coding
   - Cached for performance

6. **Timeline Navigation**
   - Horizontal scroll
   - Zoom in/out (scroll wheel or slider)
   - Jump to time/playhead

7. **Basic Drag-and-Drop**
   - Drag from media pool to timeline
   - Move clips within timeline

8. **Basic Snapping**
   - Snap to edit points
   - Visual snap indicators

### 5.2 Features for Phase 3b (Advanced Timeline)

**Nice-to-Have for Second Implementation:**

1. **Dual Timeline**
   - Full implementation of upper/lower timeline
   - Synchronized zoom and scroll

2. **Advanced Trimming**
   - Roll edit
   - Slip/slide
   - Trim editor (A/B viewer)
   - Audio magnification during trim

3. **Smart Indicator & Intelligent Editing**
   - Smart indicator implementation
   - Smart insert, append at end, place on top
   - Ripple overwrite, source overwrite

4. **Multiple Selection**
   - Multi-select clips
   - Batch operations
   - Group clips

5. **Advanced Audio Controls**
   - Mute/solo per track
   - Volume handles on clips
   - Pan controls
   - Audio meter enhancements

6. **Context Menus**
   - Right-click context menus
   - Clip operations

7. **Advanced Snapping**
   - Snap to markers
   - Snap to playhead
   - Snap preferences

8. **Transition Support**
   - Add transitions between clips
   - Adjust transition duration
   - Transition types (dissolve, etc.)

### 5.3 Features to Skip Initially

**Too Complex for First Implementation:**

1. **Hardware Panel Support**
   - Search dial input
   - Speed Editor hardware integration
   - Can be future feature for power users

2. **Advanced Effects**
   - Speed ramps
   - Stabilization
   - Lens correction
   - These are better in full NLE

3. **Advanced Audio Features**
   - Audio keyframing
   - VST/au plugins
   - Advanced mixing (EQ, compression)
   - Use Fairlight page or dedicated DAW

4. **Multi-Cam Sync Bin**
   - Complex feature specific to multicam workflows
   - Can be future enhancement

5. **Boring Shot Detection**
   - AI-powered feature
   - Nice to have but not essential

6. **Compound Clips**
   - Advanced organization feature
   - Can be added later

7. **Advanced Keyframing**
   - Keyframe editor in timeline
   - Can be Phase 4 or later

### 5.4 Recommended Interactions and Shortcuts

**Minimal Set for Phase 3a:**

```
Keyboard Shortcuts:
- Space: Play/Pause
- Ctrl/Cmd+Z: Undo
- Ctrl/Cmd+Shift+Z: Redo
- Delete: Ripple Delete
- Backspace: Delete (leave gap)
- Ctrl/Cmd+X: Cut
- Ctrl/Ctrl+V: Paste
- Ctrl/Ctrl+C: Copy
- Ctrl/Ctrl+A: Select All
- Arrows: Move playhead
- Tab: Jump to next edit
- Shift+Tab: Jump to previous edit
- +/-: Zoom in/out
- Home/End: Jump to start/end of timeline
```

**Mouse Interactions:**

```
- Click: Select clip
- Drag clip middle: Move clip
- Drag clip edge: Trim clip
- Scroll wheel: Zoom in/out
- Shift+Scroll: Horizontal scroll
- Ctrl/Cmd+Scroll: Vertical scroll (tracks)
- Click+Drag on ruler: Select range
- Double-click clip: Open in viewer (future)
```

**Visual Feedback:**

```
- Cursor changes:
  - Arrow: Default
  - Resize left/right: Trim edge (|)
  - Move: Drag clip (Move arrow)
  - Grab: Drag timeline (Open hand)

- Selection highlighting:
  - Selected clip: Yellow/Orange border
  - Hover: Lighter highlight
  - Trim edges: Highlighted when hovering

- Snap indicators:
  - Vertical line showing snap point
  - Magnet icon when snap enabled
```

---

## 6. Architecture Recommendations

### 6.1 Timeline Data Structure

```typescript
interface Timeline {
  id: string;
  name: string;
  duration: number; // in frames or milliseconds
  tracks: Track[];
  currentTime: number;
  zoomLevel: number;
}

interface Track {
  id: string;
  type: 'video' | 'audio';
  name: string;
  index: number;
  clips: Clip[];
  muted: boolean;
  solo: boolean;
  locked: boolean;
}

interface Clip {
  id: string;
  sourceId: string; // Reference to media asset
  name: string;
  type: 'video' | 'audio';
  trackId: string;
  startTime: number; // Timeline position
  duration: number;
  inPoint: number; // Source frame/time
  outPoint: number;
  selected: boolean;
  thumbnail?: string;
  waveform?: WaveformData;
}
```

### 6.2 Rendering Strategy

**Canvas-based Rendering**:
- Use HTML5 Canvas for timeline view
- Efficient redrawing with requestAnimationFrame
- Offscreen canvas for waveforms
- Progressive loading for long timelines

**Optimization Techniques**:
- Virtual scrolling (only render visible clips)
- LOD system for waveform detail
- Caching clip thumbnails
- Debounced rendering during drag operations

### 6.3 State Management

**Use Svelte 5 Runes**:
```typescript
$state timeline = {};
$derived clips = timeline.tracks.flatMap(t => t.clips);
$effect(() => {
  // Redraw timeline when clips change
});
```

**Optimization**:
- Batch state updates during drag operations
- Throttle clip position updates
- Use immutable updates for undo/redo

---

## 7. Minimum Viable Timeline Editor Specification

### 7.1 UI Layout

```
┌─────────────────────────────────────────┐
│ Timeline Toolbar                         │
│ [Zoom Slider] [View All] [Snapping]    │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ Track Headers                       │ │
│ │ V1  V2  A1  A2                      │ │
│ ├─────────────────────────────────────┤ │
│ │                                     │ │
│ │      Timeline View                  │ │
│ │  ┌──────┐    ┌──────┐              │ │
│ │  │ Clip │    │ Clip │              │ │
│ │  └──────┘    └──────┘              │ │
│ │                                     │ │
│ │  ▽ Playhead                         │ │
│ ├─────────────────────────────────────┤ │
│ │ Timecode Ruler                      │ │
│ │ 00:00:00    00:00:10    00:00:20   │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 7.2 Core Features Specification

**Timeline View**:
- Render clips as rectangles with thumbnails
- Show waveform for audio clips
- Timecode ruler at bottom
- Track headers on left
- Playhead indicator

**Clip Interaction**:
- Click to select (highlight)
- Drag to move (constrain to track)
- Drag edges to trim
- Support video/audio tracks

**Edit Operations**:
- Delete (remove clip, leave gap)
- Ripple Delete (remove clip, close gap)
- Undo/Redo (full history)

**Navigation**:
- Scroll horizontal to move through timeline
- Scroll (or zoom slider) to scale view
- Click on ruler to jump playhead

**Snapping**:
- Clip edges snap to other clip edges
- Optional toggle on/off
- Visual indicator when snap occurs

**Waveform**:
- Basic waveform display for audio
- Static resolution (cached)
- Simple color coding (green for normal)

**Keyboard Shortcuts**:
- Space: Play/Pause
- Delete: Ripple Delete
- Backspace: Delete (leave gap)
- Ctrl/Cmd+Z: Undo
- Tab: Jump to next edit
- Shift+Tab: Jump to previous edit

### 7.3 Performance Targets

- Smooth playback at 60fps
- < 100ms response time for drag operations
- Support 1000+ clips on timeline
- Waveform generation < 1 second per minute of audio
- Undo/redo < 50ms per operation

---

## 8. Conclusion

DaVinci Resolve's Cut Page offers innovative timeline features designed specifically for speed and efficiency. The dual timeline, automatic trim tools, and intelligent editing modes represent a significant departure from traditional NLE workflows.

**Key Takeaways for VOD Pipeline**:

1. **Start Simple**: Basic timeline with clip manipulation, trimming, and undo/redo
2. **Add Speed Features**: Snapping, keyboard shortcuts, drag-and-drop
3. **Avoid Complexity**: No hardware panels, no advanced effects, no multicam initially
4. **Optimize for Rough Cuts**: Focus on speed over precision perfect editing
5. **Export to Pro NLE**: Users can refine in DaVinci/Premiere/FCP

**Recommended Implementation Timeline**:

- **Phase 3a**: Basic timeline editor (2-3 weeks)
  - Single timeline view
  - Clip selection, move, trim
  - Delete/ripple delete
  - Basic waveforms
  - Undo/redo

- **Phase 3b**: Advanced timeline features (2-3 weeks)
  - Dual timeline
  - Advanced trimming (roll/slip/slide)
  - Multiple selection
  - Smart indicator
  - Mute/solo tracks

- **Phase 4+:** Professional features (future)
  - Hardware panel support
  - Advanced effects
  - Multicam sync bin
  - Compound clips
  - Keyframing

The rough-cut timeline should be fast, intuitive, and focused on narrative assembly. Advanced editing features can be deferred to professional NLEs where users will export for final refinement.
