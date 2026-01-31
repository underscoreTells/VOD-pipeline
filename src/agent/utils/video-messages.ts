import { HumanMessage } from "@langchain/core/messages";
import { readFileAsBase64 } from "../providers/kimi.js";

/**
 * Video Message Formatter
 * Normalizes video content across different LLM providers
 * 
 * Providers:
 * - Gemini: Can reference local file path directly via fileData
 * - Kimi: Requires base64-encoded video via video_url
 */

export type VideoProvider = "gemini" | "kimi";

export interface VideoMessageOptions {
  provider: VideoProvider;
  videoPath: string;
  textPrompt: string;
  mimeType?: string;
}

/**
 * Create a multimodal message (text + video) formatted for the specific provider
 */
export async function createVideoMessage(
  options: VideoMessageOptions
): Promise<HumanMessage> {
  const { provider, videoPath, textPrompt, mimeType = "video/mp4" } = options;

  switch (provider) {
    case "gemini":
      return await createGeminiVideoMessage(videoPath, textPrompt, mimeType);
    case "kimi":
      return await createKimiVideoMessage(videoPath, textPrompt, mimeType);
    default:
      throw new Error(`Unsupported video provider: ${provider}`);
  }
}

/**
 * Maximum video file size for Gemini API (100MB to be safe)
 */
const GEMINI_MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Create message for Gemini using base64-encoded video
 * Gemini requires base64-encoded video data for local files
 */
async function createGeminiVideoMessage(
  videoPath: string,
  textPrompt: string,
  mimeType: string
): Promise<HumanMessage> {
  // Check file size before encoding to avoid memory issues
  const fs = await import("fs");
  const stats = await fs.promises.stat(videoPath);
  
  if (stats.size > GEMINI_MAX_VIDEO_SIZE) {
    throw new Error(
      `Video file too large for Gemini API: ${(stats.size / (1024 * 1024)).toFixed(1)}MB ` +
      `(max ${GEMINI_MAX_VIDEO_SIZE / (1024 * 1024)}MB). Consider using a shorter clip.`
    );
  }

  const base64Video = await readFileAsBase64(videoPath);

  return new HumanMessage({
    content: [
      {
        type: "text",
        text: textPrompt,
      },
      {
        type: "video",
        source_type: "base64",
        data: base64Video,
        mime_type: mimeType,
      },
    ],
  });
}

/**
 * Maximum video file size for Kimi API (100MB)
 * Base64 encoding increases size by ~33%, so we check before encoding
 */
const KIMI_MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Create message for Kimi (base64 encoded video)
 * Kimi requires base64-encoded video data
 */
async function createKimiVideoMessage(
  videoPath: string,
  textPrompt: string,
  mimeType: string
): Promise<HumanMessage> {
  // Check file size before encoding to avoid memory issues
  const fs = await import("fs");
  const stats = await fs.promises.stat(videoPath);
  
  if (stats.size > KIMI_MAX_VIDEO_SIZE) {
    throw new Error(
      `Video file too large for Kimi API: ${(stats.size / (1024 * 1024)).toFixed(1)}MB ` +
      `(max ${KIMI_MAX_VIDEO_SIZE / (1024 * 1024)}MB). Consider using Gemini or a shorter clip.`
    );
  }

  const base64Video = await readFileAsBase64(videoPath);

  return new HumanMessage({
    content: [
      {
        type: "text",
        text: textPrompt,
      },
      {
        type: "video_url",
        video_url: {
          url: `data:${mimeType};base64,${base64Video}`,
        },
      },
    ],
  });
}

/**
 * Check if a provider supports native video input
 */
export function supportsVideo(provider: VideoProvider): boolean {
  return provider === "gemini" || provider === "kimi";
}

/**
 * Get video file size in bytes
 * Useful for estimating API costs (some providers charge by size)
 */
export async function getVideoFileSize(videoPath: string): Promise<number> {
  const fs = await import("fs");
  const stats = await fs.promises.stat(videoPath);
  return stats.size;
}

/**
 * Estimate API cost for video analysis
 * Rough estimates based on typical pricing
 */
export function estimateVideoCost(
  fileSizeBytes: number,
  provider: VideoProvider
): { costUsd: number; description: string } {
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  switch (provider) {
    case "gemini":
      // Gemini: ~$0.10-0.15 per hour of video (640px proxy)
      // Rough estimate: $0.001 per MB
      return {
        costUsd: fileSizeMB * 0.001,
        description: `~$${(fileSizeMB * 0.001).toFixed(3)} (Gemini charges per token, video adds ~1000 tokens/MB)`,
      };
    case "kimi":
      // Kimi: ~$0.20-0.30 per hour of video
      // Rough estimate: $0.002 per MB
      return {
        costUsd: fileSizeMB * 0.002,
        description: `~$${(fileSizeMB * 0.002).toFixed(3)} (Kimi charges per token, video adds ~2000 tokens/MB)`,
      };
    default:
      return {
        costUsd: 0,
        description: "Provider pricing unknown",
      };
  }
}
