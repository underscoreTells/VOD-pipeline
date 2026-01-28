# NLE Export Formats Research: DaVinci Resolve Compatibility

**Date:** January 23, 2026  
**Project:** VOD Pipeline - AI-Assisted Video Editor  
**Focus:** DaVinci Resolve Import Capabilities and Export Strategies

---

## Table of Contents

1. [Overview](#overview)
2. [DaVinci Resolve Import Formats](#davinci-resolve-import-formats)
   - [FCPXML (Final Cut Pro XML)](#fcpxml-final-cut-pro-xml)
   - [EDL (Edit Decision List)](#edl-edit-decision-list)
   - [AAF (Advanced Authoring Format)](#aaf-advanced-authoring-format)
3. [JSON Cut List Format Design](#json-cut-list-format-design)
4. [XML/EDL Transformation](#xmledl-transformation)
5. [Resolve-Specific Requirements](#resolve-specific-requirements)
6. [Alternative Approaches](#alternative-approaches)
7. [Recommendation](#recommendation)

---

## Overview

This research document analyzes the export format options for video cut lists that are compatible with DaVinci Resolve, a professional non-linear editor (NLE). The primary goal is to enable the VOD Pipeline application to export rough cuts that can be imported into DaVinci Resolve for further refinement.

**Key Considerations:**
- DaVinci Resolve has excellent import capabilities for industry-standard formats
- JSON is ideal as an internal/primary format due to simplicity and programmatic access
- Transformation to XML/EDL is required for direct NLE import
- The solution should support three export tiers: internal JSON, simplified XML, and basic EDL

---

## DaVinci Resolve Import Formats

### FCPXML (Final Cut Pro XML)

**Structure and Compatibility:**

DaVinci Resolve has robust support for FCPXML, particularly versions 1.0 and 1.1. The format is XML-based and was designed by Apple for interchange between Final Cut Pro and other applications.

**Key Features:**
- **Format Version:** FCPXML 1.0 (basic), 1.1+ (extended features)
- **Resolve Compatibility:** Excellent - native import with automatic conforming
- **Rich Media Support:** Clips, effects, transitions, audio, markers, metadata
- **Timecode Format:** `HH:MM:SS:FF` (frames) or `HH:MM:SS:NTSC` (drop frame)
- **Namespace:** `http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.0`

**XML Structure:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.0">
  <resources>
    <format id="r1" name="FFVideoFormat1080p" width="1920" height="1080" 
            frameDuration="1001/30000s" displayAspectRatio="16/9"/>
    <asset id="r2" name="video_clip.mp4" src="file://localhost/path/to/video_clip.mp4"
           format="r1" duration="1800/30000s" hasVideo="1" hasAudio="1"/>
  </resources>
  <library>
    <event name="Rough Cut">
      <project name="Project Name">
        <sequence format="r1" duration="3600/30000s">
          <spine>
            <video-format id="r1"/>
            <asset-clip offset="0/30000s" ref="r2" duration="1800/30000s" 
                       start="900/30000s" name="Clip 1"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
```xml

**What Resolve Accepts:**
- Multiple video/audio tracks
- Clip in/out points
- Source clip references (file paths)
- Markers (timeline markers)
- Basic transitions (dissolve, fade)
- Gap clips (black/empty space)
- Rate conforming (slow-motion, speed ramps)

**Timecode Format in FCPXML:**
- Resolve expects timecodes in rational number format: `frames/totalFrames`
- Example: `"900/30000s"` = frame 900 at 30fps = 30 seconds
- Drop frame support: use `"NTSC"` designator

**Pros:**
- Most feature-rich interchange format
- Excellent Resolve compatibility
- Supports complex timelines
- Can include metadata
- Human-readable XML

**Cons:**
- Complex XML structure
- Requires careful namespace handling
- Larger file size than EDL

---

### EDL (Edit Decision List)

**Structure and Limitations:**

EDL (CMX 3600 format) is a decades-old text format that provides basic cut list functionality. It's universally supported but extremely limited in features.

**Key Features:**
- **Format:** Plain text, line-based
- **Resolve Compatibility:** Good - can import but limited functionality
- **Rich Media Support:** Only cuts; dissolves are possible but problematic
- **Timecode Format:** `HH:MM:SS:FF` standard timecode
- **Standard:** CMX 3600

**EDL Structure:**
```text
001  CLIP V  C        00:00:30:00 00:01:00:00 00:00:00:00 00:00:30:00
* FROM CLIP NAME: video_clip.mp4
* FROM FILE: /path/to/video_clip.mp4
002  CLIP V  C        00:01:30:00 00:02:00:00 00:00:30:00 00:01:00:00
* FROM CLIP NAME: video_clip2.mp4
* FROM FILE: /path/to/video_clip2.mp3
```

**Field Breakdown per line:**
```text
001    CLIP    V    C     00:00:30:00   00:01:00:00    00:00:00:00   00:00:30:00
|      |       |    |     |             |              |              |
Event  Reel    Trk  Type  Source In     Source Out     Record In     Record Out
Num   Name                     (timecode)    (timecode)    (timecode)    (timecode)
```

**Type Codes:**
- `C` = Cut
- `D` = Dissolve
- `W` = Wipe

**Track Codes:**
- `V` = Video
- `A` = Audio
- `AA` = Stereo Audio
- `B` = Black

**Limitations:**
- No opacity/blend modes
- No nested timelines
- Very limited transition support
- No multi-track audio (limited configurations)
- No effects or filters
- No markers
- Frame rate must match source
- No aspect ratio or format metadata

**Pros:**
- Universally supported
- Simple text format
- Small file size
- Easy to generate

**Cons:**
- Extremely limited features
- No modern NLE capabilities
- Cannot represent complex cuts
- Lacks metadata

---

### AAF (Advanced Authoring Format)

**Complexity and Feasibility:**

AAF is a complex, proprietary format designed for high-end production environments. It was created by Avid Technology and is difficult to implement without commercial libraries.

**Key Features:**
- **Format:** Binary (Open Packaging Convention based on zip)
- **Resolve Compatibility:** Good - supports import but sometimes requires conforming
- **Rich Media Support:** Clips, effects, transitions, audio, markers, metadata, embedded media
- **Complexity:** Very high - requires extensive object model implementation

**Implementation Challenges:**
- Proprietary specifications
- Requires licensing and SDK access (Avid Development Kit)
- Complex object hierarchy
- Supports many optional features that are difficult to implement
- Binary format makes debugging difficult

**Is it Feasible?**

Not recommended for a personal software project:
- **Time Investment:** Would require months to implement even a minimal viable AAF exporter
- **Licensing Issues:** Avid SDK may not be freely available for all use cases
- **Overkill:** For the VOD Pipeline use case, FCPXML provides similar functionality with much less complexity

**Recommendation:** Avoid AAF unless there's a specific customer requirement for Avid compatibility. FCPXML provides 90% of the functionality with 10% of the complexity.

---

## JSON Cut List Format Design

JSON is ideal as the primary internal format for cut lists - it's human-readable, programmatic, and can be easily transformed to other formats.

### JSON Schema for Video Cut Lists

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VOD Pipeline Cut List",
  "type": "object",
  "required": ["meta", "settings", "clips"],
  "properties": {
    "meta": {
      "type": "object",
      "description": "Project metadata",
      "required": ["name", "createdAt", "formatVersion"],
      "properties": {
        "name": { "type": "string", "description": "Project name" },
        "description": { "type": "string", "description": "Project description" },
        "createdAt": { "type": "string", "format": "date-time" },
        "updatedAt": { "type": "string", "format": "date-time" },
        "formatVersion": { "type": "string", "const": "1.0" },
        "generator": { "type": "string", "description": "Application that created this file" },
        "projectId": { "type": "string", "description": "Internal project identifier" }
      }
    },
    "settings": {
      "type": "object",
      "description": "Timeline and format settings",
      "required": ["frameRate", "timecodeFormat", "duration"],
      "properties": {
        "frameRate": {
          "type": "number",
          "description": "Frames per second",
          "default": 30,
          "enum": [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]
        },
        "frameRateNumerator": { "type": "integer", "default": 30000 },
        "frameRateDenominator": { "type": "integer", "default": 1001 },
        "dropFrame": { "type": "boolean", "default": false },
        "timecodeFormat": {
          "type": "string",
          "description": "Timecode display format",
          "enum": ["HH:MM:SS:FF", "HH:MM:SS.ms", "frames"],
          "default": "HH:MM:SS:FF"
        },
        "resolution": {
          "type": "object",
          "properties": {
            "width": { "type": "integer", "default": 1920 },
            "height": { "type": "integer", "default": 1080 },
            "aspectRatio": { "type": "string", "default": "16:9" }
          }
        },
        "duration": {
          "type": "object",
          "description": "Total duration",
          "properties": {
            "frames": { "type": "integer" },
            "timecode": { "type": "string", "pattern": "^\\d{2}:\\d{2}:\\d{2}:\\d{2}$" },
            "seconds": { "type": "number" }
          }
        }
      }
    },
    "assets": {
      "type": "array",
      "description": "List of all referenced source files",
      "items": {
        "type": "object",
        "required": ["id", "name", "path", "duration"],
        "properties": {
          "id": { "type": "string", "description": "Unique asset identifier" },
          "name": { "type": "string", "description": "File name" },
          "path": { "type": "string", "description": "Absolute or relative path to media" },
          "duration": {
            "type": "object",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "startTimecode": { "type": "string", "description": "Source media start timecode" },
          "hasVideo": { "type": "boolean" },
          "hasAudio": { "type": "boolean" },
          "metadata": {
            "type": "object",
            "properties": {
              "width": { "type": "integer" },
              "height": { "type": "integer" },
              "frameRate": { "type": "number" },
              "bitrate": { "type": "integer" },
              "codec": { "type": "string" }
            }
          }
        }
      }
    },
    "clips": {
      "type": "array",
      "description": "Timeline clip definitions",
      "items": {
        "type": "object",
        "required": ["id", "assetId", "startTime", "sourceIn", "sourceOut"],
        "properties": {
          "id": { "type": "string", "description": "Unique clip identifier" },
          "assetId": { "type": "string", "description": "Reference to assets array" },
          "track": { "type": "integer", "default": 1, "description": "Track number (1 = video V1)" },
          "trackType": {
            "type": "string",
            "enum": ["video", "audio"],
            "default": "video"
          },
          "startTime": {
            "type": "object",
            "description": "Timeline start position",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "duration": {
            "type": "object",
            "description": "Clip duration",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "sourceIn": {
            "type": "object",
            "description": "Source clip in point",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "sourceOut": {
            "type": "object",
            "description": "Source clip out point",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "name": { "type": "string", "description": "Display name for clip" },
          "enabled": { "type": "boolean", "default": true },
          "speed": { "type": "number", "default": 1, "description": "Playback speed (1 = normal)" },
          "link": { "type": "string", "description": "ID of linked audio clip (if any)" }
        }
      }
    },
    "beats": {
      "type": "array",
      "description": "Story beat markers identified by AI",
      "items": {
        "type": "object",
        "required": ["time", "label"],
        "properties": {
          "id": { "type": "string" },
          "time": {
            "type": "object",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "label": { "type": "string" },
          "color": { "type": "string", "default": "#FF0000" },
          "type": {
            "type": "string",
            "enum": ["setup", "escalation", "twist", "payoff", "transition", "commentary", "other"],
            "default": "other"
          },
          "description": { "type": "string", "description": "Additional context" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "clipId": { "type": "string", "description": "Reference to clip" }
        }
      }
    },
    "segments": {
      "type": "array",
      "description": "Optional segment markers for chapter/section boundaries",
      "items": {
        "type": "object",
        "required": ["title", "startTime", "endTime"],
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "startTime": {
            "type": "object",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "endTime": {
            "type": "object",
            "properties": {
              "frames": { "type": "integer" },
              "timecode": { "type": "string" },
              "seconds": { "type": "number" }
            }
          },
          "color": { "type": "string" }
        }
      }
    },
    "chapters": {
      "type": "array",
      "description": "Chapter organization and ordering",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "assetIds": { "type": "array", "items": { "type": "string" } },
          "order": { "type": "integer" }
        }
      }
    }
  }
}
```json

### Example JSON Cut List

```json
{
  "meta": {
    "name": "DougDoug VOD Edit - Episode 47",
    "description": "AI-analyzed rough cut focusing on the best moments",
    "createdAt": "2026-01-23T10:30:00Z",
    "updatedAt": "2026-01-23T14:45:00Z",
    "formatVersion": "1.0",
    "generator": "VOD Pipeline v0.1.0",
    "projectId": "proj_abc123"
  },
  "settings": {
    "frameRate": 30,
    "frameRateNumerator": 30,
    "frameRateDenominator": 1,
    "dropFrame": false,
    "timecodeFormat": "HH:MM:SS:FF",
    "resolution": {
      "width": 1920,
      "height": 1080,
      "aspectRatio": "16:9"
    },
    "duration": {
      "frames": 54000,
      "timecode": "00:30:00:00",
      "seconds": 1800
    }
  },
  "assets": [
    {
      "id": "asset_001",
      "name": "VOD_Part1.mp4",
      "path": "/Users/editor/projects/VOD/assets/VOD_Part1.mp4",
      "duration": {
        "frames": 54000,
        "timecode": "00:30:00:00",
        "seconds": 1800
      },
      "startTimecode": "01:00:00:00",
      "hasVideo": true,
      "hasAudio": true,
      "metadata": {
        "width": 1920,
        "height": 1080,
        "frameRate": 30,
        "bitrate": 6000000,
        "codec": "h264"
      }
    },
    {
      "id": "asset_002",
      "name": "VOD_Part2.mp4",
      "path": "/Users/editor/projects/VOD/assets/VOD_Part2.mp4",
      "duration": {
        "frames": 108000,
        "timecode": "01:00:00:00",
        "seconds": 3600
      },
      "startTimecode": "00:00:00:00",
      "hasVideo": true,
      "hasAudio": true
    }
  ],
  "clips": [
    {
      "id": "clip_001",
      "assetId": "asset_001",
      "track": 1,
      "trackType": "video",
      "startTime": {
        "frames": 0,
        "timecode": "00:00:00:00",
        "seconds": 0
      },
      "duration": {
        "frames": 1800,
        "timecode": "00:01:00:00",
        "seconds": 60
      },
      "sourceIn": {
        "frames": 900,
        "timecode": "00:00:30:00",
        "seconds": 30
      },
      "sourceOut": {
        "frames": 2700,
        "timecode": "00:01:30:00",
        "seconds": 90
      },
      "name": "Introduction - The Setup",
      "enabled": true,
      "speed": 1
    },
    {
      "id": "clip_002",
      "assetId": "asset_001",
      "track": 1,
      "trackType": "video",
      "startTime": {
        "frames": 1800,
        "timecode": "00:01:00:00",
        "seconds": 60
      },
      "duration": {
        "frames": 3600,
        "timecode": "00:02:00:00",
        "seconds": 120
      },
      "sourceIn": {
        "frames": 4500,
        "timecode": "00:02:30:00",
        "seconds": 150
      },
      "sourceOut": {
        "frames": 8100,
        "timecode": "00:04:30:00",
        "seconds": 270
      },
      "name": "First Segment - The Conflict",
      "enabled": true
    }
  ],
  "beats": [
    {
      "id": "beat_001",
      "time": {
        "frames": 900,
        "timecode": "00:00:30:00",
        "seconds": 30
      },
      "label": "Setup: Introduce main premise",
      "color": "#FFA500",
      "type": "setup",
      "description": "This is where the video establishes the core concept that will be explored",
      "confidence": 0.92,
      "clipId": "clip_001"
    },
    {
      "id": "beat_002",
      "time": {
        "frames": 5400,
        "timecode": "00:03:00:00",
        "seconds": 180
      },
      "label": "Twist: Unexpected revelation",
      "color": "#FF0000",
      "type": "twist",
      "description": "A turning point that changes the narrative direction",
      "confidence": 0.87,
      "clipId": "clip_002"
    }
  ],
  "segments": [
    {
      "id": "segment_001",
      "title": "Opening Hook",
      "description": "First 30 seconds - grab viewer attention",
      "startTime": {
        "frames": 0,
        "timecode": "00:00:00:00",
        "seconds": 0
      },
      "endTime": {
        "frames": 900,
        "timecode": "00:00:30:00",
        "seconds": 30
      },
      "color": "#4CAF50"
    },
    {
      "id": "segment_002",
      "title": "Main Content",
      "description": "Core video content",
      "startTime": {
        "frames": 900,
        "timecode": "00:00:30:00",
        "seconds": 30
      },
      "endTime": {
        "frames": 53100,
        "timecode": "00:29:30:00",
        "seconds": 1770
      },
      "color": "#2196F3"
    }
  ],
  "chapters": [
    {
      "id": "chapter_001",
      "name": "Part 1: The Setup",
      "assetIds": ["asset_001"],
      "order": 1
    },
    {
      "id": "chapter_002",
      "name": "Part 2: Deep Dive",
      "assetIds": ["asset_002"],
      "order": 2
    }
  ]
}
```

---

## XML/EDL Transformation

### JSON → FCPXML Transformation Strategy

#### Step 1: Timecode Conversion Functions

First, implement utility functions to convert between the different time representations:

```typescript
// Utility types for time representation
interface Time {
  frames: number;
  timecode: string;  // HH:MM:SS:FF
  seconds: number;
}

interface FrameRate {
  numerator: number;
  denominator: number;
  fps: number;
}

function framesToTimecode(frames: number, frameRate: FrameRate): string {
  const hours = Math.floor(frames / (3600 * frameRate.fps));
  const remaining = frames % (3600 * frameRate.fps);
  const minutes = Math.floor(remaining / (60 * frameRate.fps));
  const remaining2 = remaining % (60 * frameRate.fps);
  const seconds = Math.floor(remaining2 / frameRate.fps);
  const f = frames % Math.floor(frameRate.fps);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(f)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function framesToFCPXMLRational(frames: number, frameRate: FrameRate): string {
  return `${frames}/${Math.round(frameRate.denominator * frameRate.fps)}s`;
}

 // Convert decimal seconds to timecode
function secondsToTimecode(seconds: number, frameRate: FrameRate): string {
  const totalFrames = Math.floor(seconds * frameRate.fps);
  return framesToTimecode(totalFrames, frameRate);
}

// Convert timecode to frames
function timecodeToFrames(timecode: string, frameRate: FrameRate): number {
  const [h, m, s, fr] = timecode.split(':').map(Number);
  return (h * 3600 + m * 60 + s) * Math.floor(frameRate.fps) + fr;
}
```

#### Step 2: JSON to FCPXML Generator

```typescript
import { create } from 'xmlbuilder2';

interface FCPXMLOptions {
  version?: '1.0' | '1.1';
  includeMarkers?: boolean;
  includeTransitions?: boolean;
  namespace?: string;
}

export class JsonToFcpXmlConverter {
  constructor(private json: any, private options: FCPXMLOptions = {}) {
    this.options = {
      version: this.options.version || '1.0',
      includeMarkers: this.options.includeMarkers !== false,
      includeTransitions: this.options.includeTransitions || false,
      namespace: 'http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.0'
    };
  }

  convert(): string {
    const { json, options } = this;
    const totalFrames = json.settings.duration.frames;
    const frameRate: FrameRate = {
      numerator: json.settings.frameRateNumerator,
      denominator: json.settings.frameRateDenominator,
      fps: json.settings.frameRate
    };

    // Create root element
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('fcpxml', { version: options.version, xmlns: options.namespace });

    // Build resources section
    const resources = root.ele('resources');

    // Add format definition
    const formatId = `r1`;
    resources.ele('format', {
      id: formatId,
      name: `FFVideoFormat${json.settings.resolution.width}p`,
      width: json.settings.resolution.width,
      height: json.settings.resolution.height,
      frameDuration: `${frameRate.denominator}/${frameRate.numerator}s`,
      displayAspectRatio: json.settings.resolution.aspectRatio
    });

    // Add assets
    const assetMap = new Map<string, string>();
    json.assets.forEach((asset: any, index: number) => {
      const assetId = `r${index + 2}`;
      assetMap.set(asset.id, assetId);
      
      const assetEl = resources.ele('asset', {
        id: assetId,
        name: asset.name,
        src: asset.path.startsWith('/') ? `file://localhost${asset.path}` : asset.path,
        format: formatId,
        duration: framesToFCPXMLRational(asset.duration.frames, frameRate),
        hasVideo: asset.hasVideo ? '1' : '0',
        hasAudio: asset.hasAudio ? '1' : '0'
      });

      // Add media source timecode if available
      if (asset.startTimecode) {
        assetEl.ele('media-source', {
          src: asset.path
        }).ele('timecode', {
          displayFormat: 'NDF',
          source: 'file',
            string: asset.startTimecode,
            rate: { 
              ntsc: frameRate.fps === 29.97 || frameRate.fps === 59.94 ? 'TRUE' : 'FALSE', 
              timeScale: json.settings.frameRateNumerator, 
              framesPerSecond: json.settings.frameRate 
            }
        });
      }
    });

    // Build library section
    const library = root.ele('library');
    const event = library.ele('event', { name: json.meta.name });
    const project = event.ele('project', {
      name: json.meta.name,
      uuid: generateUUID()
    });
    
    const sequence = project.ele('sequence', {
      format: formatId,
      duration: framesToFCPXMLRational(totalFrames, frameRate)
    });
    
    const spine = sequence.ele('spine');

    // Organize clips by track
    const clipsByTrack = this.groupClipsByTrack(json.clips);
    
    // Add clips to spine - use a simple spine (single track for video)
    // For multi-track support, we'd need nested spine/clip constructs
    const sortedClips = json.clips
      .filter((clip: any) => clip.trackType === 'video')
      .sort((a: any, b: any) => a.startTime.frames - b.startTime.frames);

    let lastTimelineFrame = 0;
    
    sortedClips.forEach((clip: any) => {
      // Add gap if needed
      const offset = clip.startTime.frames - lastTimelineFrame;
      if (offset > 0) {
        spine.ele('gap', {
          offset: framesToFCPXMLRational(lastTimelineFrame, frameRate),
          duration: framesToFCPXMLRational(offset, frameRate)
        });
      }

      const assetId = assetMap.get(clip.assetId);
      if (!assetId) {
        console.warn(`Asset ${clip.assetId} not found for clip ${clip.id}`);
        return;
      }

      const duration = clip.duration.frames;
      const sourceIn = clip.sourceIn.frames;
      const sourceOut = clip.sourceOut.frames;

      spine.ele('asset-clip', {
        name: clip.name || clip.id,
        offset: framesToFCPXMLRational(clip.startTime.frames, frameRate),
        ref: assetId,
        duration: framesToFCPXMLRational(duration, frameRate),
        start: framesToFCPXMLRational(sourceIn, frameRate),
        enabled: clip.enabled ? '1' : '0'
      });

      // Add markers within clip if markers exist
      if (this.options.includeMarkers) {
        const clipMarkers = json.beats.filter((beat: any) => 
          beat.clipId === clip.id || 
          beat.time.frames > clip.startTime.frames && 
          beat.time.frames < (clip.startTime.frames + clip.duration.frames)
        );

        if (clipMarkers.length > 0) {
          // In FCPXML 1.1, markers can be embedded within clip
          if (options.version === '1.1') {
            clipMarkers.forEach((marker: any) => {
              const markerOffset = marker.time.frames - clip.startTime.frames;
              // Note: FCPXML marker placement is complex - this is simplified
            });
          }
        }
      }

      lastTimelineFrame = clip.startTime.frames + duration;
    });

    // Add timeline-level markers (FCPXML 1.1)
    if (this.options.includeMarkers && options.version === '1.1') {
      const markersEl = sequence.ele('marker');
      json.beats.forEach((beat: any) => {
        markersEl.ele('marker', {
          target: { id: 'clip-001' },
          startTime: framesToFCPXMLRational(beat.time.frames, frameRate),
          duration: '1/2997s',
          value: beat.label,
          type: beat.type.charAt(0).toUpperCase() + beat.type.slice(1) // Capitalize
        });
      });
    }

    return root.end({ prettyPrint: true });
  }

  private groupClipsByTrack(clips: any[]): Map<number, any[]> {
    const map = new Map<number, any[]>();
    clips.forEach(clip => {
      const trackNum = clip.track || 1;
      if (!map.has(trackNum)) {
        map.set(trackNum, []);
      }
      map.get(trackNum)!.push(clip);
    });
    return map;
  }
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

#### Example FCPXML Output

This is a complete FCPXML that Resolve should accept:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.0" xmlns="http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.0">
  <resources>
    <format id="r1" name="FFVideoFormat1080p" width="1920" height="1080" 
            frameDuration="1000/30000s" displayAspectRatio="16/9"/>
    <asset id="r2" name="VOD_Part1.mp4" src="file://localhost/Volumes/Media/VOD_Part1.mp4"
           format="r1" duration="54000/30000s" hasVideo="1" hasAudio="1"/>
  </resources>
  <library>
    <event name="Rough Cut">
      <project name="DougDoug VOD Edit">
        <sequence format="r1" duration="54000/30000s">
          <spine>
            <asset-clip offset="0/30000s" ref="r2" duration="1800/30000s" 
                       start="900/30000s" name="Introduction - The Setup"/>
            <asset-clip offset="1800/30000s" ref="r2" duration="3600/30000s" 
                       start="4500/30000s" name="First Segment - The Conflict"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
```

### JSON → EDL Transformation Strategy

```typescript
export class JsonToEdlConverter {
  private eventNumber = 1;
  private readonly MAX_REEL_NAME_LENGTH = 8;

  constructor(private json: any) {}

  convert(): string {
    const lines: string[] = [];
    
    // EDL header
    lines.push('TITLE: ' + this.json.meta.name);
    lines.push('');

    // Process clips
    const sortedClips = this.json.clips
      .filter((clip: any) => clip.trackType === 'video')
      .sort((a: any, b: any) => a.startTime.frames - b.startTime.frames);

    const frameRate = this.json.settings.frameRate;
    
    sortedClips.forEach((clip: any) => {
      const asset = this.json.assets.find((a: any) => a.id === clip.assetId);
      if (!asset) return;

      const reelName = this.truncateReelName(asset.name);
      const sourceIn = framesToTimecode(clip.sourceIn.frames, { fps: frameRate, numerator: 1, denominator: 1 });
      const sourceOut = framesToTimecode(clip.sourceOut.frames, { fps: frameRate, numerator: 1, denominator: 1 });
      const recordIn = framesToTimecode(clip.startTime.frames, { fps: frameRate, numerator: 1, denominator: 1 });
      const recordOut = framesToTimecode(clip.startTime.frames + clip.duration.frames, { fps: frameRate, numerator: 1, denominator: 1 });

      // Build EDL line
      const eventNum = this.eventNumber++;
      const edlLine = this.formatEdlLine(
        eventNum,
        reelName,
        'V',
        'C',
        sourceIn,
        sourceOut,
        recordIn,
        recordOut
      );
      lines.push(edlLine);

      // Add comment lines with source path
      lines.push(`* FROM CLIP NAME: ${asset.name}`);
      lines.push(`* FROM FILE: ${asset.path}`);
      lines.push('');
    });

    return lines.join('\n');
  }

  private formatEdlLine(
    eventNum: number,
    reelName: string,
    track: string,
    type: string,
    sourceIn: string,
    sourceOut: string,
    recordIn: string,
    recordOut: string
  ): string {
    // EDL uses fixed-width columns:
    // 001  CLIP001  V  C     00:00:30:00 00:01:00:00 00:00:00:00 00:00:30:00
    // |    |        |  |      |             |             |             |
    // |    |        |  |      |             |             |             |
    // 001  = Event number (3 chars)
    // CLIP001 = Reel name (8 chars)
    // V/A/B = Track type (1 char)
    // C/D/W = Transition type (1 char)
    // 00:00:30:00 = Source in (11 chars)
    // etc.
    
    const eventNumStr = eventNum.toString().padStart(3, ' ');
    const reelStr = reelName.padEnd(8, ' ').substring(0, 8);
    const trackStr = track.padEnd(1, ' ');
    const typeStr = type.padEnd(1, ' ');
    
    // Note: EDL is flexible on exact column width, but this is standard format
    return `${eventNumStr}  ${reelStr} ${trackStr} ${typeStr}     ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`;
  }

  private truncateReelName(name: string): string {
    // Remove file extension and truncate to 8 characters
    const baseName = name.replace(/\.[^/.]+$/, '');
    // Special handling: if no alphanumerics, use a fallback
    const alnumOnly = baseName.replace(/[^a-zA-Z0-9]/g, '');
    if (alnumOnly.length === 0) {
      return 'CLIP01';
    }
    return alnumOnly.substring(0, 8).padEnd(8, '_');
  }
}
```

#### Example EDL Output

```
TITLE: DougDoug VOD Edit - Episode 47

001  VOD_P001  V  C     00:00:30:00 00:01:30:00 00:00:00:00 00:01:00:00
* FROM CLIP NAME: VOD_Part1.mp4
* FROM FILE: /Volumes/Media/VOD_Part1.mp4

002  VOD_P001  V  C     00:02:30:00 00:04:30:00 00:01:00:00 00:03:00:00
* FROM CLIP NAME: VOD_Part1.mp4
* FROM FILE: /Volumes/Media/VOD_Part1.mp4
```

### Node.js Libraries for XML Generation

Based on available npm packages:

| Library | Popularity | Features | Recommended |
|---------|-----------|----------|-------------|
| `xmlbuilder2` | High | Modern, streamable, TypeScript support | **YES** |
| `fast-xml-parser` | High | Fast, parser + builder, good for validation | **YES** |
| `js2xmlparser` | Medium | Simple object-to-XML conversion | Maybe |
| `xml-js` | Medium | Bidirectional conversion | Maybe |
| `xml2js` | Medium (older) | Classic library, still maintained | Maybe |

**Recommended:** `xmlbuilder2` for generating FCPXML due to:
- Modern API with good TypeScript support
- Namespaces support (critical for FCPXML)
- Pretty printing options
- Active maintenance

```bash
pnpm add xmlbuilder2
pnpm add -D @types/xmlbuilder2
```

---

## Resolve-Specific Requirements

### Clip References (Paths)

**Absolute vs. Relative Paths:**

DaVinci Resolve handles both absolute and relative paths, but with different behaviors:

| Path Type | Format | Behavior | Recommendation |
|-----------|--------|----------|----------------|
| Absolute | `/Users/name/Projects/file.mp4` | Works if media exists at that exact location | Use when media location is fixed |
| Relative | `../assets/file.mp4` | Resolved relative to project file location | Use for portable projects |
| URI | `file://localhost/path/to/file.mp4` | Required for FCPXML `src` attribute | **Required for FCPXML** |

**FCPXML URI Format:**
```xml
<!-- Absolute path as URI -->
<asset src="file://localhost/Volumes/Media/File.mp4"/>

<!-- Network paths -->
<asset src="file://localhost/Network/Server/File.mp4"/>
```

**Best Practices:**
1. **For internal use:** Store absolute paths in JSON, convert to URI for FCPXML
2. **For portability:** Store relative paths in JSON, resolve against project root before export
3. **Path resolution:** Always validate paths exist before export
4. **Missing media:** Resolve will prompt to relink clips if path is invalid

### Frame Rate Considerations

**Supported Frame Rates:**
- 23.976 fps (24000/1001) - Film standard
- 24 fps (24/1)
- 25 fps (25/1) - PAL
- 29.97 fps (30000/1001) - NTSC, common for YouTube
- 30 fps (30/1)
- 50 fps (50/1)
- 59.94 fps (60000/1001)
- 60 fps (60/1)

**FCPXML Frame Rate Representation:**

For 29.97 fps:
```xml
<format frameDuration="1001/30000s"/>
<!-- numerator = 1001, denominator = 30000 -->
```

For 30 fps:
```xml
<format frameDuration="1/30s"/>
<!-- numerator = 1, denominator = 30 -->
```

**Drop Frame Handling:**

Drop frame timecode compensates for the difference between 29.97 and 30 fps real-time. FCPXML supports it:

```xml
<timecode displayFormat="DF" source="file">
  <rate ntsc="TRUE" timeScale="30000" framesPerSecond="29.97"/>
  <string>00:00:00;00</string>
  <!-- Note semicolon (;) instead of colon (:) for drop frame -->
</timecode>
```

**Common Issue:**
If source media is 29.97 but you export EDL with 30fps timecode, Resolve will need to conform. Always match frame rates.

### Timecode Format

**FCPXML Timecode:**
- Format: Rational fractions (e.g., `"900/30000s"`)
- Frames only: `frames/totalFrames`
- Drop frame: Use `displayFormat="DF"` attribute

**EDL Timecode:**
- Format: `HH:MM:SS:FF`
- Examples:
  - `00:00:30:00` (30 seconds)
  - `01:00:00:00` (1 hour)
- Drop frame: Use semicolon `00:00:00;00` (but EDL support varies)

**JSON Timecode:**
- Store all three representations for flexibility:
  ```json
  {
    "frames": 900,
    "timecode": "00:00:30:00",
    "seconds": 30.0
  }
  ```

### XML Namespaces and Versioning

**FCPXML Namespaces:**

| Version | Namespace URL | Notes |
|---------|--------------|-------|
| 1.0 | `http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.0` | Basic support, widely compatible |
| 1.1 | `http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.1` | Added markers, roles, advanced effects |
| 1.2+ | Various | Final Cut Pro specific extensions |

**Recommendation:**
- Use FCPXML 1.0 for maximum compatibility with Resolve
- Only use 1.1+ if you need markers or specific features
- Always include namespace in `<fcpxml>` tag

```xml
<fcpxml version="1.0" xmlns="http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.0">
```

**Resolve Quirks:**

1. **Gap Handling:** Resolve prefers explicit `<gap>` elements rather than inferring gaps from clip positions

2. **Asset References:** Ensure every clip's `ref` attribute matches an existing asset `id`

3. **Duration Consistency:** The sum of clip durations must match sequence duration

4. **Empty Spine:** Resolve may reject XML with `<spine></spine>` - add at least one clip or gap

5. **Rate Conforming:** If asset frame rate differs from sequence frame rate, Resolve will conform but may introduce rendering issues

---

## Alternative Approaches

### Direct Generation of Resolve Project Files (.drp)

**Is it feasible?**

Short answer: **NO**, not without reverse engineering.

**Why not:**

1. **Proprietary Binary Format:** `.drp` files are a proprietary Blackmagic binary format
2. **No Public Documentation:** Blackmagic has not published specifications
3. **Encryption/Obfuscation:** Project files may use encryption or proprietary compression
4. **Legal Issues:** Reverse engineering proprietary formats may violate terms of service

**Possible Workarounds:**

| Approach | Feasibility | Effort | Notes |
|----------|-------------|--------|-------|
| Reverse engineering | Low | Very high | Legal concerns, likely break on updates |
| Use Resolve API | Medium | Medium | Requires scripting plugin access, not programmatic export |
| Export from Resolve UI | High | Low | Not programmatic, manual workflow |

**Conclusion:** Not viable for an automated export system. Stick to standard interchange formats.

### Third-Party Conversion Tools

**Open Source Tools:**

1. **XtoCC (XML to Creative Cloud):**
   - Purpose: Final Cut Pro FCPXML to Premiere Pro
   - Might work for Resolve as intermediate
   - Commercial, not programmable

2. **Shotcut:**
   - Open source NLE with EDL/XML import/export
   - Could potentially script conversions
   - May introduce rounding errors

3. **MLT Framework:**
   - Open source multimedia framework
   - Supports EDL, XML (kdenlive format)
   - Possible as conversion engine
   - Complex to integrate

4. **Python Libraries:**
   - `ffmpeg-python`: For video operations
   - Custom scripts for XML/EDL generation
   - More flexible than trying to use existing tools

**Workflow with External Tools:**

```bash
# Example workflow using ffmpeg for conforming
ffmpeg -i source.mp4 -c:v libx264 -c:a aac -r 29.97 conformed.mp4

# Then generate EDL from original JSON
node generate-edl.js cutlist.json > project.edl

# Import into Resolve, let it handle relinking
```

**Recommendation:** Implement built-in JSON → FCPXML/EDL conversion rather than relying on third-party tools. The transformations are straightforward enough to implement in TypeScript.

---

## Recommendation

### Primary Format: JSON

**Rationale:**

1. **Human Readable:** Easy for users to inspect and debug
2. **Programmatic Access:** Native JS/TS objects, minimal parsing overhead
3. **Extensible:** Easy to add new fields without breaking changes
4. **Version Controlled:** Git-friendly diff tools work well
5. **Low Overhead:** No heavy libraries required

**Use for:**

- Internal project storage
- AI agent conversation context
- Application state persistence
- User viewing/editing (with UI)
- Source of truth for export transformations

### Export Formats: XML + EDL

**Export Tiers:**

| Export Target | Format | Complexity | When to Use |
|--------------|--------|------------|-------------|
| DaVinci Resolve | FCPXML | Medium | Primary export, full feature support |
| Legacy NLEs | EDL | Low | Fallback, basic cuts only |
| Other Apps | JSON | N/A | Custom workflows, API integration |

**Recommended Implementation:**

```typescript
// Export service structure
class ExportService {
  async exportToFCPXML(projectPath: string, outputPath: string): Promise<void>
  async exportToEDL(projectPath: string, outputPath: string): Promise<void>
  async exportToJSON(projectPath: string, outputPath: string): Promise<void>
  
  // Batch export
  async exportAll(projectPath: string, outputDir: string): Promise<{
    fcpxml: string;
    edl: string;
    json: string;
    report: ExportReport;
  }>
}
```

### Next Steps

1. **Phase 1:** Implement JSON schema and internal format
2. **Phase 2:** Implement JSON → FCPXML converter with basic clip support
3. **Phase 3:** Add markers (beats) to FCPXML exports (requires FCPXML 1.1)
4. **Phase 4:** Implement JSON → EDL converter for fallback
5. **Phase 5:** Add validation (path checking, media verification)
6. **Phase 6:** Add export presets (different frame rates, formats)

### Testing Strategy

1. **Unit Tests:** Timecode conversion functions
2. **Integration Tests:**
   - Generate FCPXML from sample JSON
   - Import into actual Resolve installation
   - Verify clip placement and timing
3. **Path Tests:** Absolute vs relative, missing files
4. **Edge Cases:** Drop frame, mixed frame rates, very long timelines

---

## Appendix: Quick Reference

### FCPXML Element Hierarchy

```
fcpxml (root)
├── resources
│   ├── format (defines resolution, frame rate)
│   └── asset (defines source media)
│       └── media-source
│           └── timecode
└── library
    └── event
        └── project
            └── sequence
                ├── format (reference to r1)
                ├── spine
                │   ├── asset-clip (video clips)
                │   │   └── rating (effects, transitions)
                │   ├── gap (empty space)
                │   └── audio-clip (audio if separate tracks)
                └── marker (timeline-level markers)
```

### EDL Line Format

```
001  CLIP001  V  C     00:00:30:00 00:01:30:00 00:00:00:00 00:01:00:00
 |    |       |  |      |             |             |             |
 |    |       |  |      |             |             |             +-- Record Out
 |    |       |  |      |             |             +----------------- Record In
 |    |       |  |      |             +----------------------------- Source Out
 |    |       |  |      +------------------------------------------- Source In
 |    |       |  +---------------------------------- Transition Type (C=Cut)
 |    |       +------------------------------------- Track Type (V=Video, A=Audio, B=Black)
 |    +--------------------------------------------- Reel Name (8 chars max)
 +-------------------------------------------------- Event Number
```

### JSON Schema Summary

| Section | Purpose | Required Fields |
|---------|---------|-----------------|
| `meta` | Project metadata | name, createdAt, formatVersion |
| `settings` | Timeline config | frameRate, timecodeFormat, duration |
| `assets` | Source media list | id, name, path, duration |
| `clips` | Timeline clips | id, assetId, startTime, sourceIn, sourceOut |
| `beats` | Story markers | time, label |
| `segments` | Chapter markers | title, startTime, endTime |
| `chapters` | Organization | name, assetIds |

---

**Document Version:** 1.0  
**Last Updated:** January 23, 2026  
**Author:** VOD Pipeline Project Research
