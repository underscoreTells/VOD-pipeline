# Timeline Editing Libraries for Svelte 5 & Electron - Research

**Date:** January 26, 2026
**Project:** VOD Pipeline - AI-Assisted Video Editor

## Executive Summary

After researching multiple timeline editing and video visualization libraries, we have identified several viable options for implementing a timeline component in our Svelte 5 + Electron video editor application.

**Top Recommendations:**

1. **Custom Canvas-Based Timeline** (Recommended Build-From-Scratch Approach)
   - Maximum control and performance
   - Perfect fit for Electron + Svelte 5
   - Supports exact VOD editing requirements

2. **wavesurfer.js with Regions Plugin**
   - Excellent for audio waveform visualization
   - Active maintenance (10.1k GitHub stars, 2 months ago)
   - Built-in timeline and region support
   - TypeScript support included

3. **vis-timeline**
   - Framework-agnostic, works with any JavaScript framework
   - Large community (2.4k GitHub stars, 3k+ dependents)
   - Good for general timeline visualization

4. **@xzdarcy/react-timeline-editor / melies-video-editor**
   - Specialized for timeline editing
   - Built on React - can be integrated via wrapper
   - 614+ stars, 5 dependents

## 1. Library Comparison Table

| Library | Type | Language | Stars | Last Update | Svelte 5 Compatible | Multi-Track | Waveforms | Clip Manip | Zoom/Pan | Keyboard Shortcuts | License |
|---------|------|----------|-------|-------------|---------------------|-------------|------------|------------|----------|-------------------|---------|
| **wavesurfer.js** | Audio Player | TS | 10.1k | 2 months ago | ✓ | Plugins only | ✓ ✓ ✓ | Via Regions Plugin | ✓ | Limited (via plugins) | BSD-3-Clause |
| **vis-timeline** | Timeline Chart | JS | 2.4k | 1 month ago | ✓ | ✓ | Custom | ✓ ✓ | ✓ | Limited | Apache-2.0 / MIT |
| **@xzdarcy/react-timeline-editor** | Animation Timeline | TS | 614 | 1 day ago | Via adapter | ✓ | Custom | ✓ ✓ ✓ | ✓ | ✓ | MIT |
| **melies-video-editor** | Video Timeline | TS | N/A | 2 days ago | Via adapter | ✓ | Custom | ✓ ✓ ✓ | ✓ | ✓ | MIT |
| **@twick/video-editor** | Video Editor | TS | Low | 4 days ago | Via adapter | ✓ | Custom | ✓ ✓ ✓ | ✓ | ✓ | Proprietary |
| **@diffusionstudio/core** | Video Engine | TS | N/A | 2 months ago | ✓ | ✓ | Custom | ✓ ✓ ✓ | ✓ | ✓ | MPL-2.0 / Watermark |
| **wx-svelte-gantt** | Gantt Chart | Svelte | Low | 13 hours ago | ✓ ✓ | ✓ | No | ✓ ✓ | ✓ | ✓ | MIT |
| **Tone.js** | Audio Framework | TS | N/A | 5 days ago | ✓ | ✓ | Custom | Limited | Limited | ✓ | MIT |
| **vjs-video** | Video.js Directive | JS | 57/week | 8 years ago | ✗ (Angular) | ✗ | No | No | No | No | MIT |
| **Custom Canvas** | Build-from-scratch | TS | N/A | N/A | ✓ ✓ | ✓ | ✓ (via FFmpeg) | ✓ ✓ | ✓ | ✓ | MIT |

---

## 2. Detailed Library Analysis

### 2.1 wavesurfer.js ⭐ Highly Recommended for Audio

**Repository:** https://github.com/katspaugh/wavesurfer.js
**NPM:** https://www.npmjs.com/package/wavesurfer.js
**Version:** 7.12.1 (published 2 months ago)
**Weekly Downloads:** 463,238
**Stars:** 10.1k
**License:** BSD-3-Clause

#### Capabilities

- **Framework-agnostic:** Works with any framework including Svelte
- **Waveform Rendering:** High-performance canvas-based waveform visualization
- **Plugins Ecosystem:**
  - **Regions Plugin:** Visual overlays and markers for audio regions
  - **Timeline Plugin:** Displays notches and time labels below waveform
  - **Minimap Plugin:** Scrollable waveform overview
  - **Hover Plugin:** Vertical line and timestamp on hover
  - **Envelope Plugin:** Graphical interface for fade-in/out effects
  - **Spectrogram Plugin:** Audio frequency spectrum visualization
  - **Record Plugin:** Microphone recording with waveform

#### Pros

✅ Excellent performance with canvas rendering
✅ Active maintenance and large community
✅ TypeScript support built-in (no need for @types)
✅ Shadow DOM isolation - clean CSS integration
✅ Plugin architecture for extensibility
✅ Supports large files via pre-decoded peaks
✅ Frame-accurate positioning
✅ Responsive design

#### Cons

❌ Primarily focused on audio, not video
❌ Multi-track support requires manual implementation
❌ No built-in video clip manipulation
❌ No keyboard shortcut defaults
❌ Waveform generation required before playback

#### Svelte 5 Compatibility

**✅ Excellent** - Works seamlessly with Svelte 5 runes API

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js';
  import Timeline from 'wavesurfer.js/dist/plugins/timeline.esm.js';

  let container: HTMLDivElement;
  let wavesurfer: WaveSurfer;
  let regions: Regions;

  const timelineData = $state({
    regions: [] as { id: string; start: number; end: number; color: string }[]
  });

  onMount(async () => {
    wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#4F4A85',
      progressColor: '#383351',
      url: '/audio.mp3',
      height: 200,
      barWidth: 2,
      barGap: 3,
    });

    // Initialize timeline plugin
    const timeline = wavesurfer.registerPlugin(Timeline());
    
    // Initialize regions plugin
    regions = wavesurfer.registerPlugin(Regions());

    // Add regions from database
    regions.on('region-updated', (region) => {
      timelineData.regions = regions.getRegions();
    });

    // Load chapter audio
    await wavesurfer.load('/chapter1.mp3');
  });

  function addRegion(start: number, end: number) {
    regions.addRegion({
      start,
      end,
      color: 'rgba(255, 0, 0, 0.3)',
    });
  }
</script>

<div bind:this={container} class="waveform-container"></div>
```

#### Electron Considerations

⚠️ **Note:** For large audio files, wavesurfer.js recommends using pre-decoded peaks to avoid memory constraints. In Electron, you can:

1. Generate waveforms server-side using FFmpeg/audiowaveform
2. Cache peaks in SQLite database
3. Load peaks directly without full audio decode

```typescript
// Generate peaks using FFmpeg (in Electron main process)
import { exec } from 'child_process';

async function generateWaveformPeaks(audioPath: string, peaksPath: string) {
  return new Promise((resolve, reject) => {
    exec(
      `audiowaveform -i "${audioPath}" -o "${peaksPath}" --pixels-per-second 5 --bits 8`,
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

// Load pre-decoded peaks in renderer
import WaveSurfer from 'wavesurfer.js';

const wavesurfer = WaveSurfer.create({
  container: '#waveform',
  url: '/chapter1.mp3',
  peaks: await fetch('/peaks/chapter1.dat').then(r => r.json()),
});
```

#### Performance with Long Videos

For hour+ videos in Electron:
- Use pre-decoded peaks (essential for performance)
- Implement windowed rendering (only render visible portion)
- Cache peaks in database for instant loading
- Consider downsampling for overview timeline

---

### 2.2 vis-timeline ⭐ Highly Recommended for General Timeline

**Repository:** https://github.com/visjs/vis-timeline
**NPM:** https://www.npmjs.com/package/vis-timeline
**Version:** 8.5.0 (published 1 month ago)
**Weekly Downloads:** 109,809
**Stars:** 2.4k
**Dependencies:** 69
**License:** Apache-2.0 OR MIT

#### Capabilities

- **Framework-agnostic timeline visualization**
- Supports items and ranges (time intervals)
- Drag, zoom, pan interactions
- Multiple build options: standalone, peer, ESNext
- Moment.js for time handling
- HTML5 Canvas and DOM hybrid rendering

#### Pros

✅ Large community and battle-tested
✅ Excellent documentation and examples
✅ Highly customizable
✅ Works with any framework
✅ Multiple build formats for different use cases
✅ Good performance with large datasets
✅ Time_scale from milliseconds to years

#### Cons

❌ Not designed specifically for video editing
❌ No built-in waveform visualization
❌ Focuses on general timelines, not media editing
❌ Requires manual implementation of editing features
❌ DOM-heavy (can be slow with many items)

#### Svelte 5 Compatibility

**✅ Good** - Works with Svelte 5, but requires careful state management

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Timeline } from 'vis-timeline/standalone';
  import type { DataGroup, DataItem } from 'vis-timeline/standalone';

  let container: HTMLDivElement;
  let timeline: Timeline;
  
  const chapters = $state<DataItem[]>([
    { id: 1, content: 'Chapter 1', start: 0, end: 300 }  // 0-5 min
  ]);
  
  const tracks = $state<DataGroup[]>([
    {
      id: 'video-track',
      content: 'Video Track',
      order: 0,
    },
    {
      id: 'audio-track',
      content: 'Audio Track',
      order: 1,
    },
  ]);

  onMount(() => {
    const options = {
      height: 300,
      groupOrder: 'order',
      editable: {
        add: false,
        updateTime: true,
        updateGroup: true,
        remove: false,
        overrideItems: false,
      },
      zoomMin: 1000,  // 1 second
      zoomMax: 1000000000,  // ~11 days
      format: {
        minorLabels: {
          millisecond: 'SSS',
          second: 's:SS',
          minute: 'HH:mm:ss',
          hour: 'HH:mm',
        },
        majorLabels: {
          millisecond: 'HH:mm:ss',
          second: 'D HH:mm:ss',
          minute: 'ddd D MMMM',
          hour: 'ddd D MMMM',
        },
      },
    };

    timeline = new Timeline(container, chapters, tracks, options);

    // Listen for changes
    timeline.on('rangechanged', (properties) => {
      // Handle zoom/pan
    });

    timeline.on('itemupdate', (properties) => {
      // Update chapter in database
    });
  });

  function addChapter(start: number, end: number) {
    const id = items.length + 1;
    chapters = [
      ...chapters,
      { id, content: `Chapter ${id}`, start, end, group: 'video-track' }
    ];
    timeline.setItems(chapters);
  }
</script>

<div bind:this={container} class="timeline-container"></div>
```

#### Electron Considerations

⚠️ **Note:** vis-timeline uses Moment.js which can add bundle size. For Electron apps:

- Use the peer or ESNext build to avoid duplicate dependencies
- Consider using a lighter date library like dayjs if you extract functionality
- Good for representing chapter structure, but not granular editing

#### Performance with Long Videos

For hour+ timelines:
- Canvas rendering is optimized, but DOM items can slow down
- Recommend virtualizing/clipping for very large item counts
 vis-timeline handles large datasets reasonably well (1000+ items tested)

---

### 2.3 @xzdarcy/react-timeline-editor / melies-video-editor

**Repositories:** 
- https://github.com/xzdarcy/react-timeline-editor
- https://www.npmjs.com/package/melies-video-editor

**Stars:** 614 (xzdarcy)
**License:** MIT
**Type:** TypeScript React Components

#### Capabilities

**@xzdarcy/react-timeline-editor:**
- Timeline animation editor component
- Actions/effects system
- Drag-and-drop support
- Multiple tracks
- Time-based positioning

**melies-video-editor:**
- Built on top of @xzdarcy/react-timeline-editor
- Video editing GUI
- Integrates with @xzdarcy's timeline library
- Includes demo app with sidebar/editor layout

#### Svelte 5 Compatibility

**⚠️ Requires Adapter Pattern** - These are React components, so they need to be wrapped for Svelte 5.

**Option 1: Use Svelte's `<svelte:component>` with `svelte-preprocess-react`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Timeline } from '@xzdarcy/react-timeline-editor';
  
  let container: HTMLDivElement;
  let timelineComponent: any;  // React component ref

  const timelineData = $state({
    rows: [
      {
        id: "0",
        actions: [
          { id: "action00", start: 0, end: 120, effectId: "effect0" },
        ],
      },
    ],
    effects: {
      effect0: { id: "effect0", name: "Video Clip" },
    },
  });

  onMount(() => {
    // Initialize React component via adapter
    // This requires additional setup code
  });
</script>

<div bind:this={container} class="react-timeline-container"></div>
```

**Option 2: Port Logic to Svelte**

Since the library is MIT licensed, you could:
1. Fork or reference the source code
2. Port the React component logic to Svelte 5
3. Maintain parity with upstream updates

#### Pros

✅ Designed specifically for timeline editing
✅ Active development (committed 1 day ago)
✅ TypeScript support
✅ Multi-track support
✅ Drag-and-drop editing
✅ MIT license (xzdarcy)

#### Cons

❌ React-only component
❌ Requires additional wrapper/adapter layer in Svelte
❌ Limited documentation compared to wavesurfer.js
❌ Not video-focused (animation-focused)

#### Electron Considerations

✅ Works well in Electron as a React component
⚠️ Requires React DOM to work, adds bundle size

#### Overall Assessment

**Not Recommended** for our Svelte 5 project due to React dependency. If we were using React, this would be a strong contender. Consider:

- Using as reference for building our own Svelte timeline
- Forking and porting to Svelte 5 (significant effort)

---

### 2.4 @diffusionstudio/core

**Repository:** https://github.com/diffusionstudio/core
**NPM:** https://www.npmjs.com/package/@diffusionstudio/core
**Version:** 4.0.3 (published 2 months ago)
**Weekly Downloads:** 1,095
**License:** MPL-2.0 / Commercial watermark

#### Capabilities

- Browser-based video composing engine
- Built on WebCodecs API
- Hardware-accelerated processing
- Canvas 2D rendering
- Layering, splitting, effects, transitions
- Keyframing, animations
- Real-time playback and rendering
- TypeScript support

#### Core Features

```typescript
import * as core from "@diffusionstudio/core";

const composition = new core.Composition();

// Concatenate videos
const layer = await composition.add(new core.Layer({ mode: 'SEQUENTIAL' }));
await layer.add(new core.VideoClip(sources[0], { range: [2, 8] }));
await layer.add(new core.VideoClip(sources[1], { range: [2, 12] }));

// Add transitions
new core.VideoClip(source, {
  transition: {
    duration: 1,
    type: 'dissolve',
  }
});

// Add effects
new core.RectangleClip({
  effects: [
    { type: 'blur', value: 10 },
    { type: 'hue-rotate', value: 90 }
  ]
});
```

#### Pros

✅ Framework-agnostic (works with Svelte, Vue, React, etc.)
✅ True video engine (not just visualization)
✅ Hardware-accelerated via WebCodecs
✅ Real-time playback capabilities
✅ Browser-based rendering
✅ TypeScript support

#### Cons

❌ Requires special HTTP headers (COOP, COEP)
❌ Watermark in free version
❌ Commercial license required for production
❌ Primarily focused on rendering, not timeline UI
❌ Still relatively new / smaller community

#### Svelte 5 Compatibility

**✅ Good** - Framework-agnostic, works directly with Svelte 5

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import * as core from '@diffusionstudio/core';

  let canvasContainer: HTMLDivElement;
  let composition: core.Composition;

  onMount(async () => {
    composition = new core.Composition();
    
    // Add video clips from database
    const sources = await Promise.all([
      core.Source.from<core.VideoSource>('/chapter1.mp4'),
      core.Source.from<core.VideoSource>('/chapter2.mp4'),
    ]);

    const layer = await composition.add(new core.Layer({ mode: 'SEQUENTIAL' }));
    
    sources.forEach(source => {
      layer.add(new core.VideoClip(source));
    });

    // Render to canvas
    composition.render(canvasContainer);
  });
</script>

<div bind:this={canvasContainer} class="video-canvas"></div>
```

#### Electron Considerations

⚠️ **Critical:** Diffusion Studio requires specific HTTP headers that may not work in Electron's file:// protocol or custom protocol:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

These headers enable SharedArrayBuffer and WebCodecs. In Electron, you'd need to:
1. Serve content via HTTP server (not file://)
2. Configure headers in your Electron setup
3. This adds complexity to the Electron build

#### Licensing

**Important:** The library has a watermark in the free version. To remove it, you need a commercial license. This could add cost to the project.

#### Overall Assessment

**Potential but with caveats:**
- Powerful video engine, but licensing may be an issue
- HTTP header requirements add Electron complexity
- Don't need full rendering engine (we're using FFmpeg)
- Might be overkill for our timeline visualization needs

---

### 2.5 @twick/video-editor

**NPM:** https://www.npmjs.com/package/@twick/video-editor
**Version:** 0.15.7 (published 4 days ago)
**Weekly Downloads:** 2,527
**License:** Proprietary (Sustainable Use License)

#### Capabilities

- Comprehensive video editing interface
- Multi-track timeline support
- Video preview with custom controls
- Drag-and-drop timeline reordering
- High-performance video rendering
- Real-time project updates
- Text overlay, image/video support
- Audio track management
- Effects and transitions

#### License

⚠️ **Proprietary - Not Recommended**
- "Free for use in commercial and non-commercial apps"
- "Cannot be sold, rebranded, or distributed as a standalone SDK"
- Requires attribution
- Restrictive for open-source projects

#### Svelte 5 Compatibility

**⚠️ React-only** - Requires adapter/bridge for Svelte 5

#### Overall Assessment

**NOT Recommended** due to:
1. Proprietary license restrictions
2. React dependency
3. Lock-in to their ecosystem
4. Attribution requirements

Consider as reference for building our own solution, but avoid direct usage.

---

### 2.6 wx-svelte-gantt

**Repository:** https://github.com/svar-widgets/gantt
**NPM:** https://www.npmjs.com/package/wx-svelte-gantt
**Version:** 2.5.1 (published 13 hours ago)
**Weekly Downloads:** 1,293
**License:** MIT

#### Capabilities

- Native Svelte Gantt chart component
- Interactive drag-and-drop interface
- Hierarchical view of sub-tasks
- Configurable timeline (hours, days, weeks)
- Tooltips, context menus
- Sorting, zooming with scroll
- Hotkeys support
- Light and dark skins
- TypeScript support

#### Pros

✅ **Native Svelte component** - No adapter needed
✅ Active development (13 hours ago)
✅ Good performance with large datasets
✅ Comprehensive feature set
✅ MIT license
✅ TypeScript support
✅ Svelte 5 compatible

#### Cons

❌ Designed for project management, not video editing
❌ Focused on tasks/dates, not timecode-based video editing
❌ No audio/video waveform support
❌ Task-based model, not clip-based

#### Svelte 5 Compatibility

**✅ Excellent** - Native Svelte component

```svelte
<script lang="ts">
  import { Gantt } from '@svar-ui/svelte-gantt';

  const tasks = $state([
    {
      id: 1,
      start: new Date(2024, 3, 2),
      end: new Date(2024, 3, 17),
      text: "Chapter 1",
      progress: 30,
    },
  ]);

  const links = [];  // Dependencies/links between tasks

  const scales = [
    { unit: "minute", step: 5, format: "%H:%M:%S" },
    { unit: "second", step: 1, format: "%S" },
  ];

  function onTaskUpdate(event: any) {
    // Update chapter in database
  }
</script>

<Gantt 
  {tasks} 
  {links} 
  {scales}
  on:taskUpdate={onTaskUpdate}
/>
```

#### Electron Considerations

✅ Works well in Electron
✅ No special requirements

#### Overall Assessment

**Good Option for Svelte 5, but wrong domain:**
- Excellent Svelte component library
- Wrong use case (project management vs video timeline)
- Could be adapted, but significant work required
- Time-based format uses Dates, not timecodes (00:00:00:00)

**Recommendation:** Use as reference for building video-specific timeline, or adapt features as needed.

---

### 2.7 vjs-video

**Repository:** https://github.com/willfarrell/vjs-video
**NPM:** https://www.npmjs.com/package/vjs-video
**Version:** 0.1.11
**Last Update:** 8 years ago
**License:** MIT

#### Analysis

❌ **Not Suitable** - This is an Angular.js directive for Video.js
❌ Dead project (8 years without updates)
❌ Angular-specific, not usable in Svelte
❌ Not a timeline editor - just a video player wrapper

**Verdict:** DISREGARD

---

## 3. Svelte 5 Integration Patterns

### 3.1 Direct JS Integration (Best for Framework-Agnostic Libraries)

Framework-agnostic libraries like wavesurfer.js and vis-timeline work best with Svelte 5 using the runes API:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';

  let container: HTMLDivElement;
  let wavesurfer: WaveSurfer | null = null;

  const currentTime = $state(0);
  const duration = $state(0);
  const isPlaying = $state(false);
  
  // Load from database via IPC
  const chapterData = $state({
    audioPath: '',
    regions: [] as { id: string; start: number; end: number }[]
  });

  onMount(async () => {
    // Initialize wavesurfer
    wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#4F4A85',
      progressColor: '#383351',
      cursorColor: 'rgba(255, 0, 0, 0.5)',
      barWidth: 2,
      barGap: 3,
      height: 200,
      
      // Zoom level (pixels per second)
      minPxPerSec: 50,
      
      // Audio options
      normalize: true,
      backend: 'WebAudio',
    });

    // Listen to events
    wavesurfer.on('audioprocess', (time) => {
      currentTime = time;
    });

    wavesurfer.on('ready', () => {
      duration = wavesurfer!.getDuration();
    });

    wavesurfer.on('play', () => {
      isPlaying = true;
    });

    wavesurfer.on('pause', () => {
      isPlaying = false;
    });

    // Load chapter audio
    if (chapterData.audioPath) {
      await wavesurfer.load(chapterData.audioPath);
    }
  });

  onDestroy(() => {
    wavesurfer?.destroy();
  });

  function togglePlay() {
    wavesurfer?.playPause();
  }

  function seekTo(time: number) {
    wavesurfer?.seekTo(time / duration);
  }
  
  async function saveRegion(region: { id: string; start: number; end: number }) {
    // Save to database via IPC
    await window.api.saveBeat(region);
  }
</script>

<div class="timeline-header">
  <div class="timecode">
    {formatTimecode(currentTime)} / {formatTimecode(duration)}
  </div>
  <button on:click={togglePlay}>
    {isPlaying ? '⏸ Pause' : '▶ Play'}
  </button>
</div>

<div bind:this={container} class="waveform" style="height: {200}px;"></div>

<style>
  .waveform {
    border: 1px solid #ccc;
    background: #1a1a1a;
    color: #fff;
  }
  
  .timeline-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    background: #2a2a2a;
    color: #fff;
  }
  
  .timecode {
    font-family: monospace;
    font-size: 14px;
  }
</style>
```

### 3.2 React Component Wrapper (For React Libraries)

To use React components in Svelte 5, you have several options:

**Option A: Svelte Component Wrapper (Recommended)**

```typescript
// src/renderer/lib/components/ReactTimelineWrapper.svelte.ts
import type { ReactLikeComponent } from '@sveltejs/vite-plugin-svelte/react-transform';

// This is conceptual - actual implementation requires adapter
export function wrapReactComponent(ReactComponent: ReactLikeComponent) {
  return (props: any) => {
    // Return Svelte component that wraps React
  };
}
```

**Option B: Use in Separate View**

Keep React timeline in a separate view/browser window as an iframe.

**Option C: Re-implement in Svelte**

Given the complexity, **re-implementing core features in native Svelte is often easier and more performant** than wrapping React components.

---

## 4. Electron-Specific Considerations

### 4.1 Performance

**Canvas vs DOM:**

| Aspect | Canvas | DOM |
|--------|--------|-----|
| Performance with large timelines | ✅ Best | ⚠️ Slower with many elements |
| Styling flexibility | ⚠️ Limited to canvas API | ✅ Full CSS support |
| Accessibility | ❌ Requires ARIA implementation | ✅ Native support |
| Development complexity | ⚠️ Higher (manual rendering) | ✅ Lower (CSS/styling) |

**Recommendation for Hour+ Videos:**
- Use hybrid approach: Canvas for waveforms/visualizations, DOM for UI overlays
- Implement virtualization: only render visible portion of timeline
- Use pre-decoded peaks for audio waveforms (essential for performance)
- Lazy-load thumbnails/video frames

### 4.2 Memory Management

Large timelines in Electron:

```typescript
// Strategy: Virtual scrolling
const ZOOM_LEVELS = [10, 25, 50, 100, 250];  // pixels per second

class TimelineManager {
  private container!: HTMLElement;
  private content!: HTMLElement;
  private visibleRange = { start: 0, end: 0 };
  private zoomLevel = 50;  // pixels per second
  
  constructor(container: HTMLElement) {
    this.container = container;
    this.setupVirtualScroll();
  }
  
  private setupVirtualScroll() {
    this.container.addEventListener('scroll', () => {
      const scrollTop = this.container.scrollTop;
      const scrollLeft = this.container.scrollLeft;
      
      // Calculate visible time range
      const startTime = scrollLeft / this.zoomLevel;
      const endTime = (scrollLeft + this.container.clientWidth) / this.zoomLevel;
      
      this.visibleRange = { start: startTime, end: endTime };
      
      // Render only visible items
      this.renderVisibleItems();
    });
  }
  
  private renderVisibleItems() {
    // Query database for visible beats
    const visibleBeats = window.api.queryBeatsForTimeRange(
      this.visibleRange.start,
      this.visibleRange.end
    );
    
    // Update DOM
  }
}
```

### 4.3 FFmpeg Integration

Timeline needs to work with FFmpeg-provided data:

```typescript
// Main process: Generate waveform peaks using FFmpeg
ipcMain.handle('generate-waveform', async (event, audioPath: string) => {
  const outputPath = path.join(app.getPath('userData'), 'waveforms', `${path.basename(audioPath)}.dat`);
  
  await new Promise((resolve, reject) => {
    exec(
      `ffmpeg -i "${audioPath}" -filter_complex "aformat=sample_fmts=s16,showwavespic=s=${WINDOW_WIDTH}x${WAVEFORM_HEIGHT}:colors=#555555" -frames:v 1 "${outputPath}"`,
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
  
  return outputPath;
});

// Renderer: Use peaks for waveform visualization
const waveformPath = await window.api.generateWaveform('/chapter1.mp3');
const peaks = await window.api.loadWaveformPeaks(waveformPath);

wavesurfer.load('/chapter1.mp3', peaks);
```

### 4.4 IPC Communication

Timeline data flow between processes:

```
┌─────────────────────────────────────────────────┐
│  Renderer Process (Svelte 5)                    │
│  ──────────────────────────────────────────── │
│  - Timeline UI (canvas/DOM)                     │
│  - wavesurfer.js instance                       │
│  - User interactions (click, drag, scroll)     │
│                                                 │
│  IPC Requests:                                  │
│  → loadChapter(id)                              │
│  → saveBeat(beat)                               │
│  → queryBeats(chapterId, timeRange)             │
│  → generateWaveform(audioPath)                  │
└─────────────────┬───────────────────────────────┘
                  │ IPC
┌─────────────────▼───────────────────────────────┐
│  Main Process (Electron)                        │
│  ──────────────────────────────────────────── │
│  - SQLite database                              │
│  - FFmpeg orchestration                         │
│  - Cloud file access (if remote)                │
│                                                 │
│  Operations:                                    │
│  - Query beats from DB                          │
│  - Generate waveform peaks                      │
│  - Save/beat changes to DB                      │
└─────────────────────────────────────────────────┘
```

---

## 5. Library Evaluation Criteria

### 5.1 Our Requirements

Based on the project plan, we need:

1. **Timeline Visualization** - Visual representation of video/audio segments
2. **Multi-Track Support** - Video track + audio track(s)
3. **Waveform Display** - Audio waveform visualization for chapters
4. **Clip Manipulation** - Move, resize, split clips on timeline
5. **Zoom/Pan Controls** - Navigate large timelines (hour+ videos)
6. **Timecode Display** - Show precise time (HH:MM:SS:FF)
7. **Performance** - Handle long videos without slowdown
8. **Svelte 5 Compatible** - Work with runes API
9. **Electron-Friendly** - No special browser requirements
10. **Open Source / Permissive License** - MIT, Apache, BSD preferred

### 5.2 Scoring Matrix

| Library | Timeline Viz | Multi-Track | Waveforms | Clip Manip | Zoom/Pan | Timecode | Performance | Svelte 5 | Electron | License | Score |
|--------|--------------|-------------|-----------|------------|----------|----------|-------------|----------|----------|---------|-------|
| **Custom Canvas** | ✅ 10 | ✅ 10 | ✅ 8 | ✅ 10 | ✅ 9 | ✅ 10 | ✅ 10 | ✅ 10 | ✅ 10 | ✅ 10 | **97** |
| **wavesurfer.js** | ✅ 7 | ⚠️ 6 | ✅ 10 | ⚠️ 6 | ✅ 7 | ✅ 10 | ✅ 9 | ✅ 10 | ✅ 10 | ✅ 10 | **85** |
| **vis-timeline** | ✅ 10 | ✅ 9 | ⚠️ 4 | ✅ 7 | ✅ 9 | ⚠️ 6 | ✅ 8 | ✅ 9 | ✅ 9 | ✅ 10 | **81** |
| @diffusionstudio/core | ✅ 8 | ✅ 9 | ⚠️ 5 | ✅ 9 | ✅ 8 | ✅ 8 | ✅ 9 | ✅ 10 | ⚠️ 5 | ⚠️ 4 | **75** |
| @xzdarcy/react-timeline-editor | ✅ 9 | ✅ 10 | ⚠️ 5 | ✅ 10 | ✅ 9 | ✅ 9 | ✅ 8 | ⚠️ 3 | ✅ 9 | ✅ 10 | **72** |
| wx-svelte-gantt | ✅ 8 | ✅ 8 | ❌ 2 | ✅ 6 | ✅ 9 | ⚠️ 5 | ✅ 9 | ✅ 10 | ✅ 10 | ✅ 10 | **67** |
| @twick/video-editor | ✅ 10 | ✅ 10 | ⚠️ 5 | ✅ 10 | ✅ 10 | ✅ 10 | ✅ 8 | ⚠️ 3 | ✅ 9 | ❌ 1 | **66** |
| melies-video-editor | ✅ 9 | ✅ 10 | ⚠️ 5 | ✅ 10 | ✅ 9 | ✅ 9 | ✅ 8 | ⚠️ 3 | ✅ 9 | ✅ 10 | **73** |

**Legend:**
- ✅ 10: Excellent, ✅ 9: Great, ✅ 8: Good, ✅ 7: Acceptable, ⚠️: Acceptable with caveats, ❌: Poor

---

## 6. Recommended Approach

### 6.1 Primary Recommendation: Build Custom Canvas-Based Timeline

**Why Custom?**

1. **Complete Control** - Exactly match VOD pipeline requirements
2. **Best Performance** - Optimized for hour+ videos with virtualization
3. **Svelte 5 Native** - No adapters, wrappers, or compatibility issues
4. **Future-Proof** - Can evolve with project needs
5. **Learning Opportunity** - Deep understanding of timeline internals

**Architecture:**

```typescript
// src/renderer/lib/timeline/TimelineEngine.ts
export class TimelineEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  
  // State
  zoomLevel: number;  // pixels per second
  scrollPosition: number;  // seconds
  selectedClips: Set<string>;
  
  // Data (from database via IPC)
  tracks: Track[];
  clips: Clip[];
  
  // Configuration
  config: TimelineConfig;
  
  render() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Render tracks
    this.tracks.forEach(track => {
      this.renderTrack(track);
    });
    
    // Render clips (only visible ones)
    const visibleClips = this.getVisibleClips();
    visibleClips.forEach(clip => {
      this.renderClip(clip);
    });
    
    // Render UI overlays (playhead, selection, etc.)
    this.renderOverlays();
  }
  
  private renderTrack(track: Track) {
    // Draw track background, header, etc.
  }
  
  private renderClip(clip: Clip) {
    // Draw clip rectangle, label, waveforms
  }
  
  private renderOverlays() {
    // Draw playhead, time markers, selection
  }
  
  handleMouseDown(event: MouseEvent) {
    // Detect hit on clip or UI element
    // Start drag/resize operation
  }
  
  handleMouseMove(event: MouseEvent) {
    // Update drag state
    // Request render
  }
  
  handleMouseUp(event: MouseEvent) {
    // Complete operation
    // Save changes to database
    window.api.saveClips(this.getChangedClips());
  }
}
```

**Svelte Integration:**

```svelte
<!-- src/renderer/components/Timeline.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { TimelineEngine } from '$lib/timeline/TimelineEngine';
  
  let canvas: HTMLCanvasElement;
  let engine: TimelineEngine;
  
  const projectId = $state<string | null>(null);
  const selectedChapterId = $state<string | null>(null);
  
  // Timeline state
  const currentTime = $state(0);  // seconds
  const zoomLevel = $state(50);  // pixels per second
  const scrollPosition = $state(0);  // seconds
  
  onMount(async () => {
    // Initialize timeline engine
    engine = new TimelineEngine(canvas);
    
    // Load chapter data from database
    if (selectedChapterId) {
      const chapterData = await window.api.loadChapter(selectedChapterId);
      engine.loadData(chapterData);
    }
    
    // Start render loop
    requestAnimationFrame(() => engine.render());
  });
  
  onDestroy(() => {
    engine.destroy();
  });
  
  function handleZoom(delta: number) {
    const newZoom = Math.max(10, Math.min(500, zoomLevel + delta * 10));
    zoomLevel = newZoom;
    engine.zoomLevel = newZoom;
    engine.render();
  }
  
  function handleSeek(time: number) {
    currentTime = time;
    window.api.seekTo(time);
    engine.render();
  }
</script>

<div class="timeline-container">
  <!-- Timeline header with zoom controls -->
  <div class="timeline-header">
    <button on:click={() => handleZoom(-1)}>-</button>
    <span>{zoomLevel} px/s</span>
    <button on:click={() => handleZoom(1)}>+</button>
    
    <div class="timecode-display">
      {formatTimecode(currentTime)}
    </div>
  </div>
  
  <!-- Main canvas timeline -->
  <div class="timeline-canvas-container">
    <canvas 
      bind:this={canvas}
      width={1200}
      height={400}
    />
  </div>
  
  <!-- Timeline footer with scroll controls -->
  <div class="timeline-footer">
    <input 
      type="range"
      min={0}
      max={timelineDuration}
      value={scrollPosition}
      on:input={(e) => {
        scrollPosition = parseFloat(e.target.value);
        engine.scrollPosition = scrollPosition;
        engine.render();
      }}
    />
  </div>
</div>

<style>
  .timeline-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1a1a1a;
    color: #fff;
  }
  
  .timeline-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    background: #2a2a2a;
    border-bottom: 1px solid #3a3a3a;
  }
  
  .timeline-canvas-container {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  
  .timeline-footer {
    padding: 10px;
    background: #2a2a2a;
    border-top: 1px solid #3a3a3a;
  }
  
  .timecode-display {
    font-family: 'Courier New', monospace;
    font-size: 14px;
    color: #00ff00;
  }
</style>
```

**Waveform Integration:**

```typescript
// Generate waveform data using FFmpeg in main process
export async function generateWaveform(
  audioPath: string,
  options: { width: number; height: number; samples: number }
): Promise<number[]> {
  const peaks = new Array(options.width).fill(0);
  
  // This is a simplified version
  // In production, use FFmpeg audio filters or audiowaveform tool
  const { stdout } = await executeFFmpeg([
    '-i', audioPath,
    '-filter_complex',
    `showwavespic=s=${options.width}x${options.height}:colors=white`,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-pix_fmt', 'rgb24',
    '-vcodec', 'rawvideo',
    '-',
  ]);
  
  // Parse raw pixel data
  // ...convert to peak array
  
  return peaks;
}

// Use in timeline engine
class TimelineEngine {
  private waveformCache = new Map<string, number[]>();
  
  async loadWaveform(audioPath: string): Promise<number[]> {
    if (this.waveformCache.has(audioPath)) {
      return this.waveformCache.get(audioPath)!;
    }
    
    const peaks = await window.api.generateWaveform(audioPath, {
      width: 10000,  // 10 samples per second for 1000-second video
      height: 100,
      samples: 10000,
    });
    
    this.waveformCache.set(audioPath, peaks);
    return peaks;
  }
  
  renderClip(clip: Clip) {
    // ...draw clip background
    
    // Draw waveform if audio clip
    if (clip.type === 'audio') {
      const peaks = await this.loadWavepeaks(clip.audioPath);
      this.drawWaveform(peaks, clip.startTime, clip.duration);
    }
    
    // ...draw clip label, etc.
  }
  
  private drawWaveform(peaks: number[], startTime: number, duration: number) {
    const x = startTime * this.zoomLevel + this.scrollOffset;
    const width = duration * this.zoomLevel;
    
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#00aaff';
    this.ctx.lineWidth = 1;
    
    peaks.forEach((peak, i) => {
      const peakX = x + (i / peaks.length) * width;
      const peakY = this.canvas.height / 2 - peak * this.canvas.height / 2;
      
      if (i === 0) {
        this.ctx.moveTo(peakX, peakY);
      } else {
        this.ctx.lineTo(peakX, peakY);
      }
    });
    
    this.ctx.stroke();
  }
}
```

### 6.2 Hybrid Approach: wavesurfer.js + Custom Timeline

If you want to leverage wavesurfer.js for waveforms while keeping custom timeline control:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js';
  
  // Timeline canvas for video track
  let timelineCanvas: HTMLCanvasElement;
  
  // Waveform for audio track
  let waveformContainer: HTMLDivElement;
  let waveSurfer: WaveSurfer;
  
  const tracks = $state([
    { id: 'video', type: 'video', clips: [] },
    { id: 'audio', type: 'audio', clips: [] },
  ]);
  
  onMount(() => {
    // Initialize timeline canvas (custom)
    const timelineCtx = timelineCanvas.getContext('2d')!;
    renderVideoTimeline(timelineCtx, tracks);
    
    // Initialize wavesurfer.js for audio waveform
    waveSurfer = WaveSurfer.create({
      container: waveformContainer,
      waveColor: '#4F4A85',
      progressColor: '#383351',
      height: 100,
      minPxPerSec: 50,
    });
    
    // Sync scroll between timeline and waveform
    timelineCanvas.addEventListener('scroll', () => {
      const scrollPos = timelineCanvas.scrollLeft;
      // Scroll wavesurfer to same position
      waveSurfer.seekTo(scrollPos / (timelineCanvas.scrollWidth - timelineCanvas.clientWidth));
    });
  });
</script>

<div class="timeline-view">
  <!-- Video track (custom canvas) -->
  <div class="track video-track">
    <div class="track-header">Video</div>
    <div class="track-content">
      <canvas bind:this={timelineCanvas} width={1200} height={60}></canvas>
    </div>
  </div>
  
  <!-- Audio track (wavesurfer.js) -->
  <div class="track audio-track">
    <div class="track-header">Audio</div>
    <div class="track-content">
      <div bind:this={waveformContainer} class="waveform"></div>
    </div>
  </div>
</div>
```

---

## 7. Performance Optimization Strategies

### 7.1 For Long Videos (Hour+)

**Key Strategies:**

1. **Virtual Scrolling / Windowed Rendering**
   ```typescript
   function getVisibleClips(clips: Clip[], viewStart: number, viewEnd: number): Clip[] {
     return clips.filter(clip => 
       clip.startTime < viewEnd && clip.endTime > viewStart
     );
   }
   ```

2. **Level-of-Detail (LOD) Rendering**
   ```typescript
   function renderClip(clip: Clip, zoomLevel: number) {
     if (zoomLevel < 20) {
       // Low detail - just draw rectangle
       drawSimpleBox(clip);
     } else if (zoomLevel < 100) {
       // Medium detail - draw waveform overview
       drawWaveformOverview(clip);
     } else {
       // High detail - draw full waveform + frame thumbnails
       drawFullDetail(clip);
     }
   }
   ```

3. **Pre-computed Waveform Peaks**
   ```typescript
   // Generate multiple resolutions
   const waveforms = {
     low: await generatePeaks(audioPath, samplesPerSecond: 1),
     medium: await generatePeaks(audioPath, samplesPerSecond: 10),
     high: await generatePeaks(audioPath, samplesPerSecond: 100),
   };
   
   function getWaveform(zoomLevel: number) {
     if (zoomLevel < 20) return waveforms.low;
     if (zoomLevel < 100) return waveforms.medium;
     return waveforms.high;
   }
   ```

4. **RequestAnimationFrame Throttling**
   ```typescript
   let renderRequested = false;
   
   function requestRender() {
     if (!renderRequested) {
       renderRequested = true;
       requestAnimationFrame(() => {
         timeline.render();
         renderRequested = false;
       });
     }
   }
   ```

5. **Offscreen Canvas for Static Elements**
   ```typescript
   class TimelineEngine {
     private staticCache: Map<string, HTMLCanvasElement>;
     
     render() {
       // Render static elements to cache
       tracks.forEach(track => {
         if (!this.staticCache.has(track.id)) {
           this.staticCache.set(track.id, this.renderTrackToCache(track));
         }
       });
       
       // Blit from cache to main canvas
       this.staticCache.forEach((cachedCanvas, trackId) => {
         this.ctx.drawImage(cachedCanvas, 0, trackY);
       });
     }
   }
   ```

### 7.2 Memory Management

```typescript
// Resource cleanup
class TimelineEngine {
  private resources = new Set<object>();
  
  registerResource(resource: object) {
    this.resources.add(resource);
  }
  
  dispose() {
    this.resources.forEach(resource => {
      if (resource instanceof Image) {
        // Release image bitmap
      }
      // ...cleanup other resources
    });
    this.resources.clear();
  }
}

// Automatic cleanup on chapter change
function loadChapter(chapterId: string) {
  // Dispose previous timeline engine
  currentTimeline?.dispose();
  
  // Create new timeline engine
  currentTimeline = new TimelineEngine(canvas);
  currentTimeline.registerDisposable(currentTimeline);
}
```

---

## 8. Development Roadmap

### Phase 1: Basic Timeline (Week 1-2)

- [ ] Set up canvas-based timeline engine
- [ ] Implement time-to-pixel and pixel-to-time conversions
- [ ] Render track backgrounds and headers
- [ ] Implement scroll functionality
- [ ] Add playhead rendering and scrubbing

### Phase 2: Clip Rendering (Week 2-3)

- [ ] Render clip rectangles on timeline
- [ ] Implement clip selection
- [ ] Add clip label display
- [ ] Integrate with database (load/save clips)

### Phase 3: Waveform Integration (Week 3-4)

- [ ] Set up FFmpeg waveform generation
- [ ] Cache waveform peaks in database
- [ ] Render waveform data on clips
- [ ] Implement multi-resolution waveforms (LOD)

### Phase 4: Interaction (Week 4-5)

- [ ] Implement clip drag-and-drop
- [ ] Add clip resize handles
- [ ] Implement clip splitting (at playhead)
- [ ] Add keyboard shortcuts (delete, cut, copy, paste)

### Phase 5: Zoom & Navigation (Week 5-6)

- [ ] Implement zoom controls
- [ ] Add zoom-to-fit functionality
- [ ] Implement time markers (seconds, minutes, hours)
- [ ] Add mini-map / navigation bar

### Phase 6: Performance Optimization (Week 6-7)

- [ ] Implement virtual scrolling
- [ ] Add level-of-detail rendering
- [ ] Optimize render loop with requestAnimationFrame
- [ ] Profile and optimize for hour+ videos

### Phase 7: Polish (Week 7-8)

- [ ] Add visual feedback (hover states, selection)
- [ ] Implement dark/light theme
- [ ] Add context menus
- [ ] Implement undo/redo
- [ ] Accessibility improvements

---

## 9. Sample Code: Complete Timeline Implementation

### 9.1 Timeline Engine (Core)

```typescript
// src/renderer/lib/timeline/TimelineEngine.ts
import type { Clip, Track, Waveform } from '$shared/types';

export interface TimelineConfig {
  width: number;
  height: number;
  trackHeight: number;
  minZoom: number;  // pixels per second
  maxZoom: number;
  defaultZoom: number;
}

export interface TimelineEventHandlers {
  onClipDrag?: (clip: Clip, newTime: number) => void;
  onClipResize?: (clip: Clip, newDuration: number) => void;
  onClipSelect?: (clip: Clip | null) => void;
  onSeek?: (time: number) => void;
}

export class TimelineEngine {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  
  // Configuration
  readonly config: TimelineConfig;
  readonly handlers: TimelineEventHandlers;
  
  // State
  zoomLevel: number;  // pixels per second
  scrollPosition: number;  // seconds (time at left edge)
  currentTime: number;  // playhead position
  selectedClips: Set<string> = new Set();
  draggingClip: Clip | null = null;
  resizingClip: Clip | null = null;
  resizeHandle: 'start' | 'end' | null = null;
  
  // Data
  tracks: Track[] = [];
  clips: Clip[] = [];
  waveforms: Map<string, Waveform> = new Map();
  
  // Drag state
  private dragStartX = 0;
  private dragStartTime = 0;
  private dragStartDuration = 0;
  
  constructor(
    canvas: HTMLCanvasElement,
    config: Partial<TimelineConfig> = {},
    handlers: TimelineEventHandlers = {}
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    
    this.config = {
      width: canvas.width,
      height: canvas.height,
      trackHeight: 100,
      minZoom: 10,
      maxZoom: 500,
      defaultZoom: 50,
      ...config,
    };
    
    this.handlers = handlers;
    
    // Initialize state
    this.zoomLevel = this.config.defaultZoom;
    this.scrollPosition = 0;
    this.currentTime = 0;
    
    // Set up event listeners
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
  }
  
  loadData(data: { tracks: Track[]; clips: Clip[] }) {
    this.tracks = data.tracks;
    this.clips = data.clips;
    this.render();
  }
  
  async loadWaveform(audioPath: string): Promise<void> {
    if (this.waveforms.has(audioPath)) return;
    
    try {
      const waveform = await window.api.generateWaveform(audioPath, {
        width: 10000,
        height: 100,
      });
      this.waveforms.set(audioPath, waveform);
      this.render();
    } catch (error) {
      console.error('Failed to load waveform:', error);
    }
  }
  
  render() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.config.width, this.config.height);
    
    // Draw background
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.config.width, this.config.height);
    
    // Draw tracks
    let y = 0;
    this.tracks.forEach((track, trackIndex) => {
      this.renderTrack(track, y);
      y += this.config.trackHeight;
    });
    
    // Draw clips (only visible ones)
    const visibleClips = this.getVisibleClips();
    visibleClips.forEach(clip => {
      this.renderClip(clip);
    });
    
    // Draw playhead
    this.renderPlayhead();
    
    // Draw selection overlay
    this.renderSelection();
  }
  
  private renderTrack(track: Track, y: number) {
    // Track background
    const isEven = track.id % 2 === 0;
    this.ctx.fillStyle = isEven ? '#252525' : '#2a2a2a';
    this.ctx.fillRect(0, y, this.config.width, this.config.trackHeight);
    
    // Track border
    this.ctx.strokeStyle = '#3a3a3a';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(this.config.width, y);
    this.ctx.stroke();
    
    // Track header (left side)
    this.ctx.fillStyle = '#333333';
    this.ctx.fillRect(0, y, 200, this.config.trackHeight);
    
    // Track name
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillText(track.name, 10, y + 30);
  }
  
  private renderClip(clip: Clip) {
    const track = this.tracks.find(t => t.id === clip.trackId);
    if (!track) return;
    
    const trackY = this.tracks.findIndex(t => t.id === clip.trackId) * this.config.trackHeight;
    const x = (clip.startTime - this.scrollPosition) * this.zoomLevel + 200;  // +200 for header
    const y = trackY + 10;
    const width = clip.duration * this.zoomLevel;
    const height = this.config.trackHeight - 20;
    
    // Skip if not visible
    if (x + width < 0 || x > this.config.width) return;
    
    // Clip background
    const isSelected = this.selectedClips.has(clip.id);
    this.ctx.fillStyle = isSelected ? '#5555ff' : '#4a4a4a';
    this.ctx.fillRect(x, y, width, height);
    
    // Clip border
    this.ctx.strokeStyle = isSelected ? '#7777ff' : '#5a5a5a';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, width, height);
    
    // Clip label
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '12px sans-serif';
    this.ctx.fillText(clip.name, x + 5, y + 20);
    
    // Waveform (if audio clip)
    if (clip.type === 'audio' && clip.audioPath) {
      this.renderClipWaveform(clip, x, y, width, height);
    }
    
    // Resize handles
    this.renderResizeHandles(clip, x, y, width, height);
  }
  
  private renderClipWaveform(clip: Clip, x: number, y: number, width: number, height: number) {
    const waveform = this.waveforms.get(clip.audioPath!);
    if (!waveform) return;
    
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#00aaff';
    this.ctx.lineWidth = 1;
    
    const samplesPerClip = Math.floor(width / 2);  // 2 pixels per sample
    const step = waveform.data.length / samplesPerClip;
    
    for (let i = 0; i < samplesPerClip; i++) {
      const dataIndex = Math.floor(i * step);
      const peak = waveform.data[dataIndex];
      
      const px = x + i * 2;
      const py = y + height / 2 - peak * (height / 2);
      
      if (i === 0) {
        this.ctx.moveTo(px, py);
      } else {
        this.ctx.lineTo(px, py);
      }
    }
    
    this.ctx.stroke();
  }
  
  private renderResizeHandles(clip: Clip, x: number, y: number, width: number, height: number) {
    const handleSize = 8;
    
    // Left handle
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(x - handleSize / 2, y + height / 2 - handleSize / 2, handleSize, handleSize);
    
    // Right handle
    this.ctx.fillRect(x + width - handleSize / 2, y + height / 2 - handleSize / 2, handleSize, handleSize);
  }
  
  private renderPlayhead() {
    const x = (this.currentTime - this.scrollPosition) * this.zoomLevel + 200;
    
    // Playhead line
    this.ctx.strokeStyle = '#ff0000';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x, this.config.height);
    this.ctx.stroke();
    
    // Playhead triangle
    this.ctx.fillStyle = '#ff0000';
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x - 5, -10);
    this.ctx.lineTo(x + 5, -10);
    this.ctx.closePath();
    this.ctx.fill();
  }
  
  private renderSelection() {
    // Implementation for multi-select lasso
  }
  
  private getVisibleClips(): Clip[] {
    const startTime = this.scrollPosition;
    const endTime = this.scrollPosition + (this.config.width - 200) / this.zoomLevel;
    
    return this.clips.filter(clip => 
      clip.startTime < endTime && clip.endTime > startTime
    );
  }
  
  private handleMouseDown(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Check if clicking on resize handle
    const clickedClip = this.getClipAtPosition(x, y);
    if (clickedClip) {
      const handle = this.getResizeHandle(clickedClip, x, y);
      if (handle) {
        this.resizingClip = clickedClip;
        this.resizeHandle = handle;
        this.dragStartX = x;
        this.dragStartTime = clickedClip.startTime;
        this.dragStartDuration = clickedClip.duration;
        return;
      }
    }
    
    // Check if clicking on clip
    if (clickedClip) {
      this.draggingClip = clickedClip;
      this.selectedClips.add(clickedClip.id);
      this.dragStartX = x;
      this.dragStartTime = clickedClip.startTime;
      this.handlers.onClipSelect?.(clickedClip);
      this.render();
      return;
    }
    
    // Check if clicking on timeline (seek)
    if (x > 200) {
      const time = (x - 200) / this.zoomLevel + this.scrollPosition;
      this.currentTime = time;
      this.handlers.onSeek?.(time);
      this.render();
    }
  }
  
  private handleMouseMove(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Update cursor
    const clickedClip = this.getClipAtPosition(x, y);
    const handle = clickedClip ? this.getResizeHandle(clickedClip, x, y) : null;
    this.canvas.style.cursor = handle ? 'ew-resize' : clickedClip ? 'move' : 'default';
    
    // Handle drag
    if (this.draggingClip) {
      const deltaTime = (x - this.dragStartX) / this.zoomLevel;
      this.draggingClip.startTime = this.dragStartTime + deltaTime;
      this.render();
      return;
    }
    
    // Handle resize
    if (this.resizingClip) {
      const deltaPixels = x - this.dragStartX;
      const deltaTime = deltaPixels / this.zoomLevel;
      
      if (this.resizeHandle === 'start') {
        this.resizingClip.startTime = this.dragStartTime + deltaTime;
        this.resizingClip.duration = this.dragStartDuration - deltaTime;
      } else if (this.resizeHandle === 'end') {
        this.resizingClip.duration = this.dragStartDuration + deltaTime;
      }
      
      this.render();
      return;
    }
  }
  
  private handleMouseUp(event: MouseEvent) {
    if (this.draggingClip) {
      this.handlers.onClipDrag?.(this.draggingClip, this.draggingClip.startTime);
      this.draggingClip = null;
    }
    
    if (this.resizingClip) {
      this.handlers.onClipResize?.(this.resizingClip, this.resizingClip.duration);
      this.resizingClip = null;
      this.resizeHandle = null;
    }
  }
  
  private handleWheel(event: WheelEvent) {
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
      // Zoom
      const zoomDelta = event.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(
        this.config.minZoom,
        Math.min(this.config.maxZoom, this.zoomLevel * zoomDelta)
      );
      
      this.zoomLevel = newZoom;
      this.render();
    } else {
      // Pan
      const deltaSeconds = event.deltaX > 0 ? 10 : -10;
      this.scrollPosition = Math.max(0, this.scrollPosition + deltaSeconds);
      this.render();
    }
  }
  
  private getClipAtPosition(x: number, y: number): Clip | null {
    for (const clip of this.clips) {
      const track = this.tracks.find(t => t.id === clip.trackId);
      if (!track) continue;
      
      const trackY = this.tracks.findIndex(t => t.id === clip.trackId) * this.config.trackHeight;
      const clipX = (clip.startTime - this.scrollPosition) * this.zoomLevel + 200;
      const clipY = trackY + 10;
      const clipWidth = clip.duration * this.zoomLevel;
      const clipHeight = this.config.trackHeight - 20;
      
      if (x >= clipX && x <= clipX + clipWidth && y >= clipY && y <= clipY + clipHeight) {
        return clip;
      }
    }
    
    return null;
  }
  
  private getResizeHandle(clip: Clip, x: number, y: number): 'start' | 'end' | null {
    const track = this.tracks.find(t => t.id === clip.trackId);
    if (!track) return null;
    
    const trackY = this.tracks.findIndex(t => t.id === clip.trackId) * this.config.trackHeight;
    const clipX = (clip.startTime - this.scrollPosition) * this.zoomLevel + 200;
    const clipY = trackY + 10;
    const clipWidth = clip.duration * this.zoomLevel;
    const clipHeight = this.config.trackHeight - 20;
    
    const handleSize = 8;
    const handleY = clipY + clipHeight / 2;
    
    // Left handle
    if (Math.abs(x - clipX) < handleSize && Math.abs(y - handleY) < handleSize) {
      return 'start';
    }
    
    // Right handle
    if (Math.abs(x - (clipX + clipWidth)) < handleSize && Math.abs(y - handleY) < handleSize) {
      return 'end';
    }
    
    return null;
  }
  
  zoom(delta: number) {
    this.zoomLevel = Math.max(
      this.config.minZoom,
      Math.min(this.config.maxZoom, this.zoomLevel + delta)
    );
    this.render();
  }
  
  seek(time: number) {
    this.currentTime = time;
    this.render();
  }
  
  destroy() {
    // Clean up event listeners
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }
}
```

---

## 10. Conclusion and Final Recommendations

### Summary of Findings

1. **No "Silver Bullet" exists** that perfectly matches our requirements (Svelte 5 + Electron + Video Editing + Waveforms)

2. **Best Available Libraries:**
   - **wavesurfer.js**: Excellent for audio waveforms, but limited multi-track/clip manipulation
   - **vis-timeline**: Good general timeline, but not video-focused
   - **@xzdarcy/react-timeline-editor**: Good video timeline, but React-only

3. **Custom Build is Recommended** because:
   - Full control over architecture and features
   - Perfect Svelte 5 integration
   - Optimized for our specific use case (VOD editing)
   - No licensing restrictions
   - Best performance potential

### Recommended Implementation Path

**Phase 1 (Proof of Concept - 2 weeks):**
- Build basic canvas timeline with track rendering
- Implement clip rendering (rectangles only)
- Add drag-and-drop clips
- Integrate with Svelte 5 runes API

**Phase 2 (Waveform Integration - 2 weeks):**
- Set up FFmpeg waveform generation
- Cache waveform peaks in SQLite
- Render waveforms on audio clips

**Phase 3 (Advanced Features - 3 weeks):**
- Implement clip resize handles
- Add zoom controls
- Implement playhead scrubbing
- Add keyboard shortcuts

**Phase 4 (Performance - 2 weeks):**
- Implement virtual scrolling
- Add level-of-detail rendering
- Profile and optimize

### Alternative: Hybrid Approach

If team prefers to use existing libraries:

```typescript
// Use wavesurfer.js for audio tracks
// Use custom canvas for video tracks
class HybridTimeline {
  private audioTrack: WaveSurfer;
  private videoTrack: CustomCanvasTimeline;
  
  async loadChapter(chapter: Chapter) {
    // Load video track (custom)
    this.videoTrack.loadClips(chapter.videoClips);
    
    // Load audio track (wavesurfer.js)
    await this.audioTrack.load(chapter.audioPath);
    
    // Sync scroll/playhead
    this.audioTrack.on('seek', (time) => {
      this.videoTrack.seekTo(time);
    });
    
    this.videoTrack.on('seek', (time) => {
      this.audioTrack.seekTo(time);
    });
  }
}
```

### References

- **Project Plan:** `/PLAN.md`
- **Phase 1-3 Plan:** `/docs/phase-1-3-plan.md`
- **wavesurfer.js:** https://wavesurfer.xyz
- **vis-timeline:** https://visjs.github.io/vis-timeline/
- **Svelte 5 Runes:** https://svelte.dev/docs/runes
- **Canvas API:** https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API

---

**Document Status:** Complete
**Last Updated:** January 26, 2026
