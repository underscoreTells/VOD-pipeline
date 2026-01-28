# Multi-Track Audio Handling in Video Editing Pipelines

**Date:** January 26, 2026  
**Project:** VOD Pipeline - AI-Assisted Video Editor  
**Focus:** Multi-track audio support for MKV imports, timeline UI, and NLE exports

---

## Table of Contents

1. [Overview](#overview)
2. [MKV and Multi-Track Audio](#mkv-and-multi-track-audio)
3. [FFmpeg Commands for Audio Track Management](#ffmpeg-commands-for-audio-track-management)
4. [Timeline UI Display for Multi-Track Audio](#timeline-ui-display-for-multi-track-audio)
5. [Export Format Handling](#export-format-handling)
6. [User Control Over Audio Tracks](#user-control-over-audio-tracks)
7. [Implementation Considerations](#implementation-considerations)
8. [Recommendations](#recommendations)

---

## Overview

Multi-track audio is essential for modern video editing workflows, especially for:
- **VOD content**: Game audio + commentary + music + sound effects tracks
- **Multilingual content**: Original audio + dubbed language tracks
- **Surround sound**: 5.1 or 7.1 channel configurations
- **Commentary tracks**: Primary audio + optional director/host commentary

The VOD Pipeline needs to support:
1. **Importing** MKV files with multiple audio tracks
2. **Displaying** all available audio tracks in the timeline UI
3. **Allowing users** to select, rename, reorder, mute/solo individual tracks
4. **Exporting** with track preservation or customizable mixing
5. **NLE compatibility**: Generate FCPXML/EDL that DaVinci Resolve and Premiere Pro understand

---

## MKV and Multi-Track Audio

### How MKV Files Encode Multiple Audio Tracks

MKV (Matroska Video) is a container format designed to store unlimited numbers of video, audio, and subtitle tracks. Unlike MP4 which has limited multi-audio support in some applications, MKV natively supports complex audio structures.

**MKV Audio Track Structure:**
```
MKV Container
├── Video Track (Track 1)
├── Audio Track 1 (Track 2)    # Game audio
├── Audio Track 2 (Track 3)    # Commentary
├── Audio Track 3 (Track 4)    # Music
└── Subtitle Track (Track 5)
```

Each audio track can have:
- **Track ID**: Numerical identifier (e.g., 0, 1, 2)
- **Language Code**: ISO 639-2/3 codes (e.g., `eng`, `jpn`, `und`)
- **Channel Configuration**: Mono, stereo, 5.1, 7.1, etc.
- **Title**: Custom track name (e.g., "Game Audio", "Commentary")
- **Default Flag**: Whether this track should be default for playback

### Track Metadata Structure

FFmpeg shows this structure when probing MKV files:

```json
{
  "streams": [
    {
      "index": 0,
      "codec_type": "video",
      "codec_name": "h264",
      "width": 1920,
      "height": 1080
    },
    {
      "index": 1,
      "codec_type": "audio",
      "codec_name": "aac",
      "channels": 2,
      "channel_layout": "stereo",
      "bit_rate": 192000,
      "sample_rate": 48000,
      "tags": {
        "language": "eng",
        "title": "Game Audio",
        "default": "1"
      }
    },
    {
      "index": 2,
      "codec_type": "audio",
      "codec_name": "aac",
      "channels": 2,
      "channel_layout": "stereo",
      "sample_rate": 48000,
      "tags": {
        "language": "eng",
        "title": "Commentary"
      }
    },
    {
      "index": 3,
      "codec_type": "audio",
      "codec_name": "aac",
      "channels": 2,
      "channel_layout": "stereo",
      "sample_rate": 48000,
      "tags": {
        "language": "eng",
        "title": "Music & SFX"
      }
    }
  ]
}
```

### Common Use Cases

| Use Case | Track Configuration | Example |
|----------|-------------------|---------|
| **VOD Editing** | Game audio + commentary + music | 3-4 stereo tracks |
| **Multilingual** | Original audio + dubbed tracks | 2+ language tracks |
| **Surround Mix** | 5.1 master + stereo commentary | 6 channels + 2 channels |
| **Regional Variants** | Different audio regions | Multiple language codes |
| **Commentary Tracks** | Main audio + optional commentary | Toggleable track |
| **Music Videos** | Instrumental + vocal stems | Separated audio layers |

### Language Codes

Common ISO 639-2/3 language codes:

| Code | Language | Use Case |
|------|----------|----------|
| `eng` | English | Default for most VODs |
| `und` | Undetermined | When no language is specified |
| `jpn` | Japanese | Anime content |
| `spa` | Spanish | Dubbed content |
| `fre` | French | European content |
| `deu` | German | European content |

### Channel Configurations

| Channels | Layout | Typical Use |
|----------|--------|-------------|
| 1 | Mono | Single microphone commentary |
| 2 | Stereo | Standard VOD audio |
| 3 | 2.1 | Stereo + LFE |
| 6 | 5.1 | Surround sound productions |
| 8 | 7.1 | High-end surround |

---

## FFmpeg Commands for Audio Track Management

### Discover Audio Tracks

**Probe file to show all tracks:**
```bash
ffprobe -v quiet -print_format json -show_streams -show_format input.mkv
```

**Show only audio tracks with details:**
```bash
ffprobe -v quiet -select_streams a -show_entries stream=index,codec_name,channels,channel_layout,tags -of csv=p=0 input.mkv
```

**Output format:**
```
1,aac,2,stereo,language=eng|title=Game Audio|default=1
2,aac,2,stereo,language=eng|title=Commentary
3,aac,2,stereo,language=eng|title=Music
```

**Get stream count by type:**
```bash
ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 input.mkv | wc -l
```

### Extract Specific Audio Tracks

**Extract track index 1 to WAV:**
```bash
ffmpeg -i input.mkv -map 0:a:0 -c:a pcm_s16le audio_track_1.wav
```

**Extract all audio tracks to separate files:**
```bash
ffmpeg -i input.mkv -map 0:a:0 -c:a pcm_s16le track_1.wav \
                   -map 0:a:1 -c:a pcm_s16le track_2.wav \
                   -map 0:a:2 -c:a pcm_s16le track_3.wav
```

**Extract track by language code:**
```bash
# Extract English audio track
ffmpeg -i input.mkv -map 0:m:language:eng audio_eng.aac

# Extract Japanese audio track
ffmpeg -i input.mkv -map 0:m:language:jpn audio_jpn.aac
```

**Extract track by title:**
```bash
# Note: FFmpeg doesn't directly support -map by title, use script approach
# Get track index first, then extract
TRACK_INDEX=$(ffprobe -v error -select_streams a -show_entries stream=index,tags -of csv=p=0 input.mkv | grep "Commentary" | cut -d',' -f1)
ffmpeg -i input.mkv -map 0:a:$TRACK_INDEX commentary.wav
```

### Remux with Track Selection

**Keep only specific audio tracks:**
```bash
# Keep video + track 1 only
ffmpeg -i input.mkv -map 0:v -map 0:a:0 -c copy output.mkv

# Keep video + tracks 0 and 2 (skip track 1)
ffmpeg -i input.mkv -map 0:v -map 0:a:0 -map 0:a:2 -c copy output.mkv
```

**Reorder audio tracks:**
```bash
# Move track 2 to position 1, track 1 to position 2
ffmpeg -i input.mkv -map 0:v -map 0:a:1 -map 0:a:0 -c copy output.mkv
```

**Change default audio track:**
```bash
# Make track index 1 (original track 2) the default
ffmpeg -i input.mkv -map 0:v -map 0:a:1 -map 0:a:0 -disposition:a:0 default -disposition:a:1 0 -c copy output.mkv
```

### Downmix/Mix Audio Tracks

**Mix two stereo tracks to one stereo track:**
```bash
ffmpeg -i input.mkv -filter_complex "[0:a:0][0:a:1]amerge=inputs=2,pan=stereo|c0<c0+c2|c1<c1+c3[aout]" -map 0:v -map "[aout]" output.mp4
```

**Downmix 5.1 to stereo:**
```bash
ffmpeg -i input.mkv -map 0:v -map 0:a -ac 2 -c:v copy -c:a aac output.mp4
```

**Create custom mix:**
```bash
# Mix track 1 at 100%, track 2 at 50%, track 3 at 20%
ffmpeg -i input.mkv -filter_complex "[0:a:0]volume=1.0[a0];[0:a:1]volume=0.5[a1];[0:a:2]volume=0.2[a2];[a0][a1][a2]amerge=inputs=3,pan=stereo|c0<c0+c3+c6|c1<c1+c4+c7[aout]" -map 0:v -map "[aout]" output.mp4
```

### Add/Modify Track Metadata

**Add language tag:**
```bash
ffmpeg -i input.mkv -map 0 -c copy -metadata:s:a:0 language=eng output.mkv
```

**Add custom title to track:**
```bash
ffmpeg -i input.mkv -map 0 -c copy -metadata:s:a:1 title="Commentary Track" output.mkv
```

**Set default track:**
```bash
# Set track index 1 as default
ffmpeg -i input.mkv -map 0 -c copy -disposition:a:0 default -disposition:a:1 0 output.mkv
```

### Export with Track Selection

**Export all tracks:**
```bash
ffmpeg -i input.mkv -c copy output.mkv
```

**Export only video + default audio:**
```bash
ffmpeg -i input.mkv -map 0:v -map 0:a:0? -c copy output.mkv
```

**Export with selected tracks:**
```bash
# Video + tracks 0, 2 (skip 1)
ffmpeg -i input.mkv -map 0:v -map 0:a:0 -map 0:a:2 -c copy output.mkv
```

### Useful FFmpeg Flag Reference

| Flag | Description |
|------|-------------|
| `-map 0:a:0` | Select audio track 0 from input 0 |
| `-map 0:m:language:eng` | Select all streams tagged with language=eng |
| `-map 0:v` | Select all video streams |
| `-map 0:a` | Select all audio streams |
| `-map -0:a:1` | Remove/negative map audio track 1 |
| `-c copy` | Copy streams without re-encoding |
| `-c:a aac` | Encode audio streams as AAC |
| `-ac 2` | Set audio channels to 2 (downmix) |
| `-disposition:a:0 default` | Set audio track 0 as default |
| `-metadata:s:a:0 key=value` | Add metadata to audio track 0 |

---

## Timeline UI Display for Multi-Track Audio

### Industry Standard Patterns

#### DaVinci Resolve Audio Track Display

**Track Header:**
```
┌─────────────────────────────────────┐
│ 🎵 Audio 1 (Game Audio)             │
│ 🔊 [===M===]  L/R  📢  🔒          │
│ Vol: 0dB  Pan: C  Solo: Off         │
└─────────────────────────────────────┘
```

**Features:**
- **Track Selector**: Dropdown to show/hide individual audio tracks
- **Track Name**: User editable (e.g., "Game Audio", "Commentary")
- **Mute/Solo Buttons**: M (mute), S (solo) per track
- **Volume Fader**: Visual level fader with dB readout
- **Pan Control**: Stereo panning (L-C-R positions or radial)
- **Lock Toggle**: Lock track from edits
- **Track Color**: Color-coded for visual organization
- **Waveform Display**: Show/hide waveform toggle

**Track Selection Dropdown:**
```
Audio Tracks:
☑ Video 1 (Game Audio)
☑ Audio 2 (Commentary)
☐ Audio 3 (Music)
☐ Audio 4 (Sound Effects)
☐ Audio 5 (Ambience)
```

#### Adobe Premiere Pro Audio Track Display

**Track Header Structure:**
```
┌────────────────────────────────────────────┐
│ A1  Game Audio  🔊━━━┃━━━🔊  M  S  🎚     │
├────────────────────────────────────────────┤
│ □ Auto-duck: Off  ○ Keyframe Mode: All     │
└────────────────────────────────────────────┘
```

**Features:**
- **Track ID**: A1, A2, A3 (audio tracks numbered sequentially)
- **Track Name**: Editable text field
- **Volume Clip Level**: Handles and keyframing for clip-level volume
- **Mute/Solo**: M (mute), S (solo) with visual indicators
- **Track Mixer Panel**: Separate panel with full mixing controls
- **Automation Modes**: Off, Read, Write, Latch, Touch

#### Final Cut Pro Audio Track Display

**Track Header:**
```
┌──────────────────────────────────────┐
│ 🔊 Audio 1  Game Audio  ♪  🔒        │
├──────────────────────────────────────┤
│ [====|====]  Vol: 0dB  Pan: C        │
│ 🎛  Effects: None                    │
└──────────────────────────────────────┘
```

**Features:**
- **Roles**: Assign roles (Dialogue, Music, Effects, Ambience)
- **Lane Visibility**: Toggle track display
- **Clip Label Colors**: Color-coding by role
- **Audio Metering**: Peak/RMS metering per track

### Recommended UI Pattern for VOD Pipeline

#### Track Header Component

```
┌──────────────────────────────────────────────────┐
│ A1 ┃ [Game Audio] 🎵  🔊─────────🔊  [M] [S] 🔒 │
│    ┃ 📊 🧊 📎 💾  Vol: -3dB  Pan: C  🔇 1/3      │
└──────────────────────────────────────────────────┘
```

**Elements:**
- **Track ID**: A1, A2, A3 (auto-numbered)
- **Track Name**: Editable text field (click to edit)
- **Track Type Icon**: 🎵 (stereo), 🔈 (mono), 🎧 (5.1), 🎬 (commentary)
- **Track Visibility Toggle**: Eye icon (show/hide)
- **Waveform Toggle**: 📊 (show/hide waveforms)
- **Freeze Frame Hold**: 🧊 for audio reference
- **Lock**: 🔒 lock track from edits
- **Mute**: M button (toggle)
- **Solo**: S button (toggle exclusive solo)
- **Volume Fader**: Visual fader with dB readout
- **Pan Control**: L/C/R or radial pan
- **Track Count**: 🔇 1/3 shows 1 of 3 tracks active
- **Audio Effects Chain**: Clickable to view/add effects

#### Track Selection Panel

```
┌────────────────────────────────────┐
│ Audio Track Manager                │
├────────────────────────────────────┤
│ ☑ A1 - Game Audio  (Stereo)       │
│ ☑ A2 - Commentary  (Stereo)       │
│ ☐ A3 - Music  (Stereo)            │
│ ☐ A4 - SFX  (Stereo)              │
│                                    │
│ [Select All]  [Deselect All]      │
│ [Mix to Stereo]  [Keep Separate]  │
└────────────────────────────────────┘
```

**Controls:**
- **Checkbox per track**: Enable/disable for playback/export
- **Track info**: Show channel count and language
- **Select/Deselect All**: Batch operations
- **Mix to Stereo**: Render all selected tracks to single stereo
- **Keep Separate**: Export each track independently
- **Reorder**: Drag and drop to reorder tracks

#### Audio Mixer Panel (Dedicated)

```
┌──────────────────────────────────────────────────────┐
│ Audio Mixer                                          │
├──────────────────────────────────────────────────────┤
│ Master                                              │
│ [■■■■■■■■■]  Vol: -1.2dB  Clipping: 0 times       │
│                                                      │
│ Track Controls (per track)                          │
│ A1 [Game Audio]   [■■■■□]  -3dB  [C]  ☐  ☐         │
│ A2 [Commentary]  [■■■□□]  -6dB  [C]  ☑  ☐         │
│ A3 [Music]       [■■■□□]  -12dB [C]  ☐  ☑         │
│                                                      │
│ [M] = Mute  [S] = Solo  [C] = Pan Center           │
└──────────────────────────────────────────────────────┘
```

**Features:**
- **Master Output**: Overall level meter with clipping detection
- **Per-Track Faders**: Visual level control with dB display
- **Mute/Solo Buttons**: Per-track mute and exclusive solo
- **Pan Control**: Stereo panning (L-C-R dropdown or radial)
- **Track Metering**: Peak/RMS metering with clipping indicators

#### Timeline Track Color Coding

Standard track colors for visual clarity:

| Role | Color | Use Case |
|------|-------|----------|
| Dialogue/Game | Blue | Primary audio track |
| Commentary | Orange | Optional voice track |
| Music | Purple | Background music |
| Effects | Green | Sound effects |
| Ambience | Teal | Atmosphere/ambient |
| Unclassified | Gray | Default for unmapped tracks |

### Interactive Controls

#### Per-Track Controls

```typescript
interface AudioTrackControl {
  id: string;              // Track UUID
  name: string;            // Display name (editable)
  trackNumber: number;     // Sequential number (A1, A2, A3)
  sourceTrackIndex: number; // Original stream index from media
  channelCount: number;    // 1 (mono), 2 (stereo), 6 (5.1), 8 (7.1)
  languageCode: string;    // ISO 639-2/3 language code
  sampleRate: number;      // 48000, 44100, etc.
  
  // Playback controls
  enabled: boolean;        // Track visible/enabled in timeline
  muted: boolean;          // Track muted (silence)
  solo: boolean;           // Solo mode (only this track plays)
  
  // Level controls
  volumeDb: number;        // Volume in dB (0 = unity, negative = quieter)
  pan: number;             // -1 (left) to 1 (right), 0 = center
  
  // Display options
  showWaveform: boolean;   // Show waveform visualization
  color: string;           // Track color for visual identification
  locked: boolean;         // Lock track from edits
  
  // Export options
  exportEnabled: boolean;  // Include this track in export
  exportMixdown: boolean;  // Mix this track into stereo output
  exportSeparate: boolean; // Export this track as separate file
}
```

#### Bulk Operations

**Solo Logic:**
- When multiple tracks have `solo: true`, all solo tracks play, others are muted
- When only one track has `solo: true`, only that track plays
- When no tracks have `solo: true`, follow `muted` state

**Export Logic:**
```typescript
interface ExportAudioSettings {
  // Mode selection
  mode: 'mix-all' | 'select-tracks' | 'keep-separate';
  
  // For 'mix-all' mode
  mixdownFormat: 'stereo' | 'surround-51' | 'surround-71';
  mixdownCodec: 'aac' | 'mp3' | 'wav' | 'flac';
  mixdownBitrate: number;  // kbps (e.g., 192 for AAC)
  
  // For 'select-tracks' mode
  selectedTrackIds: string[];
  
  // For 'keep-separate' mode
  preserveTrackNames: boolean;
  trackNamingPattern: 'original' | 'sequential' | 'custom';
  
  // Advanced options
  normalizeAudio: boolean;
  targetLevel: number;  // LUFS (e.g., -16 for YouTube)
  removeSilence: boolean;
  crossfadeTracks: boolean;
}
```

---

## Export Format Handling

### FCPXML Multi-Track Audio

#### FCPXML 1.0 Audio Structure

FCPXML represents audio tracks within the `<spine>` element, with each track on its own `<audio-clip>` element:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.0" xmlns="http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.0">
  <resources>
    <!-- Format definitions -->
    <format id="r1" name="FFVideoFormat1080p" width="1920" height="1080" 
            frameDuration="1000/30000s" displayAspectRatio="16/9"/>
    
    <!-- Source media assets -->
    <asset id="v1" name="vod_stream.mkv" src="file://localhost/path/to/vod_stream.mkv"
           format="r1" duration="180000/30000s" hasVideo="1" hasAudio="1"/>
    
    <!-- Audio-only assets if separate files -->
    <asset id="a1" name="game_audio.wav" src="file://localhost/path/to/game_audio.wav"
           format="r1" duration="180000/30000s" hasVideo="0" hasAudio="1"/>
    <asset id="a2" name="commentary.wav" src="file://localhost/path/to/commentary.wav"
           format="r1" duration="180000/30000s" hasVideo="0" hasAudio="1"/>
    <asset id="a3" name="music.wav" src="file://localhost/path/to/music.wav"
           format="r1" duration="180000/30000s" hasVideo="0" hasAudio="1"/>
  </resources>
  
  <library>
    <event name="VOD Rough Cut">
      <project name="VOD Episode 47">
        <sequence format="r1" duration="180000/30000s">
          
          <!-- Timeline structure -->
          <spine>
            <!-- Video track (first in spine) -->
            <video-clip offset="0/30000s" ref="v1" name="VOD Stream" duration="180000/30000s">
              <audio-clip offset="0/30000s" ref="a1" name="Game Audio" duration="180000/30000s">
                <audio-source src="file://localhost/path/to/game_audio.wav"/>
              </audio-clip>
            </video-clip>
            
            <!-- Additional audio tracks as separate clips -->
            <audio-clip offset="0/30000s" ref="a2" name="Commentary" duration="180000/30000s">
              <audio-source src="file://localhost/path/to/commentary.wav"/>
            </audio-clip>
            
            <audio-clip offset="0/30000s" ref="a3" name="Music" duration="180000/30000s">
              <audio-source src="file://localhost/path/to/music.wav"/>
            </audio-clip>
          </spine>
          
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
```

#### FCPXML 1.1 Roles-Based Audio

FCPXML 1.1 introduces `<role>` elements for audio organization:

```xml
<fcpxml version="1.1" xmlns="http://www.apple.com/FinalCutPro/XML/InterchangeFormatVersion1.1">
  <resources>
    <format id="r1" name="FFVideoFormat1080p" width="1920" height="1080" 
            frameDuration="1000/30000s" displayAspectRatio="16/9"/>
    
    <!-- Define audio roles -->
    <role id="r1" uniqueID="1" title="Dialogue" type="dialogue" icon="Dialogue"/>
    <role id="r2" uniqueID="2" title="Music" type="music" icon="Music"/>
    <role id="r3" uniqueID="3" title="Effects" type="effects" icon="Effects"/>
    <role id="r4" uniqueID="4" title="Dialogue-Character" type="dialogue" subrole="character1"/>
    
    <asset id="v1" name="vod_stream.mkv" src="file://localhost/path/to/vod_stream.mkv"
           format="r1" duration="180000/30000s" hasVideo="1" hasAudio="1"/>
  </resources>
  
  <library>
    <event name="VOD Rough Cut">
      <project name="VOD Episode 47">
        <sequence format="r1" duration="180000/30000s">
          <spine>
            <!-- Video with embedded dialogue track -->
            <video-clip offset="0/30000s" ref="v1" name="VOD Stream" duration="180000/30000s">
              <audio-clip offset="0/30000s" ref="v1" lane="1" role="r1" duration="180000/30000s"/>
            </video-clip>
            
            <!-- Commentary as separate dialogue role -->
            <audio-clip offset="0/30000s" ref="v1" lane="2" role="r4" duration="180000/30000s"/>
            
            <!-- Music track -->
            <audio-clip offset="0/30000s" ref="v1" lane="3" role="r2" duration="180000/30000s"/>
            
            <!-- SFX track -->
            <audio-clip offset="0/30000s" ref="v1" lane="4" role="r3" duration="180000/30000s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
```

#### Key FCPXML Audio Elements

| Element | Purpose | Notes |
|---------|---------|-------|
| `<audio-clip>` | Audio clip definition | Can be child of `<video-clip>` or standalone in `<spine>` |
| `<audio-source>` | Reference to audio media file | Required for standalone audio clips |
| `<role>` | Audio track type classification | FCPXML 1.1+: Dialogue, Music, Effects, etc. |
| `lane` attribute | Timeline lane/track number | Lane 1 = A1, Lane 2 = A2, etc. |
| `offset` | Timeline position | `frames/totalFrames s` format |
| `ref` | Reference to asset ID | Links to `<asset>` element in `<resources>` |
| `enabled` attribute | Whether clip is active | `"1"` or `"0"` |

#### Audio Volume/Pan in FCPXML

FCPXML 1.1+ supports audio effects for volume and pan:

```xml
<audio-clip offset="0/30000s" ref="a2" name="Commentary" duration="180000/30000s">
  <audio-source src="file://localhost/path/to/commentary.wav"/>
  
  <!-- Audio adjustment effects -->
  <adjust-volume>
    <!-- Volume in dB (positive = boost, negative = attenuation) -->
    <volume-adjust-mode>
      <adjust-volume type="absolute">
        <parameter name="db" value="-6.0"/>
      </adjust-volume>
    </volume-adjust-mode>
    
    <!-- Panning (-1 = left, 0 = center, 1 = right) -->
    <adjust-pan>
      <parameter name="pan" value="0.0"/>
    </adjust-pan>
  </adjust-volume>
</audio-clip>
```

#### Multi-Channel Audio in FCPXML

For 5.1 or 7.1 surround:

```xml
<audio-clip offset="0/30000s" ref="surround51" name="Surround Mix" duration="180000/30000s">
  <!-- Define channel configuration -->
  <channel-layout>5.1</channel-layout>
  
  <!-- Per-channel routing -->
  <audio-channel channel="1" role="left"/>
  <audio-channel channel="2" role="right"/>
  <audio-channel channel="3" role="center"/>
  <audio-channel channel="4" role="lfe"/>
  <audio-channel channel="5" role="leftSurround"/>
  <audio-channel channel="6" role="rightSurround"/>
</audio-clip>
```

### EDL Limitations with Multi-Track Audio

EDL (CMX 3600 format) has severe limitations for audio:

#### Basic EDL Audio Support

```
001  CLIP001  V  C     00:00:00:00 00:01:00:00 00:00:00:00 00:01:00:00
002  CLIP001  A  C     00:00:00:00 00:01:00:00 00:00:00:00 00:01:00:00
003  CLIP002  A  C     00:00:00:00 00:01:00:00 00:01:00:00 00:02:00:00
```

**Limitations:**
- **No multi-track support**: Only one audio event per timecode
- **No stereo separation**: Treats audio as mono
- **No volume/pan automation**: No level control
- **No track-specific metadata**: Store track index in comments
- **No roles or effects**: Cannot represent audio routing

#### Extended EDL (CMX 3400/3600+)

Some extended formats add limited audio support:

```
001  CLIP001  AA  C    00:00:00:00 00:01:00:00 00:00:00:00 00:01:00:00
* FROM CLIP NAME: vod_stream.mkv
* AUDIO TRACK: 1 (Left)
* AUDIO TRACK: 2 (Right)
* AUDIO CHANNELS: 2
* AUDIO LANGUAGE: eng

002  CLIP001  AA  C    00:00:00:00 00:01:00:00 00:01:00:00 00:02:00:00
* FROM CLIP NAME: vod_stream.mkv
* AUDIO TRACK: 3 (Commentary)
* AUDIO CHANNELS: 2
* AUDIO LANGUAGE: eng
```

**Still problematic:**
- Resolve may ignore audio track comments
- Limited to basic cut points
- No guarantee of track preservation
- Best use case: Audio-only EDL for conforming

**Recommendation**: For multi-track audio, prefer FCPXML or provide EDL with a note about audio limitations.

### DaVinci Resolve Import Expectations

#### What Resolve Expects for Multi-Track Audio

**File-based import (e.g., from FCPXML):**
1. **Track order**: First `<audio-clip>` in `<spine>` = A1, second = A2, etc.
2. **Asset references**: All audio must reference valid `<asset>` elements
3. **Format matching**: Audio format must match sequence format (sample rate, bit depth)
4. **Lane numbering**: `lane` attribute maps to Resolve's track numbers (lane 1 = A1)
5. **Media paths**: Absolute or relative URIs must resolve to actual media files

**Resolve track naming behavior:**
- Imports XML track names as clip names (editable post-import)
- Auto-assigns A1, A2, A3 track labels based on lane order
- Creates new tracks as needed (doesn't compress to existing tracks)

**Resolve audio conforming:**
- Converts mismatched sample rates (e.g., 44.1kHz → 48kHz)
- Mixes down surround to stereo if sequence is stereo
- Handles mono/stereo/5.1 automatically
- Preserves audio track metadata (title, language) when available

#### Best Practices for Resolve-Compatible Exports

1. **Use FCPXML 1.0 or 1.1**: Maximum compatibility
2. **Provide absolute paths**: Less chance of media relinking issues
3. **Include all audio tracks**: Even muted/unused tracks can be disabled in Resolve
4. **Set default track**: Flag the primary audio with `<disposition>` or track ordering
5. **Test with sample file**: Verify Resolve imports correctly before full export
6. **Document track mapping**: Provide README or internal note of which track is which

#### Resolve-Specific FCPXML Enhancements

```xml
<!-- DaVinci Resolve specific metadata -->
<asset id="a1" name="game_audio" src="file://localhost/path/to/game_audio.wav"
       format="r1" duration="180000/30000s" hasVideo="0" hasAudio="1">
  <!-- Resolve track color (hex) -->
  <metadata key="resolveTrackColor">#FF5722</metadata>
  
  <!-- Custom metadata Resolve will display -->
  <metadata key="resolveUserComment">Primary game audio track</metadata>
  <metadata key="resolveMediaType">dialogue</metadata>
  
  <!-- Marker that Resolve will convert to clip marker -->
  <marker>
    <value>Section 1</value>
    <startTime>0/30000s</startTime>
    <duration>100/30000s</duration>
  </marker>
</asset>
```

### NLE Export Comparison

| Feature | FCPXML | EDL | AAF |
|---------|--------|-----|-----|
| Multi-track audio support | ✅ Excellent | ❌ Very limited | ✅ Good |
| Audio volume control | ✅ Yes (1.1+) | ❌ No | ✅ Yes |
| Audio pan control | ✅ Yes (1.1+) | ❌ No | ✅ Yes |
| Track ordering | ✅ Preserved | ⚠️ Limited | ✅ Preserved |
| Audio roles/types | ✅ Yes (1.1+) | ❌ No | ✅ Yes |
| Surround sound | ✅ Supported | ❌ No | ✅ Yes |
| Clip metadata | ✅ Rich | ⚠️ Comments only | ✅ Rich |
| Resolve compatibility | ✅ Excellent | ⚠️ Basic | ✅ Good |
| Premiere compatibility | ✅ Good | ✅ Good | ✅ Excellent |
| File size | Medium | Small | Large |
| Implementation complexity | Medium | Low | Very High |

**Recommendation hierarchy:**
1. **Primary**: FCPXML (best balance of features and compatibility)
2. **Fallback**: EDL (for legacy NLEs, audio-only for conforming)
3. **Avoid**: AAF (complex implementation, overkill for this use case)

---

## User Control Over Audio Tracks

### Track Selection UI

#### Import-Time Track Selection

When importing an MKV with multiple audio tracks:

```typescript
interface AudioImportOptions {
  // Track selection
  autoSelectDefault: boolean;        // Auto-select track with 'default' flag
  autoSelectLanguage: string;        // Auto-select by language code (e.g., 'eng')
  
  // Selected tracks for import
  selectedTrackIndices: number[];    // Array of stream indices to import
  
  // Track naming
  renameTracks: boolean;             // Allow user to rename tracks during import
  trackNamePattern: string;          // Naming pattern (e.g., "Track {n} - {role}")
  
  // Preview options
  previewTracks: boolean;            // Play preview of each track before selecting
}
```

**Import dialog UI:**
```
┌─────────────────────────────────────────────────┐
│ Import Audio Tracks from vod_stream.mkv         │
├─────────────────────────────────────────────────┤
│ Found 3 audio tracks                            │
│                                                 │
│ ☑ Track 1 [DEFAULT] - Game Audio (English)     │
│    [▶ Play Preview]  Duration: 30:00           │
│    Channels: Stereo  Sample Rate: 48kHz        │
│                                                 │
│ ☑ Track 2 - Commentary (English)               │
│    [▶ Play Preview]  Duration: 30:00           │
│    Channels: Stereo  Sample Rate: 48kHz        │
│                                                 │
│ ☐ Track 3 - Music (English)                    │
│    [▶ Play Preview]  Duration: 30:00           │
│    Channels: Stereo  Sample Rate: 48kHz        │
│                                                 │
│ ☐ Track 4 - Sound Effects (English)            │
│    [▶ Play Preview]  Duration: 30:00           │
│    Channels: Stereo  Sample Rate: 48kHz        │
│                                                 │
│ [Select All]  [Deselect All]                   │
│                                                 │
│   [Cancel]              [Import Selected]      │
└─────────────────────────────────────────────────┘
```

#### Timeline Track Controls

**Track Header Controls:**

| Control | Action | Effect |
|---------|--------|--------|
| **Track Name** | Double-click to edit | Renames track header and export name |
| **Mute (M)** | Click to toggle | Silences track output |
| **Solo (S)** | Click to toggle | Exclusively plays this track (mutes others) |
| **Track Visibility** | Click eye icon | Shows/hides track in timeline |
| **Waveform Toggle** | Click waveform icon | Shows/hides audio waveforms per track |
| **Lock (🔒)** | Click to toggle | Prevents edits on this track |
| **Track Color** | Click color wheel | Changes track visual color |
| **Delete Track** | Right-click → Delete | Removes track from timeline (doesn't delete media)|
| **Track Settings** | Right-click → Settings | Opens track configuration dialog |

#### Track Reordering

**UI Methods:**

1. **Drag and Drop**: Drag track header up/down to reorder
2. **Move Up/Down**: Context menu or keyboard shortcuts
3. **Batch Move**: Select multiple tracks, move together

**Reordering affects:**
- **Timeline display order**: Higher track numbers appear below lower numbers
- **Export order**: Track 1 exports first in multi-track exports
- **Mix order**: Topmost track mixes in first (for L/R panning)

#### Track Renaming

**Renaming options:**
1. **Inline edit**: Double-click track name field
2. **Dialog edit**: Right-click → Rename → Show dialog
3. **Batch rename**: Select multiple tracks → Batch Rename → Apply pattern

**Batch rename patterns:**
```
Track {n}            → Track 1, Track 2, Track 3...
{role} - {language}  → Dialogue - English, Music - English...
Chapter {n}: {role}  → Chapter 1: Game Audio, Chapter 1: Commentary...
```

### Audio Mixing Controls

#### Per-Track Volume

**Volume Control UI:**
```
┌─────────────────────────────┐
│ Volume: -6.0 dB             │
│ [====□====]   [Reset]       │
│  ┌─────────────────────┐   │
│  │ +12dB               │   │
│  │                     │   │
│  │      0dB            │   │
│  │                     │   │
│  │ -6dB ←              │   │
│  │                     │   │
│  │     -inf            │   │
│  └─────────────────────┘   │
└─────────────────────────────┘
```

**Volume keyframing:**
- Click track to add keyframe at playhead
- Drag keyframes to create automation
- Right-click keyframe → Delete/Copy/Paste

**Keyboard controls:**
- `[` / `]`: Nudge keyframe left/right
- `Shift` + drag: Fine adjustment
- `Cmd/Ctrl` + `]`: Add keyframe at playhead

#### Per-Track Pan

**Pan Control UI (Stereo):**
```
┌─────────────────────────────┐
│ Pan: C                      │
│ [L----●----R]   [Reset]     │
│  ┌─────────────────────┐   │
│  │ L        C        R  │   │
│  │         ●          │   │
│  └─────────────────────┘   │
│  [-1.0]  [0.0]   [1.0]     │
└─────────────────────────────┘
```

**Pan Control UI (Surround):**
```
┌─────────────────────────────┐
│ Pan: Center                 │
│  ┌─────────────────────┐   │
│  │           ●         │   │
│  │                     │   │
│  │    LS  C   RS       │   │
│  │      \ | /          │   │
│  │       \|/           │   │
│  │   L---X---R         │   │
│  │       /|\           │   │
│  │      / | \          │   │
│  │                     │   │
│  └─────────────────────┘   │
└─────────────────────────────┘
```

**Surround positions:**
- L/R: Left/Right
- C: Center
- LS/RS: Left/Right Surround
- LFE: Low Frequency Effects (subwoofer)

### Export Mixdown Options

#### Mix to Stereo

**Scenario:** Export all selected audio tracks to single stereo track

**Options:**
```
┌──────────────────────────────────────┐
│ Audio Export Settings                │
├──────────────────────────────────────┤
│ Export Mode: ☐ Keep Separate         │
│              ☑ Mix to Stereo         │
│                                      │
│ Selected Tracks for Mix:             │
│ ☑ A1 - Game Audio  (Vol: 0dB)       │
│ ☑ A2 - Commentary (Vol: -3dB)       │
│ ☑ A3 - Music (Vol: -12dB)           │
│                                      │
│ Mix Settings:                        │
│ Codec: AAC                           │
│ Bitrate: 192 kbps                    │
│ Sample Rate: 48kHz                   │
│                                      │
│ Normalization: ☑ EBU R128 (-16 LUFS) │
│                  ☐ Peak (-1dBTP)     │
└──────────────────────────────────────┘
```

**Implementation:**
```typescript
function mixAudioToStereo(tracks: AudioTrack[]): Buffer {
  const outputSampleRate = 48000;
  const outputChannels = 2;

  // Decode all tracks first to determine output duration
  const decodedTracks = tracks.map(track => ({
    ...track,
    audio: decodeAudioTrack(track.sourcePath)
  }));

  // Calculate total samples based on the longest track
  const maxDuration = Math.max(...decodedTracks.map(t => t.audio.length / t.channelCount));
  const totalSamples = Math.floor(maxDuration);

  let mixedAudio = new Float32Array(totalSamples * outputChannels);

  decodedTracks.forEach(track => {
    const volumeDbToLinear = Math.pow(10, track.volumeDb / 20);

    // Apply volume and apply pan (for mono tracks)
    for (let i = 0; i < track.audio.length; i += track.channelCount) {
      if (track.channelCount === 1) {
        // Mono: split to L/R based on pan
        const pan = track.pan; // -1 to 1
        const leftPercent = (1 - pan) / 2;
        const rightPercent = (1 + pan) / 2;

        mixedAudio[i] += track.audio[i] * volumeDbToLinear * leftPercent;
        mixedAudio[i + 1] += track.audio[i] * volumeDbToLinear * rightPercent;
      } else if (track.channelCount === 2) {
        // Stereo: Mix directly
        mixedAudio[i] += track.audio[i] * volumeDbToLinear;
        mixedAudio[i + 1] += track.audio[i + 1] * volumeDbToLinear;
      }
      // Surround: downmix to stereo (5.1 → 2)
    }
  });

  // Normalize to prevent clipping
  const maxPeak = Math.max(...mixedAudio.map(Math.abs));
  if (maxPeak > 1.0) {
    mixedAudio = mixedAudio.map(sample => sample / maxPeak);
  }

  return encodeAudioToAAC(mixedAudio);
}
```

#### Keep Separate Tracks

**Scenario:** Export each audio track independently

**Options:**
```
┌──────────────────────────────────────┐
│ Audio Export Settings                │
├──────────────────────────────────────┤
│ Export Mode: ☑ Keep Separate         │
│              ☐ Mix to Stereo         │
│                                      │
│ Track Export List:                   │
│ ☑ A1 - Game Audio                    │
│    Export as: game_audio.wav         │
│                                      │
│ ☑ A2 - Commentary                    │
│    Export as: commentary.wav         │
│                                      │
│ ☑ A3 - Music                         │
│    Export as: music.wav              │
│                                      │
│ Naming Pattern: [TrackName].wav      │
│ [Use track custom names]             │
│                                      │
│ Export Format: WAV (PCM 16-bit)      │
└──────────────────────────────────────┘
```

**Implementation:**
```typescript
async function exportSeparateTracks(tracks: AudioTrack[], outputDir: string) {
  const exports = [];
  
  for (const track of tracks) {
    if (!track.exportEnabled) continue;
    
    const outputPath = path.join(
      outputDir,
      getExportFileName(track, track.exportNamingPattern)
    );
    
    // Copy track to new file
    await ffmpegCopyAudioTrack(
      track.sourcePath,
      track.sourceTrackIndex,
      outputPath,
      {
        codec: track.exportCodec,
        sampleRate: track.exportSampleRate,
        channels: track.exportChannels
      }
    );
    
    exports.push({
      trackId: track.id,
      trackName: track.name,
      outputPath: outputPath,
      duration: track.duration
    });
  }
  
  return exports;
}
```

#### Export with Custom Mix

**Scenario:** Advanced - export multiple versions with different mixes

**Use cases:**
- Director's cut (different commentary track)
- Clean version (no commentary)
- Music-only cut (for behind-the-scenes)
- Game audio only (for montage editing)

**UI:**
```
┌──────────────────────────────────────┐
│ Multi-Export Audio Configuration     │
├──────────────────────────────────────┤
│ Export Variants:                     │
│                                      │
│ Variant 1: [Full Mix]                │
│   ☑ A1 - Game Audio  (0dB)          │
│   ☑ A2 - Commentary (-3dB)          │
│   ☑ A3 - Music (-12dB)              │
│                                      │
│ Variant 2: [No Commentary]           │
│   ☑ A1 - Game Audio  (0dB)          │
│   ☐ A2 - Commentary (muted)        │
│   ☑ A3 - Music (-9dB)               │
│                                      │
│ Variant 3: [Music Only]              │
│   ☐ A1 - Game Audio  (muted)       │
│   ☐ A2 - Commentary (muted)        │
│   ☑ A3 - Music (0dB)                │
│                                      │
│ [Add Variant]                        │
│                                      │
│ Export to: [Select Folder]           │
│ File naming: Mix-1-full.wav,         │
│             Mix-2-no-commentary.wav, │
│             Mix-3-music-only.wav     │
│                                      │
│   [Cancel]              [Export]     │
└──────────────────────────────────────┘
```

### Audio Track Metadata Preservation

**Export metadata to include:**

```typescript
interface AudioTrackExportMetadata {
  // Identity
  trackId: string;
  originalFileName: string;
  streamIndex: number;
  
  // Content metadata
  title: string;
  language: string;
  role: string;  // 'dialogue', 'music', 'effects', etc.
  
  // Technical metadata
  codec: string;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  channelLayout: string;
  
  // Mix metadata
  volumeDb: number;
  pan: number;
  
  // Role metadata (for FCPXML)
  fcpXmlRole?: string;
  
  // Timestamps
  inPoint: number;   // seconds
  outPoint: number;  // seconds
  duration: number;
  
  // Export timestamp
  exportedAt: string;
}
```

**FFmpeg metadata tags:**
```bash
# Add metadata to exported track
ffmpeg -i input.wav -c:a copy -metadata title="Game Audio" \
       -metadata language="eng" -metadata role="dialogue" \
       output.wav
```

---

## Implementation Considerations

### Database Schema for Audio Track Metadata

#### Enhanced Asset Table

```sql
-- Extend existing assets table to support audio track metadata
ALTER TABLE assets ADD COLUMN audio_tracks JSON;

-- Example audio_tracks JSON structure:
-- {
--   "tracks": [
--     {
--       "id": "track_001",
--       "streamIndex": 1,
--       "codec": "aac",
--       "channels": 2,
--       "channelLayout": "stereo",
--       "sampleRate": 48000,
--       "bitDepth": 16,
--       "bitrate": 192000,
--       "language": "eng",
--       "title": "Game Audio",
--       "default": true,
--       "duration": 1800.5,
--       "role": "dialogue",
--       "enabled": true,
--       "muted": false,
--       "solo": false,
--       "volumeDb": 0,
--       "pan": 0,
--       "color": "#FF5722"
--     },
--     {
--       "id": "track_002",
--       "streamIndex": 2,
--       "codec": "aac",
--       "channels": 2,
--       "channelLayout": "stereo",
--       "sampleRate": 48000,
--       "bitDepth": 16,
--       "bitrate": 192000,
--       "language": "eng",
--       "title": "Commentary",
--       "default": false,
--       "duration": 1800.5,
--       "role": "dialogue",
--       "enabled": true,
--       "muted": false,
--       "solo": false,
--       "volumeDb": -3,
--       "pan": 0,
--       "color": "#4CAF50"
--     },
--     {
--       "id": "track_003",
--       "streamIndex": 3,
--       "codec": "aac",
--       "channels": 2,
--       "channelLayout": "stereo",
--       "sampleRate": 48000,
--       "bitDepth": 16,
--       "bitrate": 128000,
--       "language": "eng",
--       "title": "Music",
--       "default": false,
--       "duration": 1800.5,
--       "role": "music",
--       "enabled": true,
--       "muted": false,
--       "solo": false,
--       "volumeDb": -12,
--       "pan": 0,
//       "color": "#9C27B0"
--     }
--   ],
--   "trackCount": 3,
--   "totalChannels": 6
-- }
```

#### Track Selection Table

```sql
-- For storing user's export track selection per project
CREATE TABLE audio_track_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  
  -- Export configuration
  export_enabled BOOLEAN DEFAULT TRUE,
  export_mixdown BOOLEAN DEFAULT FALSE,  -- Mix into stereo output
  export_separate BOOLEAN DEFAULT TRUE,  -- Export as separate file
  export_order INTEGER DEFAULT 0,        -- Order in multi-track export
  
  -- Mix settings
  volume_db REAL DEFAULT 0,              -- Volume in dB
  pan REAL DEFAULT 0,                    -- Stereo pan (-1 to 1)
  
  -- Display settings
  visible BOOLEAN DEFAULT TRUE,
  show_waveform BOOLEAN DEFAULT TRUE,
  color TEXT DEFAULT '#808080',
  
  -- Playback settings
  muted BOOLEAN DEFAULT FALSE,
  solo BOOLEAN DEFAULT FALSE,
  
  -- Metadata override
  title TEXT,
  role TEXT,
  
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE INDEX idx_audio_selection_project ON audio_track_selections(project_id);
CREATE INDEX idx_audio_selection_asset ON audio_track_selections(asset_id);
```

#### Export Configuration Table

```sql
-- For storing project-wide audio export presets
CREATE TABLE audio_export_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  preset_name TEXT NOT NULL,
  
  -- Export mode
  export_mode TEXT NOT NULL,  -- 'mix-all', 'select-tracks', 'keep-separate'
  
  -- Mixdown settings
  mixdown_format TEXT DEFAULT 'stereo',
  mixdown_codec TEXT DEFAULT 'aac',
  mixdown_bitrate INTEGER DEFAULT 192,
  mixdown_sample_rate INTEGER DEFAULT 48000,
  
  -- Normalization settings
  normalize_audio BOOLEAN DEFAULT TRUE,
  target_lufs REAL DEFAULT -16,
  target_peak_tp REAL DEFAULT -1,
  
  -- Metadata preservation
  preserve_language_tags BOOLEAN DEFAULT TRUE,
  preserve_track_names BOOLEAN DEFAULT TRUE,
  include_export_metadata BOOLEAN DEFAULT TRUE,
  
  -- Advanced options
  remove_silence BOOLEAN DEFAULT FALSE,
  crossfade_tracks BOOLEAN DEFAULT FALSE,
  crossfade_duration REAL DEFAULT 0.1,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

### Asset Parsing with FFprobe

#### FFprobe Integration

**TypeScript API for FFprobe:**

```typescript
// src/pipeline/ffprobe.ts

import { spawn } from 'child_process';
import { promisify } from 'util';

interface FFprobeStream {
  index: number;
  codec_type: string;  // 'video' | 'audio' | 'subtitle'
  codec_name: string;
  codec_long_name?: string;
  profile?: string;
  
  // Audio-specific
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  sample_fmt?: string;
  bits_per_sample?: number;
  bit_rate?: string;
  
  // Tags (metadata)
  tags?: {
    language?: string;
    title?: string;
    default?: string;
    role?: string;
    [key: string]: string | undefined;
  };
  
  // Duration
  duration?: string;
  start_time?: string;
}

interface FFprobeFormat {
  filename: string;
  format_name: string;
  format_long_name: string;
  start_time: string;
  duration: string;
  size: string;
  bit_rate: string;
  probe_score: number;
  tags?: Record<string, string>;
}

interface FFprobeResult {
  streams: FFprobeStream[];
  format: FFprobeFormat;
}

export async function probeFile(filePath: string): Promise<FFprobeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ];
    
    const ffprobe = spawn('ffprobe', args);
    let output = '';
    let error = '';
    
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Failed to parse FFprobe output: ${parseError}`));
        }
      } else {
        reject(new Error(`FFprobe exited with code ${code}: ${error}`));
      }
    });
  });
}

export async function getAudioTracks(filePath: string): Promise<AudioTrack[]> {
  const probeResult = await probeFile(filePath);
  const audioStreams = probeResult.streams.filter(s => s.codec_type === 'audio');
  
  return audioStreams.map((stream, index) => {
    return {
      id: `track_${index}`,
      streamIndex: stream.index,
      codec: stream.codec_name,
      channels: stream.channels || 0,
      channelLayout: stream.channel_layout || 'unknown',
      sampleRate: parseInt(stream.sample_rate || '0'),
      bitDepth: stream.bits_per_sample,
      bitrate: stream.bit_rate ? parseInt(stream.bit_rate) : undefined,
      sampleFormat: stream.sample_fmt,
      duration: parseFloat(stream.duration || '0'),
      startTime: parseFloat(stream.start_time || '0'),
      
      // Metadata from tags
      language: stream.tags?.language || 'und',
      title: stream.tags?.title || `Audio Track ${index + 1}`,
      default: stream.tags?.default === '1',
      role: stream.tags?.role,
      
      // Default playback state
      enabled: stream.tags?.default === '1',
      muted: false,
      solo: false,
      volumeDb: 0,
      pan: 0,
      
      // Default display state
      visible: true,
      showWaveform: true,
      color: getDefaultTrackColor(index),
      
      // Export defaults
      exportEnabled: true,
      exportMixdown: false,
      exportSeparate: true,
      exportOrder: index
    };
  });
}

function getDefaultTrackColor(index: number): string {
  const colors = [
    '#FF5722', // Orange - Game Audio
    '#4CAF50', // Green - Commentary
    '#9C27B0', // Purple - Music
    '#2196F3', // Blue - Effects
    '#00BCD4', // Cyan - Ambience
    '#FFC107', // Amber - Dialogue
    '#E91E63', // Pink - Character Voice
    '#009688'  // Teal - Unclassified
  ];
  return colors[index % colors.length];
}
```

#### Asset Import with Audio Track Discovery

**Electron IPC Handler:**

```typescript
// src/electron/ipc/handlers.ts

import { getAudioTracks } from '../../../pipeline/ffprobe';
import { Database } from '../database/db';

ipcMain.handle('asset:add-with-audio', async (event, { filePath, projectId }) => {
  try {
    // Probe file for audio tracks
    const audioTracks = await getAudioTracks(filePath);
    
    // Store asset with audio track metadata
    const assetId = await db.addAsset({
      projectId,
      filePath,
      fileType: path.extname(filePath).slice(1),
      duration: 0, // Will be filled from probe
      audioTracks: {
        tracks: audioTracks,
        trackCount: audioTracks.length,
        totalChannels: audioTracks.reduce((sum, t) => sum + t.channels, 0)
      }
    });
    
    // Create audio track selections for this asset
    for (const track of audioTracks) {
      await db.addAudioTrackSelection({
        projectId,
        assetId,
        trackId: track.id,
        exportEnabled: track.enabled,
        exportOrder: track.exportOrder,
        volumeDb: track.volumeDb,
        pan: track.pan,
        visible: track.visible,
        showWaveform: track.showWaveform,
        color: track.color,
        muted: track.muted,
        solo: track.solo,
        title: track.title,
        role: track.role
      });
    }
    
    return {
      success: true,
      assetId,
      audioTracks,
      trackCount: audioTracks.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});
```

### Timeline Rendering Optimization

#### Waveform Caching

**Strategy:** Pre-render waveforms and cache them for timeline display

```typescript
// src/renderer/lib/waveform-cache.ts

interface WaveformCache {
  [assetId: string]: {
    [trackId: string]: {
      peaks: number[];
      rms: number[];
      maxPeak: number;
      duration: number;
      sampleRate: number;
    };
  };
}

class WaveformManager {
  private cache: WaveformCache = {};
  private readonly PEAK_RESOLUTION = 100; // peaks per second
  private readonly CACHE_VERSION = 'v1';
  
  async getWaveform(assetId: string, trackId: string, duration: number) {
    const cacheKey = this.getCacheKey(assetId, trackId);
    
    // Check cache first
    if (this.cache[cacheKey] && this.cache[cacheKey][trackId]) {
      return this.cache[cacheKey][trackId];
    }
    
    // Query database for pre-rendered waveform
    const cached = await db.getWaveformData(assetId, trackId);
    if (cached) {
      this.cache[cacheKey] = { [trackId]: cached };
      return cached;
    }
    
    // Generate waveform from audio
    const waveform = await this.generateWaveform(assetId, trackId, duration);
    
    // Store in cache
    this.cache[cacheKey] = { [trackId]: waveform };
    
    // Persist to database asynchronously
    db.saveWaveformData(assetId, trackId, waveform);
    
    return waveform;
  }
  
  private async generateWaveform(assetId: string, trackId: string, duration: number) {
    const asset = await db.getAsset(assetId);
    const track = asset.audioTracks.tracks.find(t => t.id === trackId);
    
    // Extract audio to temporary WAV
    const tempWav = await extractAudioTrack(asset.filePath, track.streamIndex);
    
    // Read WAV file and compute peaks
    const audioBuffer = await readWavFile(tempWav);
    const numPeaks = Math.floor(duration * this.PEAK_RESOLUTION);
    const peaks = new Float32Array(numPeaks);
    const rms = new Float32Array(numPeaks);
    
    const samplesPerPeak = audioBuffer.length / numPeaks;
    
    for (let i = 0; i < numPeaks; i++) {
      const startSample = Math.floor(i * samplesPerPeak);
      const endSample = Math.floor((i + 1) * samplesPerPeak);
      
      let maxPeak = 0;
      let sumSquares = 0;
      
      for (let j = startSample; j < endSample; j++) {
        const sample = Math.abs(audioBuffer[j]);
        if (sample > maxPeak) maxPeak = sample;
        sumSquares += sample * sample;
      }
      
      peaks[i] = maxPeak;
      rms[i] = Math.sqrt(sumSquares / (endSample - startSample));
    }
    
    // Clean up temp file
    await fs.unlink(tempWav);
    
    return {
      peaks: Array.from(peaks),
      rms: Array.from(rms),
      maxPeak: Math.max(...peaks),
      duration,
      sampleRate: track.sampleRate
    };
  }
  
  private getCacheKey(assetId: string, trackId: string): string {
    return `${this.CACHE_VERSION}:${assetId}`;
  }
  
  clearCache(assetId?: string) {
    if (assetId) {
      delete this.cache[`${this.CACHE_VERSION}:${assetId}`];
    } else {
      this.cache = {};
    }
  }
}

export const waveformManager = new WaveformManager();
```

#### Render Only Active Tracks

**Optimization:** Don't render waveforms for muted or hidden tracks

```typescript
// src/renderer/lib/components/Timeline.svelte

<script>
  import { waveformManager } from './waveform-cache';
  
  let { tracks } = $props();
  
  // Reactive computation of visible, non-muted tracks
  const activeTracks = $derived(
    tracks.filter(t => t.visible && !t.muted)
  );
  
  // Only fetch waveforms for active tracks
  async function loadWaveforms() {
    for (const track of activeTracks) {
      // Skip track if already loaded
      if (track.waveform) continue;
      
      track.waveform = await waveformManager.getWaveform(
        track.assetId,
        track.id,
        track.duration
      );
    }
  }
  
  // Debounced waveform loading
  let loadTimeout;
  function scheduleWaveformLoad() {
    clearTimeout(loadTimeout);
    loadTimeout = setTimeout(loadWaveforms, 300);
  }
  
  // Watch for track changes
  $effect(() => {
    scheduleWaveformLoad();
  });
</script>

<canvas>
  {#each activeTracks as track, index}
    <g transform={`translate(0, ${index * trackHeight})`}>
      <rect width={timelineWidth} height={trackHeight} fill={track.color} opacity={0.1}/>
      <path d={generateWaveformPath(track.waveform)} stroke={track.color}/>
      <text>{track.name}</text>
    </g>
  {/each}
</canvas>
```

#### Lazy Loading

**Strategy:** Load waveforms only when tracks are scrolled into view

```typescript
// Intersection Observer for timeline tracks

function setupLazyWaveformLoading() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const track = entry.target.dataset.trackId;
        triggerWaveformLoad(track);
      }
    });
  }, {
    threshold: 0.1,  // Load when 10% visible
    rootMargin: '200px'  // Pre-load before scrolling into view
  });
  
  // Observe all track elements
  document.querySelectorAll('[data-track-id]').forEach(el => {
    observer.observe(el);
  });
}
```

### Export Complexity Management

#### Handling 8+ Audio Tracks

**Challenges:**
- FCPXML file size grows linearly with track count
- Rendering more tracks takes more CPU
- Export time increases with track count
- DaVinci Resolve may struggle with excessive tracks

**Solutions:**

1. **Batch Export:** Export in batches if too many tracks
   ```typescript
   const MAX_TRACKS_PER_EXPORT = 16;
   const batches = chunkArray(tracks, MAX_TRACKS_PER_EXPORT);
   
   for (const batch of batches) {
     await exportFCPXML(batch, `export_batch_${batchIndex}.xml`);
   }
   ```

2. **Track Compression:** Combine similar tracks
   - Group all music tracks into one
   - Combine multiple SFX tracks
   - Keep only essential dialogue tracks

3. **Selective Export:** User chooses which tracks to export
   - Default export: Only enabled tracks
   - Full export: All tracks (separate checkbox)

4. **Progressive Loading:** Export in background
   - Show progress per track
   - Allow cancellation
   - Resume on interruption

#### Export Time Estimation

```typescript
async function estimateExportTime(tracks: AudioTrack[], mode: ExportMode): Promise<number> {
  // Base time constant (empirical)
  const BASE_TIME_MS = 500;
  
  // Time per track (depends on codec, sample rate, duration)
  const TIME_PER_TRACK_MS = 750;
  
  // Mixdown multiplier (slower than separate export)
  const MIXDOWN_MULTIPLIER = mode === 'mix-all' ? 2.5 : 1.0;
  
  // Duration multiplier (longer audio = exponentially slower)
  const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);
  const durationMultiplier = 1 + Math.log(totalDuration / 60) * 0.5;
  
  const estimatedMs = 
    BASE_TIME_MS +
    (tracks.length * TIME_PER_TRACK_MS) * MIXDOWN_MULTIPLIER * durationMultiplier;
  
  return estimatedMs;
}

// Usage
const estimatedTime = await estimateExportTime(tracks, 'mix-all');
console.log(`Estimated export time: ${(estimatedTime / 1000).toFixed(1)}s`);
```

#### Parallelization

```typescript
async function exportTracksParallel(
  tracks: AudioTrack[],
  outputDir: string,
  maxConcurrency: number = 4
): Promise<ExportResult[]> {
  const results: ExportResult[] = [];
  const semaphore = new Semaphore(maxConcurrency);
  
  const promises = tracks.map(async (track) => {
    await semaphore.acquire();
    
    try {
      const result = await exportSingleTrack(track, outputDir);
      results.push(result);
      return result;
    } finally {
      semaphore.release();
    }
  });
  
  await Promise.all(promises);
  return results;
}

class Semaphore {
  private tokens: number;
  private waitQueue: Array<() => void> = [];
  
  constructor(count: number) {
    this.tokens = count;
  }
  
  async acquire() {
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    
    return new Promise<void>(resolve => {
      this.waitQueue.push(resolve);
    });
  }
  
  release() {
    this.tokens++;
    const next = this.waitQueue.shift();
    if (next) {
      this.tokens--;
      next();
    }
  }
}
```

#### Export Progress Tracking

```typescript
// src/electron/jobs/export-job.ts

interface ExportProgress {
  projectId: string;
  exportType: 'fcpxml' | 'edl' | 'audio';
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentTrack: number;
  totalTracks: number;
  currentTime: number;
  totalTime: number;
  percentComplete: number;
  eta?: number;  // seconds remaining
}

class AudioExportJob {
  private progress: ExportProgress;
  private eventEmitter = new EventEmitter();
  
  async run(tracks: AudioTrack[], config: ExportConfig) {
    this.progress = {
      projectId: config.projectId,
      exportType: 'audio',
      status: 'running',
      currentTrack: 0,
      totalTracks: tracks.length,
      currentTime: 0,
      totalTime: tracks.reduce((sum, t) => sum + t.duration, 0),
      percentComplete: 0
    };
    
    // Emit progress updates every 100ms or 1% change
    const interval = setInterval(() => this.emitProgress(), 100);
    
    try {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        
        await this.exportTrack(track, config);
        
        this.progress.currentTrack = i + 1;
        this.progress.currentTime += track.duration;
        this.progress.percentComplete = Math.floor(
          (this.progress.currentTime / this.progress.totalTime) * 100
        );
        this.progress.eta = await this.estimateETA();
      }
      
      this.progress.status = 'completed';
    } catch (error) {
      this.progress.status = 'failed';
      throw error;
    } finally {
      clearInterval(interval);
      this.emitProgress();
    }
  }
  
  private emitProgress() {
    this.eventEmitter.emit('progress', this.progress);
  }
  
  private async estimateETA(): Promise<number> {
    const timeElapsed = Date.now() - this.startTime;
    const timePerSecond = timeElapsed / this.progress.currentTime;
    const remainingSeconds = this.progress.totalTime - this.progress.currentTime;
    return Math.ceil(remainingSeconds * timePerSecond / 1000);
  }
}
```

---

## Recommendations

### Phase 1: Infrastructure (Current)

**Tasks:**
- [x] Extend database schema to support audio track metadata
- [x] Implement FFprobe integration for track discovery
- [x] Build basic audio track UI component
- [ ] Implement audio track caching for timeline rendering
- [ ] Add audio track selection to import dialog

**Deliverables:**
- Database tables: `audio_track_selections`, `audio_export_presets`
- FFprobe API: `getAudioTracks()`, `probeFile()`
- Svelte component: `AudioTrackManager.svelte`
- IPC handler: `asset:add-with-audio`

### Phase 2: Timeline UI

**Tasks:**
- [ ] Implement track header with mute/solo controls
- [ ] Add volume fader and pan control UI
- [ ] Build waveform visualization (with lazy loading)
- [ ] Implement track reordering (drag and drop)
- [ ] Add audio mixer panel (separate from timeline)
- [ ] Implement track color scheme and roles

**Deliverables:**
- Svelte components: `AudioTrackHeader.svelte`, `AudioMixer.svelte`
- Waveform cache manager
- Track reordering logic
- Audio state management (`.svelte.ts` file)

### Phase 3: Audio Export

**Tasks:**
- [ ] Implement FCPXML audio track export
- [ ] Add EDL audio support (document limitations)
- [ ] Build export configuration dialog
- [ ] Implement audio mixdown engine
- [ ] Add separate track export option
- [ ] Implement export progress tracking

**Deliverables:**
- Export service: `AudioExportService.ts`
- FCPXML generator enhancements
- Mixdown utility functions
- Export progress UI
- Multi-variant export support

### Phase 4: Advanced Features

**Tasks:**
- [ ] Add audio normalization (LUFS)
- [ ] Implement audio effects (eq, compression)
- [ ] Add audio keyframing support
- [ ] Implement surround sound downmix
- [ ] Add audio export presets
- [ ] Build audio analysis tools (peak, clipping, frequency)

**Deliverables:**
- Audio effects chain
- Keyframing UI and logic
- Normalization utility
- Preset manager
- Analysis tools

### Technical Priorities

**High Priority:**
1. FFprobe integration - Essential for track discovery
2. Database schema - Required for persistence
3. Basic audio track UI - Minimum viable product
4. FCPXML export - Primary NLE compatibility

**Medium Priority:**
5. Waveform visualization - Nice-to-have for timeline
6. Mute/solo controls - Basic playback control
7. Pan/volume controls - Audio mixing support
8. Progress tracking - UX for long exports

**Low Priority:**
9. Advanced audio effects - Can be added later
10. Keyframing - Complex, defer to Phase 4
11. Surround sound - Niche use case
12. Custom audio presets - Nice-to-have

### Testing Strategy

**Unit Tests:**
- FFprobe output parsing
- Timecode conversion
- Audio mixdown math
- Database CRUD operations

**Integration Tests:**
- Asset import with multi-track MKV
- FCPXML generation andResolve import
- Audio export (mixdown and separate tracks)

**Manual Tests:**
- Import real VOD files with various audio configurations
- Test mute/solo logic with 8+ tracks
- Verify FCPXML imports correctly in DaVinci Resolve
- Test export to Premiere Pro via FCPXML
- Performance test with large audio files (multi-hour VODs)

### Known Limitations

**EDL Audio:**
- Cannot represent multi-track audio accurately
- Recommend FCPXML for multi-track projects
- Document limitations in UI

**Performance:**
- Waveform generation is CPU-intensive
- Consider background processing for long files
- Cache aggressively to avoid re-rendering

**Resolve Compatibility:**
- Test regularly with different Resolve versions
- Some tags may not be preserved across versions
- Prefer FCPXML 1.0 for maximum compatibility

**Platform Differences:**
- Windows/macOS path handling (backslashes vs forward slashes)
- Audio codec availability varies by platform
- Test on all target platforms

---

## Appendix: Quick Reference

### FFmpeg Commands Summary

| Task | Command | Notes |
|------|---------|-------|
| List audio tracks | `ffprobe -v quiet -select_streams a -show_streams input.mkv` | Shows all audio streams |
| Extract track 1 | `ffmpeg -i input.mkv -map 0:a:0 -c:a copy track1.aac` | Index 0 = first audio track |
| Extract by language | `ffmpeg -i input.mkv -map 0:m:language:eng audio_eng.aac` | Requires metadata |
| Remux with selection | `ffmpeg -i input.mkv -map 0:v -map 0:a:0,0:a:2 -c copy output.mkv` | Keep video + tracks 1,3 |
| Mix to stereo | `ffmpeg -i input.mkv -filter_complex "[0:a:0][0:a:1]amerge=inputs=2,pan=stereo" output.mp4` | Complex filter |
| Downmix 5.1 to stereo | `ffmpeg -i input.mkv -map 0:v -map 0:a -ac 2 output.mp4` | Simple channel reduction |
| Set default track | `ffmpeg -i input.mkv -disposition:a:0 default -c copy output.mkv` | Track index 0 |

### Audio Track Data Structure

```typescript
interface AudioTrack {
  // Identity
  id: string;
  streamIndex: number;
  
  // Technical
  codec: string;
  channels: number;           // 1 (mono), 2 (stereo), 6 (5.1)
  sampleRate: number;         // 48000, 44100, etc.
  bitDepth: number;           // 16, 24, 32
  duration: number;           // seconds
  
  // Metadata
  language: string;           // ISO 639-2/3 code
  title: string;              // User-friendly name
  role: string;               // 'dialogue', 'music', 'effects'
  default: boolean;           // Default playback flag
  
  // Playback
  enabled: boolean;           // Visible in timeline
  muted: boolean;             // Silence output
  solo: boolean;              // Exclusive playback
  volumeDb: number;           // Volume in dB (0 = unity)
  pan: number;                // Stereo pan (-1 to 1, 0 = center)
  
  // Display
  visible: boolean;
  showWaveform: boolean;
  color: string;              // Hex color code
}
```

### FCPXML Audio Element Reference

```xml
<!-- Basic audio clip in spine -->
<audio-clip offset="0/30000s" ref="asset_id" name="Clip Name" duration="180000/30000s"/>

<!-- Audio clip with effects (FCPXML 1.1+) -->
<audio-clip offset="0/30000s" ref="asset_id" name="Clip Name" duration="180000/30000s">
  <audio-source src="file://localhost/path/to/audio.wav"/>
  <adjust-volume>
    <volume-adjust-mode>
      <adjust-volume type="absolute">
        <parameter name="db" value="-6.0"/>
      </adjust-volume>
    </volume-adjust-mode>
    <adjust-pan>
      <parameter name="pan" value="0.0"/>
    </adjust-pan>
  </adjust-volume>
</audio-clip>

<!-- Audio clip with roles (FCPXML 1.1+) -->
<audio-clip offset="0/30000s" ref="asset_id" lane="2" role="dialogue" duration="180000/30000s"/>

<!-- Surround sound audio -->
<audio-clip offset="0/30000s" ref="asset_id" duration="180000/30000s">
  <channel-layout>5.1</channel-layout>
  <audio-channel channel="1" role="left"/>
  <audio-channel channel="2" role="right"/>
  <audio-channel channel="3" role="center"/>
  <audio-channel channel="4" role="lfe"/>
  <audio-channel channel="5" role="leftSurround"/>
  <audio-channel channel="6" role="rightSurround"/>
</audio-clip>
```

---

**Document Version:** 1.0  
**Last Updated:** January 26, 2026  
**Author:** VOD Pipeline Project Research
