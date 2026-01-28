# Whisper Integration for Electron - Research Document

**Date**: January 23, 2026
**Project**: VOD Pipeline - AI-Assisted Video Editor

## Executive Summary

This document researches integration options for OpenAI's Whisper speech-to-text model into an Electron desktop application using Node.js. The primary focus is **faster-whisper** (Python implementation) but also covers alternatives.

**Key Findings:**
- **faster-whisper** is the recommended choice: 4x faster than openai-whisper, less memory, quantization support
- Use `child_process.spawn()` for Node.js → Python integration
- Output JSON via stdout for segments with timestamps
- Bundle Python with app or use system installation
- Alternatives: whisper.cpp (C/C++), @xenova/transformers (WebAssembly), whisper-node (Node native)

---

## Table of Contents

1. [Node.js → Python Subprocess Patterns](#nodejs--python-subprocess-patterns)
2. [faster-whisper Specific Usage](#faster-whisper-specific-usage)
3. [Electron Environment Considerations](#electron-environment-considerations)
4. [Alternatives](#alternatives)
5. [Full Examples](#full-examples)

---

## 1. Node.js → Python Subprocess Patterns

### 1.1 Spawning Python from Node

The recommended approach is using `child_process.spawn()` for long-running processes like transcription:

```typescript
// src/electron/transcription/whisper-worker.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';

export interface TranscriptionOptions {
  audioPath: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3';
  language?: string;
  task?: 'transcribe' | 'translate';
  device?: 'cpu' | 'cuda';
  computeType?: 'int8' | 'float16' | 'float32';
  wordTimestamps?: boolean;
  vadFilter?: boolean;
  outputFormat?: 'json' | 'txt' | 'srt';
}

export class WhisperWorker {
  private process: ChildProcess | null = null;
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    // Use bundled Python or system Python
    const isDev = process.env.NODE_ENV === 'development';
    this.pythonPath = isDev 
      ? 'python3' 
      : path.join(process.resourcesPath, 'python', 'python');
    this.scriptPath = path.join(app.getAppPath(), 'python', 'transcribe.py');
  }

  async transcribe(
    options: TranscriptionOptions,
    onProgress?: (progress: { current: number; total?: number; message: string }) => void
  ): Promise<WhisperResult> {
    return new Promise((resolve, reject) => {
      const args = [
        this.scriptPath,
        '--audio', options.audioPath,
        '--model', options.model || 'base',
        '--output-format', options.outputFormat || 'json',
      ];

      if (options.language) args.push('--language', options.language);
      if (options.task) args.push('--task', options.task);
      if (options.device) args.push('--device', options.device);
      if (options.computeType) args.push('--compute-type', options.computeType);
      if (options.wordTimestamps) args.push('--word-timestamps');
      if (options.vadFilter) args.push('--vad-filter');

      this.process = spawn(this.pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1', // Disable output buffering
        },
      });

      let stdout = '';
      let stderr = '';
      let jsonOutput: string = '';

      // Collect stderr for progress messages (faster-whisper prints info to stderr)
      this.process.stderr?.on('data', (data) => {
        stderr += data.toString();
        
        // Parse progress from stderr lines like:
        // "Progress: 10% [00:30<00:45, 0.5 it/s]"
        // Or custom JSON progress: { "type": "progress", "current": 10, "total": 100 }
        const lines = stderr.split('\n');
        for (const line of lines) {
          if (line.startsWith('PROGRESS:')) {
            try {
              const progress = JSON.parse(line.substring(9));
              onProgress?.(progress);
            } catch (e) {
              // Try simple percentage parsing
              const match = line.match(/(\d+)%?/);
              if (match) {
                onProgress?.({ current: parseInt(match[1]), message: 'Processing...' });
              }
            }
          }
        }
      });

      // Collect stdout for final JSON output
      this.process.stdout?.on('data', (data) => {
        const chunk = data.toString();
        jsonOutput += chunk;
      });

      this.process.on('close', (code) => {
        this.process = null;
        
        if (code === 0) {
          try {
            const result = JSON.parse(jsonOutput) as WhisperResult;
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse transcription output: ${e}`));
          }
        } else {
          reject(new Error(`Transcription failed with code ${code}: ${stderr}`));
        }
      });

      this.process.on('error', (err) => {
        this.process = null;
        reject(new Error(`Failed to spawn python process: ${err.message}`));
      });
    });
  }

  cancel(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
```

### 1.2 Best Practices for Data Passing

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **CLI Arguments** | Simple, explicit | Limited data size | ✅ Use for paths, options |
| **stdout (JSON)** | Structured output, streamable | Large output buffering | ✅ Use for transcription results |
| **stderr (Progress)** | Separate from result data | Requires parsing | ✅ Use for progress updates |
| **stdin** | Can send large inputs | Complex to implement | ❌ Not needed for files |
| **Files** | Very large data capability | Slow I/O, cleanup | ❌ Use stdout instead |

### 1.3 Error Handling and Process Cleanup

```typescript
// Robust error handling pattern
class TranscriptionManager {
  private activeWorkers: Map<string, WhisperWorker> = new Map();

  async transcribe(
    audioPath: string, 
    options: TranscriptionOptions,
    jobId: string
  ): Promise<WhisperResult> {
    const worker = new WhisperWorker();
    this.activeWorkers.set(jobId, worker);

    try {
      const result = await worker.transcribe(options);
      return result;
    } finally {
      this.activeWorkers.delete(jobId);
    }
  }

  cancelJob(jobId: string): boolean {
    const worker = this.activeWorkers.get(jobId);
    if (worker) {
      worker.cancel();
      this.activeWorkers.delete(jobId);
      return true;
    }
    return false;
  }

  // Cleanup on app quit
  cleanup(): void {
    for (const [jobId, worker] of this.activeWorkers) {
      worker.cancel();
    }
    this.activeWorkers.clear();
  }
}

// Register cleanup on app quit
app.on('before-quit', () => {
  transcriptionManager.cleanup();
});
```

### 1.4 Progress Reporting from Python to Node

Python script should output progress to stderr in consumable format:

```python
# Option A: JSON progress lines
import sys
import json

def report_progress(current: int, total: int | None, message: str):
    """Report progress as JSON to stderr"""
    progress = {
        'type': 'progress',
        'current': current,
        'total': total,
        'message': message
    }
    print(f"PROGRESS:{json.dumps(progress)}", file=sys.stderr, flush=True)

# Option B: Simple percentage
def report_percentage(percent: int, message: str):
    print(f"PROGRESS://{percent}% - {message}", file=sys.stderr, flush=True)
```

---

## 2. faster-whisper Specific Usage

### 2.1 Python Script Example with JSON Output

```python
#!/usr/bin/env python3
"""
transcribe.py - faster-whisper transcription script for Electron integration

Usage: python transcribe.py --audio PATH [OPTIONS]

Output: JSON structure to stdout with segments and optional word-level timestamps
"""

import argparse
import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel


def report_progress(current: int, total: int | None, message: str):
    """Report progress as JSON to stderr"""
    progress = {
        'type': 'progress',
        'current': current,
        'total': total,
        'message': message
    }
    print(f"PROGRESS:{json.dumps(progress)}", file=sys.stderr, flush=True)


def extract_segments(segments_generator, word_timestamps: bool = False):
    """Extract segments from faster-whisper generator"""
    segments = []
    words_list = []
    
    for i, segment in enumerate(segments_generator):
        segment_data = {
            'id': i,
            'start': segment.start,
            'end': segment.end,
            'text': segment.text.strip(),
            'avg_logprob': segment.avg_logprob,
            'no_speech_prob': segment.no_speech_prob
        }
        
        # Extract word-level timestamps if requested
        if word_timestamps and segment.words:
            words = []
            for word in segment.words:
                words.append({
                    'word': word.word,
                    'start': word.start,
                    'end': word.end,
                    'probability': word.probability
                })
            segment_data['words'] = words
            words_list.extend(words)
        
        segments.append(segment_data)
        
        # Report progress (estimate based on segment index)
        # Note: faster-whisper doesn't provide total segment count upfront
        report_progress(i + 1, None, f"Processed segment {i + 1}")
    
    return segments, words_list


def main():
    parser = argparse.ArgumentParser(description='Transcribe audio using faster-whisper')
    parser.add_argument('--audio', required=True, help='Path to audio file')
    parser.add_argument('--model', default='base', 
                       choices=['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3', 'turbo'],
                       help='Model size')
    parser.add_argument('--language', help='Language code (e.g., en, es)')
    parser.add_argument('--task', default='transcribe', 
                       choices=['transcribe', 'translate'],
                       help='Task to perform')
    parser.add_argument('--device', default='cpu',
                       choices=['cpu', 'cuda'],
                       help='Device to run on')
    parser.add_argument('--compute-type', default='int8',
                       choices=['int8', 'float16', 'float32'],
                       help='Computation type')
    parser.add_argument('--word-timestamps', action='store_true',
                       help='Include word-level timestamps')
    parser.add_argument('--vad-filter', action='store_true',
                       help='Use VAD filter to remove silence')
    parser.add_argument('--output-format', default='json',
                       choices=['json', 'txt', 'srt'],
                       help='Output format')
    parser.add_argument('--threads', type=int, default=4,
                       help='Number of CPU threads (for CPU inference)')
    
    args = parser.parse_args()
    
    # Validate audio file exists
    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"ERROR: Audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)
    
    # Report initialization
    report_progress(0, 100, f"Loading {args.model} model on {args.device}...")
    
    try:
        # Initialize model
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=args.threads if args.device == 'cpu' else None
        )
        
        report_progress(10, 100, "Model loaded, starting transcription...")
        
        # Transcribe
        segments, info = model.transcribe(
            str(audio_path),
            language=args.language,
            task=args.task,
            word_timestamps=args.word_timestamps,
            vad_filter=args.vad_filter,
            beam_size=5
        )
        
        # Extract segments
        report_progress(20, 100, "Processing audio...")
        result_segments, words = extract_segments(segments, args.word_timestamps)
        
        # Build result
        result = {
            'language': info.language,
            'language_probability': info.language_probability,
            'duration': info.duration,
            'segments': result_segments,
            'word_count': len(words) if words else sum(len(s['text'].split()) for s in result_segments),
        }
        
        if words:
            result['words'] = words
        
        # Format output
        if args.output_format == 'json':
            report_progress(100, 100, "Complete!")
            print(json.dumps(result, indent=2))
        elif args.output_format == 'txt':
            for segment in result_segments:
                print(f"[{segment['start']:.2f} -> {segment['end']:.2f}] {segment['text']}")
        elif args.output_format == 'srt':
            for i, segment in enumerate(result_segments):
                print(f"{i + 1}")
                print(f"{format_timestamp(segment['start'])} --> {format_timestamp(segment['end'])}")
                print(segment['text'])
                print()
        
        sys.exit(0)
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


def format_timestamp(seconds: float) -> str:
    """Format timestamp for SRT (00:00:00,000)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millisecs = int((seconds % 1) * 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millisecs:03}"


if __name__ == '__main__':
    main()
```

### 2.2 JSON Output Format

```json
{
  "language": "en",
  "language_probability": 0.98,
  "duration": 360.5,
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 5.2,
      "text": "Hello, this is a test of Whisper.",
      "avg_logprob": -0.25,
      "no_speech_prob": 0.01,
      "words": [
        {
          "word": "Hello",
          "start": 0.0,
          "end": 0.8,
          "probability": 0.95
        },
        {
          "word": "this",
          "start": 1.2,
          "end": 1.5,
          "probability": 0.93
        }
      ]
    }
  ],
  "word_count": 8
}
```

### 2.3 Model Selection

| Model | Size | VRAM | Speed | Accuracy (WER) | Use Case |
|-------|------|------|-------|----------------|----------|
| **tiny** | 39 MB | ~1 GB | Very Fast | Higher error | Quick drafts, testing |
| **base** | 74 MB | ~1 GB | Fast | Good balance | Default choice |
| **small** | 244 MB | ~2 GB | Moderate | Better | Production quality |
| **medium** | 769 MB | ~5 GB | Slower | Very good | High accuracy needed |
| **large-v2** | 1550 MB | ~10 GB | Slow | Excellent | Best accuracy |
| **large-v3** | 1550 MB | ~10 GB | Slow | Best | Latest model |
| **turbo** | 809 MB | ~5 GB | Fast | Very good | Speed/accuracy balance |

**Recommendation for VOD Pipeline:**
- **Development**: `base` or `small` for quick iteration
- **Production**: `small` with int8 quantization for good balance
- **High Accuracy**: `distil-large-v3` for best speed/accuracy tradeoff

### 2.4 Performance Optimization

```python
# Batched transcription (recommended for longer audio)
from faster_whisper import WhisperModel, BatchedInferencePipeline

model = WhisperModel("turbo", device="cuda", compute_type="float16")
batched_model = BatchedInferencePipeline(model=model)
segments, info = batched_model.transcribe("audio.mp3", batch_size=16)

# INT8 quantization for CPU (saves memory, minimal accuracy loss)
model = WhisperModel("base", device="cpu", compute_type="int8")

# VAD filter to skip silent sections
segments, info = model.transcribe("audio.mp3", vad_filter=True, vad_parameters={
    "min_silence_duration_ms": 500,  # Skip silence >500ms
})

# Multi-threading for CPU
model = WhisperModel("base", device="cpu", cpu_threads=8)
```

---

## 3. Electron Environment Considerations

### 3.1 Bundling Python Dependencies

#### Option A: Embed Python with App (Recommended for Distribution)

```typescript
// electron-builder.yml (for packaging)
extraResources:
  - from: "resources/python"
    to: "python"
    filter: ["**/*"]

asar: false  # Required if Python needs to access bundled files
```

```bash
# Directory structure
app/
  resources/
    python/
      python3 (or python.exe)
      lib/
        faster_whisper/
        ctranslate2/
        ...
      transcribe.py
```

**Pros:**
- Self-contained, no external dependencies
- Consistent Python version across environments
- Works offline

**Cons:**
- Larger app size (~100-200 MB)
- Requires platform-specific Python builds
- ASAR packaging conflicts

#### Option B: System Python Installation (Recommended for Development)

```typescript
// Use system Python in development
const pythonPath = process.platform === 'win32' ? 'py' : 'python3';
const args = [scriptPath, ...options];

// In production:
// - macOS: Include in .app bundle
// - Windows: Install with NSIS installer
// - Linux: Require Python as system dependency
```

**Pros:**
- Smaller app size
- Uses system updates for Python
- Easier development

**Cons:**
- Dependency on system Python
- Version conflicts possible
- Requires user to install Python on Linux

#### Option C: On-Demand Download

```typescript
// Download Python + models on first run
import { download } from 'electron-dl';

async function ensurePythonResources(mainWindow: BrowserWindow) {
  const resourcesPath = path.join(app.getPath('userData'), 'python');
  
  if (!fs.existsSync(path.join(resourcesPath, 'python'))) {
    await download(mainWindow, 'https://example.com/python-mac.zip', {
      directory: resourcesPath,
      onProgress: (progress) => {
        mainWindow.webContents.send('download-progress', progress);
      }
    });
  }
}
```

### 3.2 Cross-Platform Compatibility

| Platform | Python Binary | Model Path | Notes |
|----------|--------------|------------|-------|
| **macOS** | `/usr/bin/python3` or bundled | `~/Library/Application Support/VOD Pipeline/models` | Use python.org Python for bundling |
| **Windows** | `py` launcher or bundled | `%APPDATA%\VOD Pipeline\models` | Include python.exe with app |
| **Linux** | `/usr/bin/python3` | `~/.local/share/VOD Pipeline/models` | Require system Python 3.9+ |

```typescript
// Platform-specific Python detection
function getPythonPath(): string {
  if (process.env.NODE_ENV === 'development') {
    return process.platform === 'win32' ? 'py' : 'python3';
  }
  
  // Production - use bundled Python
  const resourcesPath = process.resourcesPath;
  if (process.platform === 'win32') {
    return path.join(resourcesPath, 'python', 'python.exe');
  } else if (process.platform === 'darwin') {
    return path.join(resourcesPath, 'python', 'python');
  } else {
    // Linux - use system Python
    return '/usr/bin/python3';
  }
}
```

### 3.3 GPU Acceleration

```python
# Check for CUDA availability and configure accordingly
try:
    import torch
    cuda_available = torch.cuda.is_available()
except ImportError:
    cuda_available = False

device = "cuda" if cuda_available else "cpu"
compute_type = "float16" if cuda_available else "int8"
```

**Windows:**
- Requires NVIDIA GPU
- Install CUDA Toolkit + cuDNN
- Or use PyTorch with CUDA built-in

**macOS:**
- Apple Silicon: Use Metal (via PyTorch MPS or Core ML)
- Intel: CPU only

```python
# Apple Silicon Metal support (via Core ML)
if sys.platform == 'darwin' and 'arm' in platform.machine():
    # Use Core ML for acceleration
    device = "cpu"  # Core ML doesn't require device change
    # Model will automatically use ANE via whisper.cpp with Core ML
```

**Linux:**
- Requires NVIDIA drivers + CUDA
- Or use Intel OpenVINO for CPU optimization

### 3.4 Performance Considerations

| Factor | Impact | Optimization |
|--------|--------|--------------|
| **Model Size** | Direct | Use quantization (int8) |
| **Audio Length** | Linear | Use VAD for filtering |
| **Batch Size** | Significant | Use `BatchedInferencePipeline` |
| **Threads** | Moderate (CPU) | Set `cpu_threads = 4-8` |
| **Memory** | High for large models | Use smaller model or quantize |

```typescript
// Resource monitoring
import { systeminformation } from 'systeminformation';

async function ensureResourcesAvailable() {
  const [mem, cpu] = await Promise.all([
    systeminformation.mem(),
    systeminformation.cpu(),
  ]);
  
  const availableMemGB = mem.available / 1024 / 1024 / 1024;
  
  // Select model based on available memory
  if (availableMemGB < 2) {
    return 'tiny';
  } else if (availableMemGB < 4) {
    return 'base';
  } else if (availableMemGB < 8) {
    return 'small';
  } else {
    return 'medium';
  }
}
```

---

## 4. Alternatives

### 4.1 whisper.cpp (C/C++ Implementation)

**Repository**: https://github.com/ggml-org/whisper.cpp

**Pros:**
- Native C/C++ - no Python dependency
- Excellent performance (comparable to faster-whisper)
- Supports multiple backends: CUDA, Metal, Vulkan, OpenVINO
- Lower memory footprint
- Wide language bindings available

**Cons:**
- Slower development cycle (C/C++ compilation)
- Less active Python ecosystem integration
- Requires different build toolchain per platform

**Integration Options:**
```bash
# Option A: Build CLI and spawn
./build/bin/whisper-cli -m models/ggml-base.bin -f audio.mp3

# Option B: Use JavaScript bindings
https://github.com/ggml-org/whisper.cpp/tree/master/bindings/javascript

# Option C: Use WASM for in-browser transcription
npm install @ggml-org/whisper-cpp-wasm
```

**Node.js Bindings:**
```typescript
// Using whisper.cpp Node.js bindings
import { Whisper } from '@ggml-org/whisper.cpp';

const whisper = new Whisper('models/ggml-base.bin');
const result = await whisper.transcribe('audio.mp3', {
  language: 'en',
  wordTimestamps: true,
});
```

### 4.2 @xenova/transformers (WebAssembly)

**Repository**: https://github.com/xenova/transformers.js

**Pros:**
- Pure JavaScript/WebAssembly
- Runs in browser (no Electron main process needed)
- Works offline
- Easy deployment

**Cons:**
- Slower than native implementations
- Limited model sizes due to browser memory
- No GPU acceleration in browser (mostly)

```typescript
// Example usage
import { pipeline } from '@xenova/transformers';

const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
const output = await transcriber('audio.mp3', {
  language: 'english',
  task: 'transcribe',
  chunk_length_s: 30,
  stride_length_s: 5,
});
```

### 4.3 whisper-node (Node.js Native Bindings)

**Repository**: https://github.com/origami-d/whisper-node

**Note:** This package wraps whisper.cpp and provides native Node.js bindings.

**Pros:**
- Native Node.js, no subprocess overhead
- Direct access to Whisper models
- Good performance

**Cons:**
- Requires native compilation per platform
- Less maintained than whisper.cpp
- Limited feature set

### 4.4 Comparison Matrix

| Implementation | Language | Speed | Memory | GPU | Bundling | Maturity | Recommended |
|---------------|----------|-------|--------|-----|----------|----------|-------------|
| **faster-whisper** | Python | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | Complex | High | ✅ Primary |
| **whisper.cpp** | C/C++ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | Moderate | High | ✅ Alternative |
| **@xenova/transforms** | JS/WASM | ⭐⭐ | ⭐⭐⭐ | ❌ | Easy | High | ✅ Browser |
| **whisper-node** | Node/Native | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | Complex | Medium | ⚠️ Caution |
| **openai-whisper** | Python | ⭐⭐⭐ | ⭐⭐ | ✅ | Complex | High | ❌ Slower |

---

## 5. Full Examples

### 5.1 Complete TypeScript Worker Class

```typescript
// src/electron/transcription/whisper-worker.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number;
  words?: WhisperWord[];
}

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
  probability: number;
}

export interface WhisperResult {
  language: string;
  language_probability: number;
  duration: number;
  segments: WhisperSegment[];
  word_count: number;
  words?: WhisperWord[];
}

export interface TranscriptionOptions {
  audioPath: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3' | 'turbo';
  language?: string;
  task?: 'transcribe' | 'translate';
  device?: 'cpu' | 'cuda';
  computeType?: 'int8' | 'float16' | 'float32';
  wordTimestamps?: boolean;
  vadFilter?: boolean;
  outputFormat?: 'json' | 'txt' | 'srt';
  threads?: number;
}

export class WhisperWorker extends EventEmitter {
  private process: ChildProcess | null = null;
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    super();
    this.pythonPath = this.getPythonPath();
    this.scriptPath = path.join(app.getAppPath(), 'python', 'transcribe.py');
  }

  private getPythonPath(): string {
    if (process.env.NODE_ENV === 'development') {
      return process.platform === 'win32' ? 'py' : 'python3';
    }
    
    // Production: Check for bundled Python first
    const bundledPython = path.join(
      process.resourcesPath, 
      'python', 
      process.platform === 'win32' ? 'python.exe' : 'python'
    );
    
    if (require('fs').existsSync(bundledPython)) {
      return bundledPython;
    }
    
    // Fallback to system Python
    return process.platform === 'win32' ? 'py' : 'python3';
  }

  async transcribe(options: TranscriptionOptions): Promise<WhisperResult> {
    return new Promise((resolve, reject) => {
      if (!require('fs').existsSync(options.audioPath)) {
        reject(new Error(`Audio file not found: ${options.audioPath}`));
        return;
      }

      const args = this.buildArgs(options);
      
      this.process = spawn(this.pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          // Add path to bundled Python libs if needed
          PYTHONPATH: process.env.PYTHONPATH,
        },
      });

      let jsonOutput = '';
      let buffer = '';

      // Handle stderr (progress messages)
      this.process.stderr?.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          this.parseProgressLine(line);
        }
      });

      // Handle stdout (final JSON output)
      this.process.stdout?.on('data', (data) => {
        jsonOutput += data.toString();
      });

      // Handle process completion
      this.process.on('close', (code) => {
        this.process = null;
        
        if (code === 0) {
          try {
            const result = JSON.parse(jsonOutput) as WhisperResult;
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse output: ${e}`));
          }
        } else {
          reject(new Error(`Transcription failed (exit code ${code})`));
        }
        
        this.emit('complete');
      });

      // Handle process errors
      this.process.on('error', (err) => {
        this.process = null;
        reject(new Error(`Process error: ${err.message}`));
      });
    });
  }

  private buildArgs(options: TranscriptionOptions): string[] {
    const args = [
      this.scriptPath,
      '--audio', options.audioPath,
      '--model', options.model || 'base',
      '--output-format', options.outputFormat || 'json',
    ];

    if (options.language) args.push('--language', options.language);
    if (options.task) args.push('--task', options.task);
    if (options.device) args.push('--device', options.device);
    if (options.computeType) args.push('--compute-type', options.computeType);
    if (options.wordTimestamps) args.push('--word-timestamps');
    if (options.vadFilter) args.push('--vad-filter');
    if (options.threads) args.push('--threads', options.threads.toString());

    return args;
  }

  private parseProgressLine(line: string): void {
    if (line.startsWith('PROGRESS:')) {
      try {
        const progress = JSON.parse(line.substring(9));
        this.emit('progress', progress);
      } catch (e) {
        // Fallback to simple percentage parsing
        const match = line.match(/(\d+)%/);
        if (match) {
          this.emit('progress', { 
            current: parseInt(match[1]), 
            message: 'Processing...' 
          });
        }
      }
    } else if (line.startsWith('ERROR:')) {
      this.emit('error', line.substring(6));
    }
  }

  cancel(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.emit('cancelled');
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
```

### 5.2 Complete Electron IPC Integration

```typescript
// src/electron/ipc/transcription.ts
import { ipcMain } from 'electron';
import { WhisperWorker, TranscriptionOptions } from './whisper-worker';
import path from 'path';
import fs from 'fs/promises';

const activeWorkers = new Map<string, WhisperWorker>();

export function registerTranscriptionHandlers(): void {
  // Start transcription
  ipcMain.handle('transcription:start', async (event, options: TranscriptionOptions & { jobId: string }) => {
    const { jobId, ...transcriptionOptions } = options;
    
    // Cancel existing worker for this job
    if (activeWorkers.has(jobId)) {
      activeWorkers.get(jobId)!.cancel();
    }

    const worker = new WhisperWorker();
    activeWorkers.set(jobId, worker);

    // Forward progress events to renderer
    worker.on('progress', (progress) => {
      event.sender.send('transcription:progress', { jobId, progress });
    });

    worker.on('error', (error) => {
      event.sender.send('transcription:error', { jobId, error });
    });

    try {
      const result = await worker.transcribe(transcriptionOptions);
      
      // Save transcription to file
      const outputPath = path.join(
        app.getPath('userData'),
        'transcriptions',
        `${jobId}.json`
      );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
      
      return { success: true, outputPath };
    } finally {
      activeWorkers.delete(jobId);
    }
  });

  // Cancel transcription
  ipcMain.handle('transcription:cancel', async (event, jobId: string) => {
    const worker = activeWorkers.get(jobId);
    if (worker) {
      worker.cancel();
      activeWorkers.delete(jobId);
      return { success: true };
    }
    return { success: false, error: 'Job not found' };
  });

  // Get transcription status
  ipcMain.handle('transcription:status', async (event, jobId: string) => {
    const worker = activeWorkers.get(jobId);
    return {
      running: worker?.isRunning() ?? false,
    };
  });

  // Save transcription
  ipcMain.handle('transcription:save', async (event, jobId: string) => {
    const outputPath = path.join(
      app.getPath('userData'),
      'transcriptions',
      `${jobId}.json`
    );
    
    try {
      const content = await fs.readFile(outputPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      throw new Error('Transcription not found');
    }
  });
}
```

```typescript
// src/electron/main.ts
import { app, BrowserWindow } from 'electron';
import { registerTranscriptionHandlers } from './ipc/transcription';

app.whenReady().then(() => {
  const win = new BrowserWindow({ /* ... */ });
  registerTranscriptionHandlers();
});
```

### 5.3 Renderer Process Usage

```typescript
// src/renderer/lib/transcription.ts
import { ipcRenderer } from 'electron';

export interface TranscriptionProgress {
  current: number;
  total?: number;
  message: string;
}

export class TranscriptionClient {
  static async start(
    jobId: string,
    options: TranscriptionOptions,
    onProgress?: (progress: TranscriptionProgress) => void,
    onError?: (error: string) => void
  ): Promise<{ success: boolean; outputPath?: string }> {
    // Listen for progress
    const progressHandler = (_: any, data: { jobId: string; progress: TranscriptionProgress }) => {
      if (data.jobId === jobId && onProgress) {
        onProgress(data.progress);
      }
    };
    ipcRenderer.on('transcription:progress', progressHandler);

    // Listen for errors
    const errorHandler = (_: any, data: { jobId: string; error: string }) => {
      if (data.jobId === jobId && onError) {
        onError(data.error);
      }
    };
    ipcRenderer.on('transcription:error', errorHandler);

    try {
      const result = await ipcRenderer.invoke('transcription:start', { jobId, ...options });
      return result;
    } finally {
      ipcRenderer.off('transcription:progress', progressHandler);
      ipcRenderer.off('transcription:error', errorHandler);
    }
  }

  static async cancel(jobId: string): Promise<boolean> {
    const result = await ipcRenderer.invoke('transcription:cancel', jobId);
    return result.success;
  }

  static async getStatus(jobId: string): Promise<{ running: boolean }> {
    return await ipcRenderer.invoke('transcription:status', jobId);
  }

  static async load(jobId: string): Promise<WhisperResult> {
    return await ipcRenderer.invoke('transcription:save', jobId);
  }
}
```

```typescript
// Example usage in Svelte component
<script lang="ts">
  import { TranscriptionClient } from '$lib/transcription';
  
  let progress = 0;
  let status = 'idle';
  let result: WhisperResult | null = null;
  
  async function startTranscription() {
    status = 'processing';
    progress = 0;
    
    const jobId = crypto.randomUUID();
    const options = {
      audioPath: '/path/to/audio.mp3',
      model: 'base',
      wordTimestamps: true,
    };
    
    try {
      await TranscriptionClient.start(
        jobId,
        options,
        (p) => progress = p.current,
        (err) => console.error('Error:', err)
      );
      
      result = await TranscriptionClient.load(jobId);
      status = 'complete';
    } catch (e) {
      status = 'error';
      console.error(e);
    }
  }
</script>
```

---

## Recommendation for VOD Pipeline

### Primary Approach: faster-whisper + child_process.spawn

**Rationale:**
1. **Performance**: 4x faster than openai-whisper, efficient memory usage
2. **Accuracy**: State-of-the-art Whisper models
3. **Flexibility**: Easy to update Python dependencies
4. **Progress Tracking**: Real-time progress via stderr
5. **Community**: Large ecosystem, active maintenance

### Implementation Plan

| Phase | Tasks |
|-------|-------|
| **Phase 1** | - Set up Python environment with faster-whisper<br>- Create `transcribe.py` script with JSON output<br>- Implement `WhisperWorker` class with spawn<br>- Add basic progress tracking |
| **Phase 2** | - IPC integration with main process<br>- Database persistence for transcriptions<br>- Error handling and cleanup<br>- Model caching (download once, reuse) |
| **Phase 3** | - GPU acceleration support<br>- Batched transcription for long audio<br>- Word-level timestamps (for beat extraction)<br>- VAD filter integration |
| **Phase 4** | - Performance profiling<br>- Resource-aware model selection<br>- Cross-platform Python bundling<br>- Unit tests |

### Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| **Model** | `small` (int8) | Good balance of speed/accuracy for development; `distil-large-v3` for production |
| **Communication** | stdout for JSON, stderr for progress | Clean separation of output and metadata |
| **Bundling** | System Python for dev, bundled for prod | Easier development, reliable distribution |
| **Process Management** | Map of active workers by jobId | Support multiple concurrent transcriptions |
| **Error Handling** | Try/catch + cleanup on app quit | Prevent zombie processes |

### Future Considerations

1. **whisper.cpp Migration**: If packaging Python becomes too complex, consider migrating to whisper.cpp native bindings
2. **Cloud Fallback**: Offer cloud transcription (OpenAI/Google) for users without powerful GPUs
3. **Streaming**: Implement streaming for real-time/live transcription
4. **Diarization**: Add speaker detection (whisperX or similar)
5. **GPU Detection**: Automatically detect and use CUDA/Metal when available

---

## References

- **faster-whisper**: https://github.com/SYSTRAN/faster-whisper
- **whisper.cpp**: https://github.com/ggml-org/whisper.cpp
- **Node.js child_process**: https://nodejs.org/api/child_process.html
- **Electron IPC**: https://www.electronjs.org/docs/latest/tutorial/ipc
- **Electron preload scripts**: https://www.electronjs.org/docs/latest/tutorial/tutorial-preload
- **@xenova/transformers**: https://github.com/xenova/transformers.js

---

**Document Version**: 1.0  
**Last Updated**: January 23, 2026
