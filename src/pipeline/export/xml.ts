import type { Clip } from '../../shared/types/database';

export interface FCPXMLOptions {
  projectName: string;
  projectId: number;
  frameRate: number;
  clips: Clip[];
  assetPaths: Map<number, string>; // assetId -> file path
}

export function generateFCPXML(options: FCPXMLOptions): string {
  const { projectName, projectId, frameRate, clips, assetPaths } = options;
  
  // Calculate total duration
  const totalDuration = clips.length > 0 
    ? Math.max(...clips.map(c => c.start_time + (c.out_point - c.in_point)))
    : 0;
  
  // Format frame rate
  const frameRateStr = formatFrameRate(frameRate);
  const timebase = frameRate.toString();
  
  // Build resources (assets)
  const assetResources: string[] = [];
  const formatResource = `    <format id="r0" name="FFVideoFormat${frameRateStr}" width="1920" height="1080" frameDuration="${formatFrameDuration(frameRate)}"/>`;
  
  const uniqueAssetIds = [...new Set(clips.map(c => c.asset_id))];
  let assetCounter = 1;
  const assetIdMap = new Map<number, string>(); // assetId -> resource id
  
  for (const assetId of uniqueAssetIds) {
    const assetPath = assetPaths.get(assetId);
    if (!assetPath) continue;
    
    const resourceId = `r${assetCounter}`;
    assetIdMap.set(assetId, resourceId);
    
    assetResources.push(`    <asset id="${resourceId}" name="${escapeXml(getFilename(assetPath))}" src="file://${escapeXml(assetPath)}" hasVideo="1" hasAudio="1" duration="${secondsToTimecode(totalDuration, frameRate)}"/>`);
    assetCounter++;
  }
  
  // Build spine (clips)
  const spineClips: string[] = [];
  for (const clip of clips) {
    const assetResourceId = assetIdMap.get(clip.asset_id);
    if (!assetResourceId) continue;
    
    const clipDuration = clip.out_point - clip.in_point;
    const offset = secondsToTimecode(clip.start_time, frameRate);
    const sourceIn = secondsToTimecode(clip.in_point, frameRate);
    const sourceOut = secondsToTimecode(clip.out_point, frameRate);
    
    spineClips.push(`      <clip name="${escapeXml(clip.description || `Clip ${clip.id}`)}" offset="${offset}" duration="${secondsToTimecode(clipDuration, frameRate)}">
        <asset-clip ref="${assetResourceId}" offset="0s" duration="${secondsToTimecode(clipDuration, frameRate)}" start="${sourceIn}"/> 
      </clip>`);
  }
  
  // Build full XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${formatResource}
${assetResources.join('\n')}
  </resources>
  <project name="${escapeXml(projectName)}" uid="project-${projectId}">
    <sequence format="r0" duration="${secondsToTimecode(totalDuration, frameRate)}" tcStart="0s" tcFormat="NDF">
      <spine>
${spineClips.join('\n')}
      </spine>
    </sequence>
  </project>
</fcpxml>`;

  return xml;
}

function formatFrameRate(frameRate: number): string {
  // Convert common frame rates to FCP format names
  if (Math.abs(frameRate - 23.976) < 0.1) return '1080p23.976';
  if (Math.abs(frameRate - 24) < 0.1) return '1080p24';
  if (Math.abs(frameRate - 25) < 0.1) return '1080p25';
  if (Math.abs(frameRate - 29.97) < 0.1) return '1080p29.97';
  if (Math.abs(frameRate - 30) < 0.1) return '1080p30';
  if (Math.abs(frameRate - 50) < 0.1) return '1080p50';
  if (Math.abs(frameRate - 59.94) < 0.1) return '1080p59.94';
  if (Math.abs(frameRate - 60) < 0.1) return '1080p60';
  return `1080p${Math.round(frameRate)}`;
}

function formatFrameDuration(frameRate: number): string {
  // Format as FCP time duration (e.g., "1001/24000s" for 23.976fps)
  if (Math.abs(frameRate - 23.976) < 0.1) return '1001/24000s';
  if (Math.abs(frameRate - 29.97) < 0.1) return '1001/30000s';
  if (Math.abs(frameRate - 59.94) < 0.1) return '1001/60000s';
  
  const denominator = Math.round(frameRate);
  return `1/${denominator}s`;
}

function secondsToTimecode(seconds: number, frameRate: number): string {
  const totalFrames = Math.round(seconds * frameRate);
  return `${totalFrames}/${Math.round(frameRate * 1000) / 1000}s`;
}

function getFilename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
