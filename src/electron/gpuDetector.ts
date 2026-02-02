import { spawn } from 'child_process';

export interface GPUEncoderInfo {
  encoder: string;
  name: string;
  platform: 'nvidia' | 'amd' | 'intel' | 'vaapi';
  priority: number; // Lower = higher priority (prefer hardware encoding)
  source: string; // Which FFmpeg binary has this encoder
}

const GPU_ENCODERS: Omit<GPUEncoderInfo, 'source'>[] = [
  // NVIDIA - fastest, best quality
  { encoder: 'h264_nvenc', name: 'NVIDIA NVENC', platform: 'nvidia', priority: 1 },
  { encoder: 'hevc_nvenc', name: 'NVIDIA NVENC HEVC', platform: 'nvidia', priority: 2 },
  
  // Intel QuickSync - very fast, good quality
  { encoder: 'h264_qsv', name: 'Intel QuickSync', platform: 'intel', priority: 3 },
  { encoder: 'hevc_qsv', name: 'Intel QuickSync HEVC', platform: 'intel', priority: 4 },
  
  // AMD - decent speed
  { encoder: 'h264_amf', name: 'AMD AMF', platform: 'amd', priority: 5 },
  { encoder: 'hevc_amf', name: 'AMD AMF HEVC', platform: 'amd', priority: 6 },
  
  // Linux VAAPI - generic GPU acceleration
  { encoder: 'h264_vaapi', name: 'VAAPI', platform: 'vaapi', priority: 7 },
  { encoder: 'hevc_vaapi', name: 'VAAPI HEVC', platform: 'vaapi', priority: 8 },
];

let cachedEncoder: GPUEncoderInfo | null = null;
let detectionComplete = false;
let cachedFFmpegPath: string | null = null;

/**
 * Detect available GPU encoders by testing them with FFmpeg
 * Also checks system FFmpeg if bundled one doesn't have GPU support
 * Returns the best available encoder (lowest priority number)
 */
export async function detectGPUEncoders(ffmpegPath: string): Promise<GPUEncoderInfo | null> {
  if (detectionComplete && cachedFFmpegPath === ffmpegPath) {
    return cachedEncoder;
  }

  console.log('[GPU] Detecting available GPU encoders...');
  cachedFFmpegPath = ffmpegPath;

  // First try the provided FFmpeg path
  const result = await testEncodersOnPath(ffmpegPath);
  if (result) {
    cachedEncoder = result;
    detectionComplete = true;
    return result;
  }

  // If bundled FFmpeg doesn't have GPU support, try system FFmpeg
  console.log('[GPU] Bundled FFmpeg has no GPU support, checking system FFmpeg...');
  const systemResult = await testEncodersOnPath('ffmpeg');
  if (systemResult) {
    console.log(`[GPU] Found GPU encoder in system FFmpeg: ${systemResult.name}`);
    cachedEncoder = systemResult;
    detectionComplete = true;
    return systemResult;
  }

  console.log('[GPU] No GPU encoders available, falling back to CPU (libx264)');
  detectionComplete = true;
  return null;
}

async function testEncodersOnPath(ffmpegPath: string): Promise<GPUEncoderInfo | null> {
  for (const encoder of GPU_ENCODERS) {
    const isAvailable = await testEncoder(ffmpegPath, encoder.encoder);
    if (isAvailable) {
      console.log(`[GPU] Found encoder: ${encoder.name} (${encoder.encoder}) in ${ffmpegPath}`);
      return { ...encoder, source: ffmpegPath };
    }
  }
  return null;
}

/**
 * Get cached GPU encoder detection result
 */
export function getGPUEncoder(): GPUEncoderInfo | null {
  return cachedEncoder;
}

/**
 * Check if GPU encoding is available
 */
export function hasGPUEncoding(): boolean {
  return cachedEncoder !== null;
}

/**
 * Get the FFmpeg path to use for GPU encoding
 * Returns system FFmpeg path if that's where GPU encoder was found
 */
export function getGPU FFmpegPath(): string | null {
  return cachedEncoder?.source ?? null;
}

/**
 * Test if an encoder is actually working in FFmpeg
 * Actually tries to encode a few frames to verify the encoder is compiled in
 */
async function testEncoder(ffmpegPath: string, encoder: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Generate 1 second of test video and try to encode it
    // This verifies the encoder is actually compiled into FFmpeg, not just listed
    const args = [
      '-f', 'lavfi',
      '-i', 'testsrc=duration=1:size=320x240:rate=1',
      '-c:v', encoder,
      '-frames:v', '1',
      '-f', 'null',
      '-',
    ];

    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      // Success means encoder works
      const success = code === 0;
      if (!success && stderr.includes('Unknown encoder')) {
        console.log(`[GPU] Encoder ${encoder} not available`);
      }
      resolve(success);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore
      }
      resolve(false);
    }, 5000);
  });
}

/**
 * Get the best available encoder settings for proxy generation
 * 
 * Returns encoder-specific arguments based on detected GPU
 */
export function getProxyEncoderArgs(
  useGPU: boolean,
  quality: 'high' | 'balanced' | 'fast' = 'balanced'
): {
  videoCodec: string;
  videoArgs: string[];
} {
  const encoder = useGPU ? cachedEncoder : null;

  if (!encoder) {
    // CPU encoding with libx264
    const presets = {
      high: 'slow',
      balanced: 'fast',
      fast: 'ultrafast',
    };
    
    return {
      videoCodec: 'libx264',
      videoArgs: [
        '-c:v', 'libx264',
        '-preset', presets[quality],
        '-crf', quality === 'high' ? '23' : quality === 'balanced' ? '28' : '32',
      ],
    };
  }

  // GPU encoding settings
  switch (encoder.platform) {
    case 'nvidia':
      return getNvidiaEncoderArgs(encoder.encoder, quality);
    case 'intel':
      return getIntelEncoderArgs(encoder.encoder, quality);
    case 'amd':
      return getAMDEncoderArgs(encoder.encoder, quality);
    case 'vaapi':
      return getVAAPIEncoderArgs(encoder.encoder, quality);
    default:
      // Fallback to CPU
      return {
        videoCodec: 'libx264',
        videoArgs: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '28'],
      };
  }
}

function getNvidiaEncoderArgs(encoder: string, quality: string): {
  videoCodec: string;
  videoArgs: string[];
} {
  // NVENC presets: p1 (fastest) to p7 (slowest/best quality)
  const presets: Record<string, string> = {
    high: 'p7',
    balanced: 'p4',
    fast: 'p1',
  };

  // CQ values: lower = better quality
  const cqValues: Record<string, string> = {
    high: '23',
    balanced: '28',
    fast: '35',
  };

  return {
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-preset', presets[quality],
      '-cq', cqValues[quality],
      '-rc', 'vbr', // Variable bitrate mode
    ],
  };
}

function getIntelEncoderArgs(encoder: string, quality: string): {
  videoCodec: string;
  videoArgs: string[];
} {
  // QuickSync presets
  const presets: Record<string, string> = {
    high: 'veryslow',
    balanced: 'fast',
    fast: 'veryfast',
  };

  // Global quality: lower = better quality
  const qualityValues: Record<string, string> = {
    high: '23',
    balanced: '28',
    fast: '35',
  };

  return {
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-preset', presets[quality],
      '-global_quality', qualityValues[quality],
    ],
  };
}

function getAMDEncoderArgs(encoder: string, quality: string): {
  videoCodec: string;
  videoArgs: string[];
} {
  // AMF quality presets
  const qualityPresets: Record<string, string> = {
    high: 'quality',
    balanced: 'balanced',
    fast: 'speed',
  };

  // QP values
  const qpValues: Record<string, string> = {
    high: '23',
    balanced: '28',
    fast: '35',
  };

  return {
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-quality', qualityPresets[quality],
      '-qp_p', qpValues[quality],
      '-qp_i', qpValues[quality],
    ],
  };
}

function getVAAPIEncoderArgs(encoder: string, quality: string): {
  videoCodec: string;
  videoArgs: string[];
} {
  // VAAPI uses different quality control
  const compressionLevels: Record<string, string> = {
    high: '4', // Higher compression = better quality
    balanced: '2',
    fast: '0',
  };

  return {
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-compression_level', compressionLevels[quality],
      '-qp', quality === 'high' ? '23' : quality === 'balanced' ? '28' : '35',
    ],
  };
}
