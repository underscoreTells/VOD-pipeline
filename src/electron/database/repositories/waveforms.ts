import type { WaveformPeak } from '../../../shared/types/pipeline.js';
import { getDatabase } from '../client.js';

const MAX_WAVEFORM_CACHE_ENTRIES = 1000;
const MAX_TIER1_CACHE_BYTES = 8 * 1024 * 1024;

export async function saveWaveform(
  assetId: number,
  trackIndex: number,
  tierLevel: 1 | 2 | 3,
  peaks: WaveformPeak[],
  sampleRate: number,
  duration: number
): Promise<void> {
  const database = await getDatabase();
  database.prepare(
    `INSERT OR REPLACE INTO waveform_cache (asset_id, track_index, tier_level, peaks, sample_rate, duration, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assetId,
    trackIndex,
    tierLevel,
    JSON.stringify(peaks),
    sampleRate,
    duration,
    new Date().toISOString()
  );
}

export async function getWaveform(
  assetId: number,
  trackIndex: number,
  tierLevel: 1 | 2 | 3
): Promise<{ peaks: WaveformPeak[]; sampleRate: number; duration: number; generatedAt: string } | null> {
  const database = await getDatabase();
  if (tierLevel === 1) {
    const metadata = database.prepare(
      'SELECT LENGTH(peaks) AS peak_bytes FROM waveform_cache WHERE asset_id = ? AND track_index = ? AND tier_level = ?'
    ).get(assetId, trackIndex, tierLevel) as { peak_bytes: number } | undefined;

    if (metadata && metadata.peak_bytes > MAX_TIER1_CACHE_BYTES) {
      database.prepare(
        'DELETE FROM waveform_cache WHERE asset_id = ? AND track_index = ? AND tier_level = ?'
      ).run(assetId, trackIndex, tierLevel);
      return null;
    }
  }

  const result = database.prepare(
    'SELECT peaks, sample_rate, duration, generated_at FROM waveform_cache WHERE asset_id = ? AND track_index = ? AND tier_level = ?'
  ).get(assetId, trackIndex, tierLevel) as {
    peaks: string;
    sample_rate: number;
    duration: number;
    generated_at: string;
  } | undefined;

  return result
    ? {
        peaks: JSON.parse(result.peaks) as WaveformPeak[],
        sampleRate: result.sample_rate,
        duration: result.duration,
        generatedAt: result.generated_at,
      }
    : null;
}

export async function checkWaveformExists(
  assetId: number,
  trackIndex: number,
  tierLevel: 1 | 2 | 3
): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT 1 FROM waveform_cache WHERE asset_id = ? AND track_index = ? AND tier_level = ?'
  ).get(assetId, trackIndex, tierLevel);

  return Boolean(result);
}

export async function deleteWaveformsByAsset(assetId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM waveform_cache WHERE asset_id = ?').run(assetId);

  return result.changes;
}

export async function getWaveformCacheCount(): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT COUNT(*) as count FROM waveform_cache'
  ).get() as { count: number };

  return result.count;
}

export async function cleanupWaveformCache(
  maxEntries: number = MAX_WAVEFORM_CACHE_ENTRIES
): Promise<number> {
  const database = await getDatabase();
  const countResult = database.prepare(
    'SELECT COUNT(*) as count FROM waveform_cache'
  ).get() as { count: number };
  const currentCount = countResult.count;

  if (currentCount <= maxEntries) {
    return 0;
  }

  const entriesToDelete = currentCount - maxEntries;
  const result = database.prepare(
    `DELETE FROM waveform_cache
     WHERE rowid IN (
       SELECT rowid FROM waveform_cache
       ORDER BY generated_at ASC
       LIMIT ?
     )`
  ).run(entriesToDelete);

  console.log(
    `[Waveform Cache] Cleaned up ${result.changes} old entries. Remaining: ${currentCount - result.changes}`
  );
  return result.changes;
}

export async function deleteOldWaveforms(olderThanDays: number): Promise<number> {
  const database = await getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = database.prepare(
    'DELETE FROM waveform_cache WHERE generated_at < ?'
  ).run(cutoffDate.toISOString());

  return result.changes;
}
