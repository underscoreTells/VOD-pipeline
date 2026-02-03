/**
 * Pipeline types for video processing
 */
export { FFmpegPathResult };
export const PROXY_PRESETS = {
    AI_ANALYSIS: {
        name: 'AI Analysis',
        options: {
            width: 640,
            fps: 5,
            videoCodec: 'libx264',
            videoBitrate: '500k',
        },
    },
    ROUGH_CUT: {
        name: 'Rough Cut',
        options: {
            width: 720,
            fps: 15,
            videoCodec: 'libx264',
            videoBitrate: '1M',
        },
    },
    EDITABLE: {
        name: 'Editable',
        options: {
            width: 1280,
            fps: 24,
            videoCodec: 'libx264',
            videoBitrate: '2M',
        },
    },
    REVIEW: {
        name: 'Review',
        options: {
            width: 1920,
            fps: 30,
            videoCodec: 'prores',
            videoBitrate: '10M',
        },
    },
};
export const WAVEFORM_TIERS = {
    1: { level: 1, ratio: 256, resolution: 172 }, // Overview: 256:1
    2: { level: 2, ratio: 16, resolution: 2756 }, // Standard: 16:1
    3: { level: 3, ratio: 4, resolution: 11025 }, // Fine: 4:1
};
