import type { Clip } from '../../shared/types/database';

export interface EDLOptions {
  title: string;
  frameRate: number;
  clips: Clip[];
  reelNames?: Map<number, string>; // assetId -> reel name
}

export function generateEDL(options: EDLOptions): string {
  const { title, frameRate, clips, reelNames } = options;
  
  // Sort clips by timeline position
  const sortedClips = [...clips].sort((a, b) => a.start_time - b.start_time);
  
  const lines: string[] = [];
  
  // Title line
  lines.push(`TITLE: ${title}`);
  lines.push(`FCM: NON-DROP FRAME`);
  lines.push('');
  
  // Generate edit entries
  let recordTime = 0; // Current position in the output timeline
  
  for (let i = 0; i < sortedClips.length; i++) {
    const clip = sortedClips[i];
    const eventNum = i + 1;
    const reel = reelNames?.get(clip.asset_id) || `REEL${clip.asset_id}`;
    const channel = 'V'; // Video channel
    const transition = 'C'; // Cut
    
    const clipDuration = clip.out_point - clip.in_point;
    
    // Source timecodes
    const sourceIn = secondsToTimecode(clip.in_point, frameRate);
    const sourceOut = secondsToTimecode(clip.out_point, frameRate);
    
    // Record timecodes
    const recordIn = secondsToTimecode(recordTime, frameRate);
    const recordOut = secondsToTimecode(recordTime + clipDuration, frameRate);
    
    lines.push(`${String(eventNum).padStart(3, '0')}  ${reel.padEnd(8, ' ')} ${channel}     ${transition}        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`);
    
    recordTime += clipDuration;
  }
  
  return lines.join('\n');
}

function secondsToTimecode(seconds: number, frameRate: number): string {
  const totalFrames = Math.round(seconds * frameRate);
  
  // Preserve original frameRate precision (don't round 29.97, 59.94)
  const frameRateInt = Math.round(frameRate);
  const frames = totalFrames % frameRateInt;
  const totalSeconds = Math.floor(totalFrames / frameRateInt);
  
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  
  // Format: HH:MM:SS:FF
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}
