import { spawn } from 'child_process';

export type GPUEncoderBackend = 'videotoolbox' | 'nvenc' | 'qsv' | 'amf';

export interface GPUEncoderInfo {
  backend: GPUEncoderBackend;
  encoder: string;
  name: string;
  priority: number;
  source: string;
}

type GPUEncoderCandidate = Omit<GPUEncoderInfo, 'source'>;

const GPU_ENCODER_CANDIDATES: Record<GPUEncoderBackend, GPUEncoderCandidate> = {
  videotoolbox: {
    backend: 'videotoolbox',
    encoder: 'h264_videotoolbox',
    name: 'Apple VideoToolbox',
    priority: 1,
  },
  nvenc: {
    backend: 'nvenc',
    encoder: 'h264_nvenc',
    name: 'NVIDIA NVENC',
    priority: 2,
  },
  qsv: {
    backend: 'qsv',
    encoder: 'h264_qsv',
    name: 'Intel Quick Sync',
    priority: 3,
  },
  amf: {
    backend: 'amf',
    encoder: 'h264_amf',
    name: 'AMD AMF',
    priority: 4,
  },
};

let cachedEncoder: GPUEncoderInfo | null = null;
let cachedFFmpegPath: string | null = null;

export function getPreferredGPUEncoders(
  platform: NodeJS.Platform = process.platform
): GPUEncoderCandidate[] {
  if (platform === 'darwin') {
    return [
      GPU_ENCODER_CANDIDATES.videotoolbox,
      GPU_ENCODER_CANDIDATES.nvenc,
      GPU_ENCODER_CANDIDATES.qsv,
      GPU_ENCODER_CANDIDATES.amf,
    ];
  }

  return [
    GPU_ENCODER_CANDIDATES.nvenc,
    GPU_ENCODER_CANDIDATES.qsv,
    GPU_ENCODER_CANDIDATES.amf,
  ];
}

export async function detectGPUEncoders(
  ffmpegPath: string,
  force = false
): Promise<GPUEncoderInfo | null> {
  if (!force && cachedEncoder && cachedFFmpegPath === ffmpegPath) {
    return cachedEncoder;
  }

  console.log('[GPU] Detecting available hardware encoders...');
  cachedFFmpegPath = ffmpegPath;

  const candidatePaths = ffmpegPath === 'ffmpeg' ? ['ffmpeg'] : [ffmpegPath, 'ffmpeg'];

  for (const executablePath of candidatePaths) {
    const encoder = await testEncodersOnPath(executablePath);
    if (encoder) {
      cachedEncoder = encoder;
      return encoder;
    }
  }

  cachedEncoder = null;
  console.log('[GPU] No supported hardware encoder detected; proxies will use CPU fallback.');
  return null;
}

async function testEncodersOnPath(ffmpegPath: string): Promise<GPUEncoderInfo | null> {
  for (const candidate of getPreferredGPUEncoders()) {
    const isAvailable = await testEncoder(ffmpegPath, candidate);
    if (isAvailable) {
      const encoder = { ...candidate, source: ffmpegPath };
      console.log(`[GPU] Selected ${encoder.name} (${encoder.encoder}) via ${ffmpegPath}`);
      return encoder;
    }
  }

  return null;
}

export function getGPUEncoder(): GPUEncoderInfo | null {
  return cachedEncoder;
}

export function hasGPUEncoding(): boolean {
  return cachedEncoder !== null;
}

export function getGPUFFmpegPath(): string | null {
  return cachedEncoder?.source ?? null;
}

export function clearGPUEncoderCache(): void {
  cachedEncoder = null;
  cachedFFmpegPath = null;
}

export function setGPUEncoderForTesting(
  encoder: GPUEncoderInfo | null,
  ffmpegPath: string | null = encoder?.source ?? null
): void {
  cachedEncoder = encoder;
  cachedFFmpegPath = ffmpegPath;
}

function getEncoderTestArgs(candidate: GPUEncoderCandidate): string[] {
  const commonArgs = [
    '-f', 'lavfi',
    '-i', 'testsrc=duration=1:size=320x240:rate=30',
    '-frames:v', '1',
  ];

  switch (candidate.backend) {
    case 'videotoolbox':
      return [
        ...commonArgs,
        '-c:v', candidate.encoder,
        '-allow_sw', '0',
        '-f', 'null',
        '-',
      ];
    case 'nvenc':
      return [
        ...commonArgs,
        '-c:v', candidate.encoder,
        '-preset', 'p4',
        '-cq', '28',
        '-f', 'null',
        '-',
      ];
    case 'qsv':
      return [
        ...commonArgs,
        '-c:v', candidate.encoder,
        '-preset', 'fast',
        '-global_quality', '28',
        '-f', 'null',
        '-',
      ];
    case 'amf':
      return [
        ...commonArgs,
        '-c:v', candidate.encoder,
        '-quality', 'balanced',
        '-qp_p', '28',
        '-qp_i', '28',
        '-f', 'null',
        '-',
      ];
  }
}

async function testEncoder(
  executablePath: string,
  candidate: GPUEncoderCandidate
): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const proc = spawn(executablePath, getEncoderTestArgs(candidate), {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    const timeoutId = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore kill failures on timed out probes.
      }
      finish(false);
    }, 5000);

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const success = code === 0;
      if (!success && stderr.includes('Unknown encoder')) {
        console.log(`[GPU] ${candidate.encoder} not available in ${executablePath}`);
      }
      finish(success);
    });

    proc.on('error', () => {
      clearTimeout(timeoutId);
      finish(false);
    });
  });
}

export function getProxyEncoderArgs(
  useGPU: boolean,
  quality: 'high' | 'balanced' | 'fast' = 'balanced'
): {
  backend: GPUEncoderBackend | 'cpu';
  videoCodec: string;
  videoArgs: string[];
} {
  const encoder = useGPU ? cachedEncoder : null;

  if (!encoder) {
    const presets = {
      high: 'slow',
      balanced: 'fast',
      fast: 'ultrafast',
    } as const;

    return {
      backend: 'cpu',
      videoCodec: 'libx264',
      videoArgs: [
        '-c:v', 'libx264',
        '-preset', presets[quality],
        '-crf', quality === 'high' ? '23' : quality === 'balanced' ? '28' : '32',
      ],
    };
  }

  switch (encoder.backend) {
    case 'videotoolbox':
      return getVideoToolboxEncoderArgs(encoder.encoder, quality);
    case 'nvenc':
      return getNvencEncoderArgs(encoder.encoder, quality);
    case 'qsv':
      return getQsvEncoderArgs(encoder.encoder, quality);
    case 'amf':
      return getAmfEncoderArgs(encoder.encoder, quality);
  }
}

function getVideoToolboxEncoderArgs(
  encoder: string,
  quality: 'high' | 'balanced' | 'fast'
): {
  backend: GPUEncoderBackend;
  videoCodec: string;
  videoArgs: string[];
} {
  const bitrates = {
    high: '2500k',
    balanced: '1500k',
    fast: '900k',
  } as const;

  return {
    backend: 'videotoolbox',
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-allow_sw', '0',
      '-b:v', bitrates[quality],
      '-maxrate', bitrates[quality],
      '-bufsize', bitrates[quality],
    ],
  };
}

function getNvencEncoderArgs(
  encoder: string,
  quality: 'high' | 'balanced' | 'fast'
): {
  backend: GPUEncoderBackend;
  videoCodec: string;
  videoArgs: string[];
} {
  const presets = {
    high: 'p7',
    balanced: 'p4',
    fast: 'p1',
  } as const;
  const cqValues = {
    high: '23',
    balanced: '28',
    fast: '35',
  } as const;

  return {
    backend: 'nvenc',
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-preset', presets[quality],
      '-cq', cqValues[quality],
      '-rc', 'vbr',
    ],
  };
}

function getQsvEncoderArgs(
  encoder: string,
  quality: 'high' | 'balanced' | 'fast'
): {
  backend: GPUEncoderBackend;
  videoCodec: string;
  videoArgs: string[];
} {
  const presets = {
    high: 'veryslow',
    balanced: 'fast',
    fast: 'veryfast',
  } as const;
  const qualityValues = {
    high: '23',
    balanced: '28',
    fast: '35',
  } as const;

  return {
    backend: 'qsv',
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-preset', presets[quality],
      '-global_quality', qualityValues[quality],
    ],
  };
}

function getAmfEncoderArgs(
  encoder: string,
  quality: 'high' | 'balanced' | 'fast'
): {
  backend: GPUEncoderBackend;
  videoCodec: string;
  videoArgs: string[];
} {
  const qualityPresets = {
    high: 'quality',
    balanced: 'balanced',
    fast: 'speed',
  } as const;
  const qpValues = {
    high: '23',
    balanced: '28',
    fast: '35',
  } as const;

  return {
    backend: 'amf',
    videoCodec: encoder,
    videoArgs: [
      '-c:v', encoder,
      '-quality', qualityPresets[quality],
      '-qp_p', qpValues[quality],
      '-qp_i', qpValues[quality],
    ],
  };
}
