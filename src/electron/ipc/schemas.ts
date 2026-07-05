import { z } from 'zod';

// ===========================================================================
// Reusable permissive building blocks.
//
// The IPC handlers historically accepted loose payloads (numeric strings,
// missing optional fields, arbitrary pass-through objects). These schemas use
// `z.coerce.number()` to mirror `toNumberOrNull`, `.optional()`/`.nullable()`
// to tolerate missing/null fields, and `.passthrough()` object schemas so that
// pass-through payloads (proxyOptions, providerConfig, updates) survive
// validation unchanged. The goal is to reject only what previously produced
// undefined/NaN-driven error paths, never to narrow accepted inputs.
// ===========================================================================

const optionalNumber = z.coerce.number().optional();
const optionalString = z.string().optional();
const optionalObject = z.object({}).passthrough().optional();

// ===========================================================================
// Projects
// ===========================================================================

export const projectCreateSchema = z.object({
  name: optionalString,
});

export const projectGetSchema = z.object({
  id: optionalNumber,
});

export const projectUpdateSchema = z.object({
  id: optionalNumber,
  name: optionalString,
});

export const projectDeleteSchema = z.object({
  id: optionalNumber,
});

// ===========================================================================
// Chapters
// ===========================================================================

export const chapterCreateSchema = z.object({
  projectId: optionalNumber,
  title: optionalString,
  startTime: optionalNumber,
  endTime: optionalNumber,
});

export const chapterIdSchema = z.object({
  id: optionalNumber,
});

export const chapterGetByProjectSchema = z.object({
  projectId: optionalNumber,
});

export const chapterUpdateSchema = z.object({
  id: optionalNumber,
  updates: optionalObject,
});

export const chapterAssetLinkSchema = z.object({
  chapterId: optionalNumber,
  assetId: optionalNumber,
});

// Only the `toNumberOrNull`-driven IDs are validated here. `prewarmProxy`,
// `proxyOptions`, `ensureReady`, and `requestMode` keep their existing
// `Boolean()` / `typeof === 'object'` / `=== true` / literal-ternary semantics
// inline in the handler (zod's strict object/boolean checks would narrow those).
export const chapterAddAssetSchema = z.object({
  chapterId: z.coerce.number().int().positive(),
  assetId: z.coerce.number().int().positive(),
});

export const chapterReverseProxyGetSchema = z.object({
  chapterId: z.coerce.number().int().positive(),
  assetId: z.coerce.number().int().positive(),
});

export const chapterProxyCancelSchema = z.object({
  chapterId: z.coerce.number().int().positive(),
  assetId: z.coerce.number().int().positive(),
});

// ===========================================================================
// Clips
// ===========================================================================

export const clipCreateSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  createdAt: optionalString,
  projectId: optionalNumber,
  assetId: optionalNumber,
  trackIndex: optionalNumber,
  inPoint: optionalNumber,
  outPoint: optionalNumber,
  role: optionalString,
  description: optionalString,
  isEssential: z.boolean().optional(),
});

export const clipIdSchema = z.object({
  id: optionalNumber,
});

export const clipGetByProjectSchema = z.object({
  projectId: optionalNumber,
});

export const clipGetByAssetSchema = z.object({
  assetId: optionalNumber,
});

export const clipUpdateSchema = z.object({
  id: optionalNumber,
  updates: optionalObject,
});

export const clipBatchUpdateSchema = z.object({
  updates: z.array(z.object({}).passthrough()).optional(),
});

export const clipSuggestNameSchema = z.object({
  chapterId: z.coerce.number().int().positive(),
  inPoint: z.coerce.number().nullable(),
  outPoint: z.coerce.number().nullable(),
});

// ===========================================================================
// Timeline (accepts both camelCase and snake_case keys, as the handler does)
// ===========================================================================

// Timeline accepts both camelCase and snake_case keys, as the handler does.
// `selectedClipIds` is parsed inline (Array.isArray fallback) so it is omitted
// from the schema to avoid narrowing non-array inputs.
export const timelineStateSaveSchema = z.object({
  projectId: optionalNumber,
  project_id: optionalNumber,
  zoomLevel: optionalNumber,
  zoom_level: optionalNumber,
  scrollPosition: optionalNumber,
  scroll_position: optionalNumber,
  playheadTime: optionalNumber,
  playhead_time: optionalNumber,
});

export const timelineStateLoadSchema = z.object({
  projectId: optionalNumber,
});

export const timelineStateUpdateSchema = z.object({
  projectId: optionalNumber,
  updates: optionalObject,
});

// ===========================================================================
// Assets
// ===========================================================================

export const assetAddSchema = z.object({
  projectId: optionalNumber,
  filePath: optionalString,
});

export const assetIdSchema = z.object({
  id: optionalNumber,
});

export const assetGetByProjectSchema = z.object({
  projectId: optionalNumber,
});

// ===========================================================================
// Exports
// ===========================================================================

export const exportGenerateSchema = z.object({
  projectId: optionalNumber,
  format: optionalString,
  filePath: optionalString,
  options: optionalObject,
});

// ===========================================================================
// Waveforms
// ===========================================================================

// `playbackActive` is only logged by the handler, so it is parsed inline from
// the raw payload and omitted here to avoid narrowing non-boolean inputs.
export const waveformGenerateSchema = z.object({
  assetId: optionalNumber,
  trackIndex: optionalNumber,
});

export const waveformGetSchema = z.object({
  assetId: optionalNumber,
  trackIndex: optionalNumber,
  tierLevel: optionalNumber,
});

export const waveformGenerateTierSchema = z.object({
  assetId: optionalNumber,
  trackIndex: optionalNumber,
  tierLevel: optionalNumber,
});

// ===========================================================================
// Transcription
// ===========================================================================

export const transcriptionStatusSchema = z.object({
  autoSetup: z.unknown().optional(),
});

// `options` is destructured with a `{}` default and its nested fields read with
// `typeof`/`===` checks, so it is typed permissively to avoid narrowing.
export const transcribeChapterSchema = z.object({
  chapterId: optionalNumber,
  options: z.unknown().optional(),
});

export const transcribeCancelSchema = z.object({
  chapterId: z.coerce.number().int().positive(),
});
