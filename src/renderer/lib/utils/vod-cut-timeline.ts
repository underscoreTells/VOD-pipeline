export {
  calculateZoomAroundPointer,
  clampNumber,
  clampRangeAgainstNeighbors,
  getAdaptiveRulerStep,
  normalizeRange as normalizeVodRange,
  pointerToTime as pointerToVodTime,
  rangesOverlap,
  timeToPixels as vodTimeToPixels,
} from './timeline-geometry.js';

export type {
  CalculateZoomAroundPointerInput,
  ClampRangeAgainstNeighborsInput,
  PointerToTimeInput as PointerToVodTimeInput,
  TimelineRange as VodRange,
} from './timeline-geometry.js';
