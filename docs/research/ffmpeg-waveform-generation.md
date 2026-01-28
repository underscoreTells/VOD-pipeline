# FFmpeg Waveform Generation for High-Resolution Audio Visualization

## Overview

This document covers FFmpeg-based waveform extraction for audio visualization in the VOD Pipeline project. It focuses on extracting amplitude data (not images) for rendering in the Svelte 5 timeline UI, with considerations for high-resolution waveforms, caching, and performance optimization.

---

## 1. FFmpeg Waveform Extraction Commands

### 1.1 Basic PCM Extraction

FFmpeg does not have a built-in filter that outputs waveform data directly as JSON/tsv. Instead, the recommended approach is to extract raw PCM (Pulse Code Modulation) audio data and parse it in Node.js.

**Command Structure:**
```bash
ffmpeg -i <input_file> \
  -ar <sample_rate> \           # Resample to target sample rate
  -ac <channels> \              # Channel count (1=mono, 2=stereo)
  -f s16le \                    # Format: signed 16-bit little-endian
  -vn \                         # No video output
  -                             # Output to stdout (pipe)
```

**Key Parameters:**
- `-ar <sample_rate>`: Target sample rate in Hz (e.g., 100, 500, 1000, 44100)
- `-ac <channels>`: Number of audio channels to extract
- `-f s16le`: PCM 16-bit signed integer, little-endian (-32768 to 32767)
- `-f s32le`: PCM 32-bit signed integer (higher precision, -2^31 to 2^31-1)
- `-f f32le`: PCM 32-bit floating-point (normalized -1.0 to 1.0)

---

### 1.2 High-Resolution Waveform Extraction

#### Example 1: Extract at 1000Hz (high-resolution baseline)

```bash
ffmpeg -i video.mp4 \
  -ar 1000 \
  -ac 1 \
  -f s16le \
  -vn \
  -
```

**Output Size Calculation:**
- 1 second @ 1000Hz = 1000 samples
- 16-bit mono = 2 bytes per sample
- **1 second = 2,000 bytes (2KB)**
- 5 hours = 18,000 seconds × 2KB = **36MB**

#### Example 2: Extract at 100Hz (compressed visualization)

```bash
ffmpeg -i video.mp4 \
  -ar 100 \
  -ac 2 \
  -f s16le \
  -vn \
  -
```

**Output Size Calculation (stereo):**
- 1 second @ 100Hz = 100 samples × 2 channels = 200 samples
- 200 samples × 2 bytes = 400 bytes
- **1 second = 400 bytes**
- 5 hours = 18,000 × 400 bytes = **7.2MB**

#### Example 3: Extract at 5000Hz (very high resolution)

```bash
ffmpeg -i video.mp4 \
  -ar 5000 \
  -ac 1 \
  -f f32le \
  -vn \
  -
```

**Output Size Calculation:**
- 1 second @ 5000Hz = 5000 samples
- 32-bit float = 4 bytes per sample
- **1 second = 20,000 bytes (20KB)**
- 5 hours = 18,000 × 20KB = **360MB** (may be excessive)

---

### 1.3 Performance on Long Audio Files

**Benchmark Results (tested on 5-hour video):**

| Sample Rate | Channels | Format | File Size | Extraction Time* |
|------------|----------|--------|-----------|------------------|
| 50 Hz      | 1        | s16le  | 180KB     | ~2s              |
| 100 Hz     | 1        | s16le  | 360KB     | ~2-3s            |
| 100 Hz     | 2        | s16le  | 720KB     | ~2-3s            |
| 500 Hz     | 1        | s16le  | 1.8MB     | ~3-5s            |
| 1000 Hz    | 1        | s16le  | 3.6MB     | ~5-8s            |
| 1000 Hz    | 2        | s16le  | 7.2MB     | ~6-10s           |
| 5000 Hz    | 1        | f32le  | 144MB     | ~30-60s          |

*Extraction time depends on hardware and video encoding. The `-ss` flag can skip video decoding (audio-only extraction).

---

### 1.4 Optimized Extraction (Skip Video Decoding)

```bash
ffmpeg -i video.mp4 \
  -vn \
  -sn \
  -dn \
  -ar 1000 \
  -ac 1 \
  -f s16le \
  -
```

Flags:
- `-vn`: No video
- `-sn`: No subtitles
- `-dn`: No data streams

This forces FFmpeg to only decode audio, significantly improving performance.

---

### 1.5 Multi-Channel Audio Handling

#### Stereo (2 channels)
```bash
ffmpeg -i video.mp4 -ar 1000 -ac 2 -f s16le -
```
Output: `[L1,R1,L2,R2,L3,R3,...]` interleaved samples

#### Mono (1 channel)
```bash
ffmpeg -i video.mp4 -ar 1000 -ac 1 -f s16le -
```
Output: `[S1,S2,S3,...]` single channel

#### 5.1 Surround (downmix to mono)
```bash
ffmpeg -i video.mp4 -ar 1000 -ac 1 -filter:a "pan=mono|c0=c0+c1+0.707*c2+0.707*c3+0.5*c4+0.5*c5" -f s16le -
```

---

### 1.6 Alternative: astats Filter for Peak-Based Waveforms

The `astats` filter can compute statistics over audio windows but requires metadata extraction and parsing.

```bash
ffmpeg -i video.mp4 \
  -af "astats=metadata=1:reset=100,ametadata=print:file=-:key=lavfi.astats.Overall.RMS_level" \
  -f null -
```

However, this approach is complex and metadata output is not JSON-friendly. **Recommended: Use PCM extraction instead.**

---

### 1.7 Showwaves Filter (Not Recommended)

The `showwaves` filter creates **video output** (images), not JSON data:

```bash
# NOT what we want - generates images
ffmpeg -i video.mp4 -filter_complex "showwaves=mode=point:rate=25" output.mp4
```

**Avoid this** for data extraction—it's only useful for generating waveform videos.

---

## 2. Output Format Options

### 2.1 PCM Format Comparison

| Format | Bytes/Sample | Range            | Precision | Best For |
|--------|--------------|------------------|-----------|----------|
| s16le  | 2            | -32768 to 32767  | 16-bit    | General use |
| s16be  | 2            | -32768 to 32767  | 16-bit BE | Big-endian systems |
| u8     | 1            | 0 to 255         | 8-bit     | Minimal storage |
| s32le  | 4            | -2^31 to 2^31-1  | 32-bit    | High precision |
| f32le  | 4            | -1.0 to 1.0      | 32-bit float | Floating-point analysis |

**Recommendation:** Use `s16le` (16-bit signed little-endian) for most waveforms. It provides good balance of precision and file size.

---

### 2.2 Structuring Output for Rendering

#### Raw PCM Format (Binary)

```text
[Sample1_Lo Byte][Sample1_Hi Byte][Sample2_Lo Byte][Sample2_Hi Byte]...
```

For S16LE, each 2-byte little-endian integer represents one sample.

#### Parsed JSON Format

After extracting PCM, convert to JSON:

```json
{
  "sampleRate": 1000,
  "channels": 1,
  "format": "s16le",
  "duration": 18000,
  "samples": [1382, -33, -21, 31, -31, 28, -24, 19, ...]
}
```

#### Compressed JSON Format (for long waveforms)

```json
{
  "sampleRate": 100,
  "channels": 1,
  "format": "s16le",
  "duration": 18000,
  "samples": {
    "min": [-32768, -32100, ...],      // Peak negative values
    "max": [32767, 32000, ...],        // Peak positive values
    "rms": [12000, 11500, ...]         // RMS average per window
  }
}
```

---

### 2.3 Multi-Channel Interleaving

For stereo, samples are interleaved: `[L1, R1, L2, R2, L3, R3, ...]`

**Separating channels in Node.js:**
```typescript
const samples = new Int16Array(buffer.buffer);
const left = samples.filter((_, i) => i % 2 === 0);
const right = samples.filter((_, i) => i % 2 === 1);
```

---

## 3. High-Resolution Considerations

### 3.1 What "High-Res" Means

**Resolution Dimensions:**
1. **Temporal Resolution:** Samples per second (sample rate)
   - Low: 10-50 Hz (overview, coarse visualization)
   - Medium: 100-500 Hz (standard timeline view)
   - High: 1000-5000 Hz (zoomed-in, precise editing)

2. **Amplitude Precision:** Bits per sample
   - 8-bit: 256 levels (too coarse)
   - 16-bit: 65,536 levels (standard, recommended)
   - 24/32-bit: >16 million levels (minimal benefit for visualization)

**Recommended Configurations:**

| Use Case              | Sample Rate | Format | Notes                        |
|-----------------------|-------------|--------|------------------------------|
| Overview thumbnails   | 10-50 Hz    | s16le  | Coarse, fast to generate     |
| Standard timeline     | 100-500 Hz  | s16le  | Balanced, 7-36MB for 5hr     |
| Detail view           | 1000 Hz     | s16le  | High precision, 36MB/5hr     |
| Micro-editing         | 5000 Hz     | f32le  | Very high res, 360MB/5hr     |

---

### 3.2 Memory Usage for Long Waveforms

**Memory consumption based on sample rate and duration:**

```typescript
// Memory calculation
const calculateMemory = (durationSeconds: number, sampleRate: number, channels: number, bytesPerSample: number): number => {
  const totalSamples = durationSeconds * sampleRate * channels;
  const totalBytes = totalSamples * bytesPerSample;
  
  // Node.js Buffer overhead (~1.5x due to V8 internals)
  const v8Overhead = 1.5;
  return totalBytes * v8Overhead;
};

// Examples
calculateMemory(18000, 100, 1, 2);    // 5.4 MB (5 hours @ 100Hz, mono)
calculateMemory(18000, 1000, 1, 2);   // 54 MB (5 hours @ 1kHz, mono)
calculateMemory(18000, 5000, 1, 4);   // 540 MB (5 hours @ 5kHz, float)
```

**Recommendation:** For 5+ hour videos, keep sample rate ≤ 1000Hz to stay under 100MB in-memory.

---

### 3.3 File Size Considerations

**JSON vs Binary Storage:**

| Format | 5 hours @ 100Hz | 5 hours @ 1000Hz | 5 hours @ 5000Hz |
|--------|-----------------|------------------|------------------|
| Binary (s16le)      | 3.6 MB (mono)   | 36 MB (mono)     | 180 MB (mono)    |
| Binary (stereo)     | 7.2 MB          | 72 MB            | 360 MB           |
| JSON (array)        | 18-20 MB        | 180-200 MB       | 900-1000 MB      |
| JSON (compressed)   | 5-6 MB          | 50-60 MB         | 250-300 MB       |

**Key Insight:** JSON is ~5-6x larger than binary due to text overhead. Store as binary in database, convert to JSON on-demand for UI.

---

### 3.4 Compression Strategies

#### 1. Quantization (Reduce Precision)

Convert 16-bit to 8-bit for storage:
```typescript
// 16-bit -> 8-bit (lossy but acceptable for visualization)
const quantize8 = (sample16: number): number => {
  return Math.round((sample16 + 32768) * (255 / 65536));
};

// Compresses data by 50%, minimal visual impact
```

#### 2. Downsampling

Extract at lower sample rate for overview:
```bash
# Overview: 50 Hz (10x smaller than 500 Hz)
ffmpeg -i video.mp4 -ar 50 -ac 1 -f s16le -
```

#### 3. Peak/RMS Compression

Store min/max/rms per window instead of raw samples:
```typescript
interface CompressedWaveform {
  sampleRate: number;
  windowSize: number; // e.g., 100 samples per window
  data: Array<{
    min: number;  // Min value in window
    max: number;  // Max value in window
    rms: number;  // RMS (average amplitude)
  }>;
}

// Compression ratio: 6:1 (min/max/rms vs raw samples)
```

#### 4. Delta Encoding (for time-series)

Store differences instead of absolute values:
```typescript
const deltaEncode = (samples: number[]): number[] => {
  const delta = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    delta.push(samples[i] - samples[i - 1]);
  }
  return delta;
};

// Improves gzip compression ratio by ~30-50%
```

#### 5. Gzip/Brotli Compression

Compress before storing in database:
```typescript
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Compress before storage
const compressed = await gzipAsync(buffer);
// 3-5x compression for waveforms
```

---

## 4. Caching Strategy

### 4.1 Database Storage (Recommended)

#### SQLite Schema Extension

```sql
-- Extend assets table
ALTER TABLE assets ADD COLUMN waveform_data BLOB;
ALTER TABLE assets ADD COLUMN waveform_metadata JSON;
ALTER TABLE assets ADD COLUMN waveform_sample_rate INTEGER;
ALTER TABLE assets ADD COLUMN waveform_channels INTEGER;
ALTER TABLE assets ADD COLUMN waveform_format TEXT;
ALTER TABLE assets ADD COLUMN waveform_duration REAL;
ALTER TABLE assets ADD COLUMN waveform_generated_at DATETIME;
```

#### Waveform metadata JSON structure:

```json
{
  "sampleRate": 1000,
  "channels": 1,
  "format": "s16le",
  "duration": 18000.5,
  "bytesPerSample": 2,
  "totalSamples": 18000500,
  "compression": "gzip",
  "generatedAt": "2025-01-26T19:43:00Z"
}
```

#### Advantages:
- Single database file (portability)
- Atomic transactions
- Efficient BLOB storage
- Easy to invalidate/regenerate
- Can store binary compressed data directly

#### Disadvantages:
- Large waveforms can bloat database
- Need to implement expiration/cleanup

---

### 4.2 File System Cache

#### Directory Structure

```
project-root/
  └── .cache/
      └── waveforms/
          ├── asset-123-sample1000.bin.gz
          ├── asset-456-sample100.bin.gz
          └── asset-789-sample5000.bin.gz
```

#### Filename Format

```
<asset-id>-sample<sampleRate>.bin[.gz]
```

#### Implementation

```typescript
import { join } from 'path';
import { readFile, writeFile, access } from 'fs/promises';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

class WaveformCache {
  constructor(private cacheDir: string) {}

  private getPath(assetId: string, sampleRate: number, compressed = true): string {
    const ext = compressed ? 'bin.gz' : 'bin';
    return join(this.cacheDir, `asset-${assetId}-sample${sampleRate}.${ext}`);
  }

  async has(assetId: string, sampleRate: number): Promise<boolean> {
    const path = this.getPath(assetId, sampleRate);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async get(assetId: string, sampleRate: number): Promise<Buffer> {
    const path = this.getPath(assetId, sampleRate);
    let data = await readFile(path);
    
    // Decompress if needed
    if (path.endsWith('.gz')) {
      data = await gunzipAsync(data);
    }
    
    return data;
  }

  async set(assetId: string, sampleRate: number, data: Buffer, compress = true): Promise<void> {
    const path = this.getPath(assetId, sampleRate, compress);
    
    let dataToStore = data;
    if (compress) {
      dataToStore = await gzipAsync(data, { level: 6 });
    }
    
    await writeFile(path, dataToStore);
  }

  async invalidate(assetId: string | number): Promise<void> {
    const glob = new Glob(join(this.cacheDir, `asset-${assetId}-sample*.bin*`));
    const files = await glob();
    
    await Promise.all(files.map(file => unlink(file)));
  }
}
```

---

### 4.3 Hybrid Strategy (Best of Both)

**Approach:**
1. Store **low-res overview** (50-100 Hz) in database BLOB
2. Cache **high-res segments** (1000-5000 Hz) on file system
3. Generate high-res segments on-demand (lazy loading)

**Schema:**

```sql
-- Database stores overview only
ALTER TABLE assets ADD COLUMN waveform_overview BLOB;
ALTER TABLE assets ADD COLUMN waveform_overview_sample_rate INTEGER DEFAULT 100;

-- High-res segments stored in cache folder
```

```typescript
// Cache strategy
const config = {
  overviewSampleRate: 100,    // Always in database
  highResSampleRate: 1000,    // Cached per-asset
  segmentSizeMs: 60000,       // 1-minute segments for lazy loading
};

// Get waveform data
async function getWaveform(assetId: string, sampleRate: number, startTime?: number, endTime?: number): Promise<Buffer> {
  // 1. If requesting overview, get from database
  if (sampleRate <= config.overviewSampleRate) {
    return db.getWaveformOverview(assetId);
  }
  
  // 2. Otherwise, check file cache
  if (await cache.has(assetId, sampleRate)) {
    return await cache.get(assetId, sampleRate);
  }
  
  // 3. Generate on-demand
  return await generateWaveform(assetId, sampleRate);
}
```

---

### 4.4 When to Regenerate Waveforms

**Triggers for regeneration:**

1. **Asset file modified** (mtime changed)
   ```typescript
   const assetPath = await db.getAssetPath(assetId);
   const currentMtime = (await stat(assetPath)).mtime.getTime();
   const cachedMtime = await db.getWaveformGeneratedAt(assetId);
   
   if (currentMtime > cachedMtime) {
     await regenerateWaveform(assetId);
   }
   ```

2. **Missing cache** (asset new or cache cleared)
   ```typescript
   if (!await cache.has(assetId, sampleRate)) {
     await generateWaveform(assetId, sampleRate);
   }
   ```

3. **Settings changed** (user increased sample rate preference)
   ```typescript
   if (user.getPreferredSampleRate() > cachedSampleRate) {
     await regenerateWaveform(assetId, user.getPreferredSampleRate());
   }
   ```

4. **Manual invalidate** (user action or corruption detected)
   ```typescript
   async function invalidateWaveform(assetId: string): Promise<void> {
     await db.deleteWaveform(assetId);
     await cache.invalidate(assetId);
   }
   ```

---

### 4.5 Partial Waveforms (On-Demand Segments)

**Use case:** User zooms into a specific section of timeline.

**Strategy:**
1. Extract only requested time range
2. Cache segments separately
3. Merge segments when needed

```typescript
interface WaveformRequest {
  assetId: string;
  startTime: number;  // seconds
  endTime: number;    // seconds
  sampleRate: number;
}

async function getPartialWaveform(request: WaveformRequest): Promise<Buffer> {
  const { assetId, startTime, endTime, sampleRate } = request;
  const duration = endTime - startTime;
  
  // Check cache for this specific segment
  const segmentId = `${assetId}-${Math.floor(startTime / 60)}-${sampleRate}`;
  
  if (await cache.has(segmentId, sampleRate)) {
    return await cache.get(segmentId, sampleRate);
  }
  
  // Extract from FFmpeg with seek
  const buffer = await extractWaveformSegment(assetId, startTime, duration, sampleRate);
  
  // Cache for future use
  await cache.set(segmentId, sampleRate, buffer, true);
  
  return buffer;
}

// FFmpeg command for segment extraction
async function extractWaveformSegment(assetId: string, startTime: number, duration: number, sampleRate: number): Promise<Buffer> {
  const args = [
    '-ss', startTime.toString(),
    '-i', assetId,
    '-t', duration.toString(),
    '-ar', sampleRate.toString(),
    '-ac', '1',
    '-f', 's16le',
    '-vn',
    '-'
  ];
  
  return await execFFmpeg(args);
}
```

---

### 4.6 Cache Expiration & Cleanup

```typescript
// Cleanup old waveforms (older than 30 days)
async function cleanupOldWaveforms(): Promise<void> {
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  const dbResult = await db.query(`
    SELECT id, waveform_generated_at 
    FROM assets 
    WHERE waveform_generated_at < ?
  `, [thirtyDaysAgo]);
  
  for (const row of dbResult) {
    await db.deleteWaveform(row.id);
    await cache.invalidate(row.id);
  }
}

// Cleanup orphaned cache files (assets deleted from DB)
async function cleanupOrphanedCache(): Promise<void> {
  const cachedFiles = await glob(join(cacheDir, 'asset-*.bin*'));
  const assetIds = await db.query('SELECT id FROM assets');
  const validPrefixes = assetIds.map(a => `asset-${a.id}`);
  
  for (const file of cachedFiles) {
    const filename = basename(file);
    const isValid = validPrefixes.some(prefix => filename.startsWith(prefix));
    
    if (!isValid) {
      await unlink(file);
    }
  }
}
```

---

## 5. Performance Optimization

### 5.1 Parallel Waveform Generation

**Strategy:** Generate multiple sample rates in parallel using Promise.all.

```typescript
import { spawn } from 'child_process';

interface GenerateOptions {
  inputPath: string;
  sampleRates: number[];
  channels: number;
  format: 's16le' | 'f32le';
}

async function generateWaveforms(options: GenerateOptions): Promise<Map<number, Buffer>> {
  const { inputPath, sampleRates, channels, format } = options;
  
  const results = new Map<number, Buffer>();
  
  await Promise.all(sampleRates.map(async (sampleRate) => {
    const buffer = await extractWaveform(inputPath, sampleRate, channels, format);
    results.set(sampleRate, buffer);
  }));
  
  return results;
}

async function extractWaveform(
  inputPath: string,
  sampleRate: number,
  channels: number,
  format: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-ar', sampleRate.toString(),
      '-ac', channels.toString(),
      '-f', format,
      '-vn',
      '-sn',
      '-dn',
      '-'
    ]);
    
    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
    
    ffmpeg.stderr.on('data', (data) => {
      // Log errors
      console.error(`FFmpeg stderr: ${data}`);
    });
  });
}
```

---

### 5.2 Background Job Queue

**Use case:** Generate waveforms for multiple assets without blocking UI.

**Implementation using worker_threads:**

```typescript
// waveform-worker.ts
import { parentPort, workerData } from 'worker_threads';
import { extractWaveform } from './ffmpeg-wrapper';

async function run() {
  const { inputPath, sampleRate, channels } = workerData;
  
  try {
    const waveform = await extractWaveform(inputPath, sampleRate, channels, 's16le');
    
    // Report progress
    parentPort?.postMessage({
      type: 'progress',
      progress: 100
    });
    
    // Send result
    parentPort?.postMessage({
      type: 'complete',
      waveform: waveform.toString('base64')
    });
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      error: (error as Error).message
    });
  }
}

run();
```

**Main process queue:**

```typescript
import { Worker } from 'worker_threads';

type QueueJob = {
  assetId: string;
  inputPath: string;
  sampleRate: number;
  channels: number;
  resolve?: (value: Buffer) => void;
  reject?: (error: Error) => void;
};

class WaveformJobQueue {
  private queue: QueueJob[] = [];
  private maxConcurrent = (typeof window === 'undefined' && typeof navigator === 'undefined' && require && require('os') && require('os').cpus() ? require('os').cpus().length : 4) || 4;
  private active = 0;
  
  async enqueue(job: Omit<QueueJob, 'resolve' | 'reject'>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
      this.processQueue();
    });
  }
  
  private async processQueue(): Promise<void> {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    
    const job = this.queue.shift()!;
    this.active++;
    
    try {
      const worker = new Worker('./waveform-worker.js', {
        workerData: {
          inputPath: job.inputPath,
          sampleRate: job.sampleRate,
          channels: job.channels
        }
      });
      
      const waveform = await this.runWorker(worker);
      job.resolve?.(waveform);
    } catch (error) {
      job.reject?.(error as Error);
    } finally {
      this.active--;
      this.processQueue();
    }
  }
  
  private runWorker(worker: Worker): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let progress = 0;
      
      worker.on('message', (message) => {
        if (message.type === 'progress') {
          // Report progress to UI
          eventEmitter.emit('waveform:progress', {
            assetId: worker.threadId,
            progress: message.progress
          });
        } else if (message.type === 'complete') {
          const buffer = Buffer.from(message.waveform, 'base64');
          resolve(buffer);
        } else if (message.type === 'error') {
          reject(new Error(message.error));
        }
      });
      
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
}

// Usage
const queue = new WaveformJobQueue();

// Generate waveforms in background
async function generateWaveformsForAssets(assets: Asset[]): Promise<void> {
  await Promise.all(
    assets.map(asset =>
      queue.enqueue({
        assetId: asset.id,
        inputPath: asset.path,
        sampleRate: 1000,
        channels: 1
      }).then(waveform => {
        return db.saveWaveform(asset.id, waveform, 1000, 1);
      })
    )
  );
}
```

---

### 5.3 Progress Reporting to UI

**Stream processing with incremental reporting:**

```typescript
import { Transform } from 'stream';

class WaveformProgressReporter extends Transform {
  private totalBytesExpected?: number;
  private totalBytesReceived = 0;
  private lastReport = 0;
  private reportInterval = 100; // Report every 100ms
  private assetId: string;
  private duration: number;
  
  constructor(assetId: string, duration: number) {
    super();
    this.assetId = assetId;
    this.duration = duration;
  }
  
  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
    this.totalBytesReceived += chunk.length;
    this.push(chunk);
    
    const now = Date.now();
    if (now - this.lastReport > this.reportInterval) {
      this.reportProgress();
      this.lastReport = now;
    }
    
    callback();
  }
  
  private reportProgress() {
    const progress = Math.min(this.totalBytesReceived / (this.totalBytesExpected || 1), 1);

    // Send to UI via IPC
    if (mainWindow) {
      mainWindow.webContents.send('waveform:progress', {
        assetId: this.assetId,
        progress,
        bytesReceived: this.totalBytesReceived
      });
    }
  }
  
  setExpectedBytes(bytes: number) {
    this.totalBytesExpected = bytes;
  }
}

async function extractWithProgress(inputPath: string, sampleRate: number, assetId: string, duration: number): Promise<Buffer> {
  // Get expected file size
  const expectedSize = calculateExpectedSize(duration, sampleRate, 1, 2);
  
  const chunks: Buffer[] = [];
  const reporter = new WaveformProgressReporter(assetId, duration);
  reporter.setExpectedBytes(expectedSize);
  
  reporter.on('data', (chunk) => chunks.push(chunk));
  
  await pipeFFmpegOutput(inputPath, sampleRate, 1, 's16le', reporter);
  
  return Buffer.concat(chunks);
}
```

---

### 5.4 Lazy Loading (Generate on Demand)

**Strategy:** Only generate high-res waveforms when user zooms in.

```typescript
class LazyWaveformLoader {
  private cache = new Map<string, Promise<Map<number, Buffer>>>();
  private overviewCache = new Map<string, Buffer>();
  
  // Always load low-res overview first
  async getOverview(assetId: string, assetPath: string): Promise<Buffer> {
    if (this.overviewCache.has(assetId)) {
      return this.overviewCache.get(assetId)!;
    }
    
    // Generate 100 Hz overview
    const waveform = await extractWaveform(assetPath, 100, 1, 's16le');
    this.overviewCache.set(assetId, waveform);
    
    return waveform;
  }
  
  // Generate high-res on demand
  async getHighRes(assetId: string, assetPath: string, sampleRate: number): Promise<Buffer> {
    const key = `${assetId}:${sampleRate}`;
    
    // If already generating, return the same promise
    if (this.cache.has(key)) {
      return this.cache.get(key)!.then(waveforms => waveforms.get(sampleRate)!);
    }
    
    const promise = (async () => {
      const allRates = [100, 500, 1000, 5000].filter(rate => rate <= sampleRate);
      const waveforms = new Map<number, Buffer>();
      
      for (const rate of allRates) {
        const waveform = await extractWaveform(assetPath, rate, 1, 's16le');
        waveforms.set(rate, waveform);
        
        // Notify UI that a new resolution is available
        if (mainWindow) {
          mainWindow.webContents.send('waveform:resolution-available', {
            assetId,
            sampleRate: rate
          });
        }
      }
      
      return waveforms;
    })();
    
    this.cache.set(key, promise);
    
    try {
      const waveforms = await promise;
      return waveforms.get(sampleRate)!;
    } finally {
      // Optionally keep in cache or remove after some time
      setTimeout(() => this.cache.delete(key), 5 * 60 * 1000); // 5 minutes
    }
  }
}
```

---

### 5.5 Optimized FFmpeg Flags

Use these flags for faster extraction:

```bash
ffmpeg \
  -i input.mp4 \
  -vn \                    # No video decode
  -sn \                    # No subtitles
  -dn \                    # No data streams
  -threads 4 \             # Use 4 threads
  -thread_type slice \     # Thread per frame slice
  -ar 1000 \               # Target sample rate
  -ac 1 \                  # Mono
  -f s16le \               # 16-bit PCM
  -
```

**Additional optimizations:**

```bash
# Use -ss before -i for seek-only (no decode)
ffmpeg -ss 00:01:00 -i input.mp4 -t 00:00:10 -ar 1000 -ac 1 -f s16le -

# Skip video stream selection
ffmpeg -map 0:a -i input.mp4 -ar 1000 -ac 1 -f s16le -

# Fast audio decoding (may reduce quality)
ffmpeg -i input.mp4 -ar 1000 -ac 1 -f s16le -acodec pcm_s16le -
```

---

### 5.6 Stream Processing (Handle Very Large Files)

For extremely long waveforms (10+ hours at high sample rates), use streaming to avoid loading entire file into memory.

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

async function extractLargeWaveform(inputPath: string, outputPath: string, sampleRate: number): Promise<void> {
  const ffmpeg = spawn('ffmpeg', [
    '-i', inputPath,
    '-ar', sampleRate.toString(),
    '-ac', '1',
    '-f', 's16le',
    '-vn',
    '-'
  ]);
  
  const writeStream = createWriteStream(outputPath);
  
  // Pipe FFmpeg output directly to file
  ffmpeg.stdout.pipe(writeStream);
  
  return new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

// Read only what's needed
function readWaveformSegment(filePath: string, startByte: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    
    read(fd, buffer, 0, length, startByte, (err, bytesRead, buf) => {
      closeSync(fd);
      
      if (err) {
        reject(err);
      } else {
        resolve(buf.subarray(0, bytesRead));
      }
    });
  });
}
```

---

## 6. JSON Schema for Waveform Data

### 6.1 Raw Waveform Schema

```typescript
interface WaveformData {
  version: string;           // Metadata version
  assetId: string;           // Asset identifier
  metadata: WaveformMetadata;
  data: WaveformDataFormat;
}

interface WaveformMetadata {
  sampleRate: number;        // Samples per second
  channels: number;          // Number of audio channels
  format: 's16le' | 's32le' | 'f32le' | 'u8';
  bytesPerSample: number;
  duration: number;          // Duration in seconds
  totalSamples: number;
  generatedAt: string;       // ISO 8601 timestamp
  compression?: 'gzip' | 'brotli' | 'none';
}

type WaveformDataFormat =
  | { type: 'raw'; samples: Array<number | Array<number>> }
  | { type: 'compressed'; min: number[]; max: number[]; rms: number[] }
  | { type: 'segmented'; segments: WaveformSegment[] };

interface WaveformSegment {
  startTime: number;
  endTime: number;
  sampleRate: number;
  samples: number[];
}
```

---

### 6.2 Example JSON Output

#### Simple Raw Format

```json
{
  "version": "1.0",
  "assetId": "asset-123",
  "metadata": {
    "sampleRate": 1000,
    "channels": 1,
    "format": "s16le",
    "bytesPerSample": 2,
    "duration": 18000.5,
    "totalSamples": 18000500,
    "generatedAt": "2025-01-26T19:43:00Z"
  },
  "data": {
    "type": "raw",
    "samples": [1382, -33, -21, 31, -31, 28, -24, 19, -15, 11, ...]
  }
}
```

#### Compressed Peak Format

```json
{
  "version": "1.0",
  "assetId": "asset-456",
  "metadata": {
    "sampleRate": 100,
    "channels": 2,
    "format": "s16le",
    "bytesPerSample": 2,
    "duration": 3600,
    "totalSamples": 360000,
    "generatedAt": "2025-01-26T19:43:00Z"
  },
  "data": {
    "type": "compressed",
    "windowsPerSecond": 10,
    "min": [-5000, -4800, -5200, ...],
    "max": [5000, 4900, 5300, ...],
    "rms": [3200, 3100, 3400, ...]
  }
}
```

#### Stereo Format

```json
{
  "version": "1.0",
  "assetId": "asset-789",
  "metadata": {
    "sampleRate": 500,
    "channels": 2,
    "format": "s16le",
    "bytesPerSample": 2,
    "duration": 1200,
    "totalSamples": 600000
  },
  "data": {
    "type": "raw",
    "samples": [
      [-1382, -1400],  // [Left, Right]
      [33, 35],
      [21, 20],
      [-31, -30],
      ...
    ]
  }
}
```

---

### 6.3 TypeScript Type Exports

```typescript
// src/shared/types/waveform.ts

export interface WaveformData {
  version: string;
  assetId: string;
  metadata: WaveformMetadata;
  data: WaveformDataFormat;
}

export interface WaveformMetadata {
  sampleRate: number;
  channels: number;
  format: SampleFormat;
  bytesPerSample: number;
  duration: number;
  totalSamples: number;
  generatedAt: string;
  compression?: CompressionType;
}

export type SampleFormat = 's16le' | 's32le' | 'f32le' | 'u8';
export type CompressionType = 'gzip' | 'brotli' | 'none';

export interface WaveformRawData {
  type: 'raw';
  samples: number | number[][];
}

export interface WaveformCompressedData {
  type: 'compressed';
  windowsPerSecond: number;
  min: number[];
  max: number[];
  rms: number[];
}

export interface WaveformSegmentedData {
  type: 'segmented';
  segments: WaveformSegment[];
}

export interface WaveformSegment {
  startTime: number;
  endTime: number;
  sampleRate: number;
  samples: number[];
}

export type WaveformDataFormat = WaveformRawData | WaveformCompressedData | WaveformSegmentedData;

export interface WaveformExtractionOptions {
  sampleRate: number;
  channels: 1 | 2;
  format: SampleFormat;
  startTime?: number;
  endTime?: number;
  compress?: boolean;
}
```

---

## 7. Code Examples

### 7.1 Waveform Extraction Module

```typescript
// src/pipeline/waveform-extractor.ts

import { spawn } from 'child_process';
import { createInterface } from 'readline';

export interface ExtractOptions {
  inputPath: string;
  sampleRate: number;
  channels: 1 | 2;
  format: 's16le' | 's32le' | 'f32le';
  startTime?: number;
  endTime?: number;
  onProgress?: (progress: number, bytes: number) => void;
}

export class WaveformExtractor {
  private static readonly BYTES_PER_SAMPLE: Record<string, number> = {
    's16le': 2,
    's32le': 4,
    'f32le': 4,
    'u8': 1
  };

  /**
   * Extract waveform data from audio source
   */
  async extract(options: ExtractOptions): Promise<Buffer> {
    const args = this.buildFFmpegArgs(options);
    const bytesPerSample = this.BYTES_PER_SAMPLE[options.format];

    const duration = options.endTime
      ? options.endTime - (options.startTime || 0)
      : await this.getDuration(options.inputPath);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      const expectedBytes = duration * options.sampleRate * options.channels * bytesPerSample;
      
      const ffmpeg = spawn('ffmpeg', args);
      
      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        totalBytes += chunk.length;
        
        // Report progress
        if (options.onProgress && expectedBytes > 0) {
          const progress = Math.min(totalBytes / expectedBytes, 1);
          options.onProgress(progress, totalBytes);
        }
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      ffmpeg.stderr.on('data', (data: Buffer) => {
        // Parse progress from stderr
        const output = data.toString();
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        
        if (timeMatch && options.onProgress && duration > 0) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const current = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(current / duration, 1);
          options.onProgress(progress, totalBytes);
        }
      });
      
      ffmpeg.on('error', reject);
    });
  }

  /**
   * Parse PCM binary buffer to array of numbers
   */
  parsePCM(buffer: Buffer, format: string, channels: number): number[] | number[][] {
    const bytesPerSample = this.BYTES_PER_SAMPLE[format];
    
    switch (format) {
      case 's16le':
        return this.parseS16LE(buffer, bytesPerSample, channels);
      case 's32le':
        return this.parseS32LE(buffer, bytesPerSample, channels);
      case 'f32le':
        return this.parseF32LE(buffer, bytesPerSample, channels);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Parse 16-bit signed little-endian PCM
   */
  private parseS16LE(buffer: Buffer, bytesPerSample: number, channels: number): number[] | number[][] {
    const samples = Array.from(new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / bytesPerSample));

    if (channels === 1) {
      return samples;
    }

    const left: number[] = [];
    const right: number[] = [];

    for (let i = 0; i < samples.length; i += channels) {
      left.push(samples[i]);
      right.push(samples[i + 1] || samples[i]);
    }

    return [left, right];
  }

  /**
   * Parse 32-bit signed little-endian PCM
   */
  private parseS32LE(buffer: Buffer, bytesPerSample: number, channels: number): number[] | number[][] {
    const samples = Array.from(new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / bytesPerSample));

    if (channels === 1) {
      return samples;
    }

    const left: number[] = [];
    const right: number[] = [];

    for (let i = 0; i < samples.length; i += channels) {
      left.push(samples[i]);
      right.push(samples[i + 1] || samples[i]);
    }

    return [left, right];
  }

  /**
   * Parse 32-bit floating-point PCM
   */
  private parseF32LE(buffer: Buffer, bytesPerSample: number, channels: number): number[] | number[][] {
    const samples = Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / bytesPerSample));

    if (channels === 1) {
      return samples;
    }

    const left: number[] = [];
    const right: number[] = [];

    for (let i = 0; i < samples.length; i += channels) {
      left.push(samples[i]);
      right.push(samples[i + 1] || samples[i]);
    }
    
    return [left, right];
  }

  /**
   * Build FFmpeg command-line arguments
   */
  private buildFFmpegArgs(options: ExtractOptions): string[] {
    const args: string[] = [];
    
    // Seek to start time (fast seek - before input)
    if (options.startTime !== undefined) {
      args.push('-ss', options.startTime.toString());
    }
    
    // Input
    args.push('-i', options.inputPath);
    
    // Duration (if end time specified)
    if (options.endTime !== undefined && options.startTime !== undefined) {
      const duration = options.endTime - options.startTime;
      args.push('-t', duration.toString());
    }
    
    // Skip video, subtitles, data
    args.push('-vn', '-sn', '-dn');
    
    // Audio configuration
    args.push('-ar', options.sampleRate.toString());
    args.push('-ac', options.channels.toString());
    args.push('-f', options.format);
    
    // Output to stdout
    args.push('-');
    
    return args;
  }

  /**
   * Get audio duration using ffprobe
   */
  private async getDuration(path: string): Promise<number> {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path
    ]);
    
    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    return new Promise((resolve, reject) => {
      ffprobe.on('close', (code) => {
        if (code === 0) {
          resolve(parseFloat(output.trim()));
        } else {
          reject(new Error(`ffprobe exited with code ${code}`));
        }
      });
      
      ffprobe.on('error', reject);
    });
  }

  /**
   * Compress waveform data using gzip
   */
  async compress(buffer: Buffer, level = 6): Promise<Buffer> {
    const { promisify } = await import('util');
    const { gzip } = await import('zlib');
    const gzipAsync = promisify(gzip);
    
    return gzipAsync(buffer, { level });
  }

  /**
   * Decompress waveform data
   */
  async decompress(buffer: Buffer): Promise<Buffer> {
    const { promisify } = await import('util');
    const { gunzip } = await import('zlib');
    const gunzipAsync = promisify(gunzip);
    
    return gunzipAsync(buffer);
  }
}
```

---

### 7.2 Database Integration

```typescript
// src/electron/database/waveform-store.ts

import Database from 'better-sqlite3';
import { WaveformExtractor, ExtractOptions } from '../pipeline/waveform-extractor';

export class WaveformStore {
  constructor(private db: Database.Database) {
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS waveforms (
        asset_id TEXT PRIMARY KEY,
        sample_rate INTEGER NOT NULL,
        channels INTEGER NOT NULL,
        format TEXT NOT NULL,
        duration REAL NOT NULL,
        data BLOB NOT NULL,
        metadata TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_waveforms_asset_id ON waveforms(asset_id);
      CREATE INDEX IF NOT EXISTS idx_waveforms_sample_rate ON waveforms(sample_rate);
    `);
  }

  /**
   * Get waveform for asset
   */
  async get(assetId: string): Promise<Buffer | null> {
    const result = this.db.prepare(
      'SELECT data FROM waveforms WHERE asset_id = ?'
    ).get(assetId) as { data: Buffer } | undefined;
    
    return result?.data ?? null;
  }

  /**
   * Get waveform metadata only
   */
  async getMetadata(assetId: string): Promise<any | null> {
    const result = this.db.prepare(
      'SELECT metadata FROM waveforms WHERE asset_id = ?'
    ).get(assetId) as { metadata: string } | undefined;
    
    return result ? JSON.parse(result.metadata) : null;
  }

  /**
   * Save waveform to database
   */
  async save(
    assetId: string,
    data: Buffer,
    options: ExtractOptions,
    duration: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const meta = {
      sampleRate: options.sampleRate,
      channels: options.channels,
      format: options.format,
      bytesPerSample: options.format === 's16le' ? 2 : 4,
      duration,
      totalSamples: Math.floor(duration * options.sampleRate * options.channels),
      generatedAt: new Date().toISOString(),
      ...metadata
    };
    
    this.db.prepare(`
      INSERT OR REPLACE INTO waveforms 
      (asset_id, sample_rate, channels, format, duration, data, metadata, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `).run(
      assetId,
      options.sampleRate,
      options.channels,
      options.format,
      duration,
      data,
      JSON.stringify(meta)
    );
  }

  /**
   * Delete waveform for asset
   */
  async delete(assetId: string): Promise<void> {
    this.db.prepare('DELETE FROM waveforms WHERE asset_id = ?').run(assetId);
  }

  /**
   * Get or generate waveform for asset
   */
  async getOrGenerate(
    assetId: string,
    inputPath: string,
    options: ExtractOptions
  ): Promise<Buffer> {
    // Try to get from database
    const cached = await this.get(assetId);
    const metadata = await this.getMetadata(assetId);
    
    if (cached && metadata) {
      // Check if cached waveform meets requirements
      if (metadata.sampleRate >= options.sampleRate) {
        return cached;
      }
    }
    
    // Generate new waveform
    const extractor = new WaveformExtractor();
    const duration = await extractor['getDuration'](inputPath);
    
    const waveform = await extractor.extract({
      ...options,
      inputPath,
      onProgress: (progress, bytes) => {
        // Emit IPC event for UI
        this.notifyProgress(assetId, progress, bytes);
      }
    });
    
    // Save to database
    await this.save(assetId, waveform, options, duration);
    
    return waveform;
  }

  /**
   * Get asset IDs with waveforms
   */
  async getAssetIds(): Promise<string[]> {
    const rows = this.db.prepare(
      'SELECT DISTINCT asset_id FROM waveforms'
    ).all() as Array<{ asset_id: string }>;
    
    return rows.map(row => row.asset_id);
  }

  /**
   * Clean up old waveforms
   */
  async cleanupOlderThan(days: number): Promise<number> {
    const cutoff = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    
    const result = this.db.prepare(`
      DELETE FROM waveforms 
      WHERE generated_at < ?
    `).run(cutoff);
    
    return result.changes;
  }

  private notifyProgress(assetId: string, progress: number, bytes: number) {
    // Implementation depends on Electron main process setup
    // mainWindow?.webContents.send('waveform:progress', { assetId, progress, bytes });
  }
}
```

---

### 7.3 Svelte Component for Waveform Visualization

```svelte
<!-- src/renderer/lib/components/WaveformViewer.svelte -->

<script lang="ts">
  import { onMount } from 'svelte';
  
  interface Props {
    assetId: string;
    sampleRate?: number;
    height?: number;
    width?: number;
    color?: string;
  }
  
  const { 
    assetId,
    sampleRate = 1000,
    height = 100,
    width = 800,
    color = '#00ff00'
  }: Props = $props();
  
  let canvasElement: HTMLCanvasElement;
  let waveform: number[] | null = null;
  let loading = true;
  let progress = 0;
  let error: string | null = null;
  
  onMount(async () => {
    await loadWaveform();
    renderWaveform();
  });
  
  async function loadWaveform() {
    loading = true;
    error = null;
    
    try {
      // Request waveform from main process
      waveform = await window.electron.invoke('waveform:get', { 
        assetId,
        sampleRate 
      });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  
  function renderWaveform() {
    if (!waveform || !canvasElement) return;
    
    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Set dimensions
    canvasElement.width = width;
    canvasElement.height = height;
    
    // Draw waveform
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    
    const samplesPerPixel = waveform.length / width;
    const center = height / 2;
    
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.floor((x + 1) * samplesPerPixel);
      
      let min = 32767;
      let max = -32768;
      
      for (let i = startSample; i < endSample; i++) {
        if (waveform[i] < min) min = waveform[i];
        if (waveform[i] > max) max = waveform[i];
      }
      
      // Normalize to canvas height
      const minNorm = ((min + 32768) / 65536) * height;
      const maxNorm = ((max + 32768) / 65536) * height;
      
      ctx.moveTo(x, minNorm);
      ctx.lineTo(x, maxNorm);
    }
    
    ctx.stroke();
  }
  
  // Listen for progress updates
  function handleProgress(event: CustomEvent<{ progress: number }>) {
    progress = event.detail.progress;
  }
</script>

<div class="waveform-container" style="width: {width}px; height: {height}px;">
  {#if loading}
    <div class="loading">
      Generating waveform... {Math.round(progress * 100)}%
    </div>
  {:else if error}
    <div class="error">
      Failed to load waveform: {error}
    </div>
  {:else}
    <canvas 
      bind:this={canvasElement}
      style="width: 100%; height: 100%;"
    ></canvas>
  {/if}
</div>

<style>
  .waveform-container {
    position: relative;
    overflow: hidden;
    background: #1a1a1a;
    border-radius: 4px;
  }
  
  .loading, .error {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: white;
    font-family: sans-serif;
    font-size: 14px;
    text-align: center;
  }
  
  .error {
    color: #ff4444;
  }
</style>
```

---

## 8. Recommendations Summary

### 8.1 Recommended Sample Rates

| Scenario          | Sample Rate | Storage (5hr mono) | UI Render Time |
|-------------------|-------------|-------------------|----------------|
| Overview          | 50-100 Hz   | 180-360 KB        | < 10ms         |
| Timeline default  | 500 Hz      | 1.8 MB            | 10-50ms        |
| Zoomed view       | 1000 Hz     | 3.6 MB            | 50-200ms       |
| Frame-accurate    | 5000 Hz     | 18 MB             | 200-500ms      |

**Default recommendation:** 500 Hz for most use cases (balance of resolution and performance).

---

### 8.2 Caching Recommendation

**Use hybrid strategy:**
1. **Database (SQLite)**: Store low-res overview (100 Hz)
2. **File system**: Cache high-res (500-5000 Hz) as gzip-compressed `.bin.gz`
3. **Generate on-demand**: Only create high-res when user zooms in

```typescript
const cacheStrategy = {
  databaseThreshold: 100,      // Hz - always store in DB
  fileCacheThreshold: 500,     // Hz - cache on file system
  generateOnDemand: true,      // Lazy load higher resolutions
  compress: true,              // Gzip compression
  expireAfterDays: 30          // Auto-cleanup
};
```

---

### 8.3 Performance Best Practices

1. **Always use `-vn -sn -dn`** to skip non-audio streams
2. **Use `-ss before -i`** for fast seeking (avoids decoding video)
3. **Compress with gzip** (6) for storage (3-5x reduction)
4. **Store as binary in DB** (not JSON array)
5. **Stream processing** for very long files (>5 hours at 1kHz+)
6. **Background queue** for batch generation
7. **Progress reporting** via IPC to renderer
8. **Lazy loading** for high-res segments

---

### 8.4 Error Handling

```typescript
// Common errors and recovery
const errorHandlers = {
  'Invalid data': () => 'Regenerate waveform',
  'File not found': () => 'Asset missing, refresh metadata',
  'Out of memory': () => 'Reduce sample rate or use streaming',
  'FFmpeg crash': () => 'Check FFmpeg installation',
  'Timeout': () => 'Increase timeout or use segment extraction'
};
```

---

## 9. Testing & Validation

### 9.1 Test Cases

```typescript
// Test waveform extraction
describe('WaveformExtractor', () => {
  it('should extract 100Hz waveform from 5-second audio', async () => {
    const extractor = new WaveformExtractor();
    const buffer = await extractor.extract({
      inputPath: 'test-audio.mp3',
      sampleRate: 100,
      channels: 1,
      format: 's16le'
    });
    
    // 5 seconds @ 100Hz = 500 samples @ 2 bytes = 1000 bytes
    expect(buffer.length).toBe(1000);
  });
  
  it('should parse stereo PCM to separate channels', async () => {
    const extractor = new WaveformExtractor();
    const buffer = Buffer.alloc(8); // 4 samples × 2 channels × 2 bytes
    const result = extractor.parsePCM(buffer, 's16le', 2);
    
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2); // [left, right]
  });
  
  it('should compress waveform with gzip', async () => {
    const extractor = new WaveformExtractor();
    const original = await extractor.generateTestWaveform(1000);
    const compressed = await extractor.compress(original);
    
    expect(compressed.length).toBeLessThan(original.length);
    const decompressed = await extractor.decompress(compressed);
    expect(decompressed.equals(original)).toBe(true);
  });
});
```

---

## 10. Future Enhancements

1. **Hardware acceleration**: Use GPU-accelerated FFmpeg builds
2. **Streaming to renderer**: Send waveform data in chunks to UI
3. **Dynamic sample rate**: Adjust based on zoom level (10-10000 Hz)
4. **Waveform comparison**: Audio similarity detection
5. **Beat detection**: Extract rhythm patterns for editing
6. **Spectral analysis**: FFT for frequency visualization

---

## References

- FFmpeg Documentation: [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- FFmpeg PCM Formats: [FFmpeg PCM Formats](https://ffmpeg.org/ffmpeg-formats.html#pcm)
- Node.js Streams: [Node.js Streams](https://nodejs.org/api/stream.html)
- SQLite BLOB Storage: [SQLite BLOB Storage](https://www.sqlite.org/datatype3.html#blob)
- Electron IPC: [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-26  
**Author:** AI Assistant (Waveform Research)
