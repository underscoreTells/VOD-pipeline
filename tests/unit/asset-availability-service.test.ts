import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findNearestExistingAncestor, getAssetAvailability } from '../../src/electron/services/asset-availability-service.js';

const tempDirectories: string[] = [];

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory && fs.existsSync(directory)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

function createTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pipeline-availability-'));
  tempDirectories.push(directory);
  return directory;
}

describe('asset availability service', () => {
  it('returns available metadata for an existing file', async () => {
    const directory = createTempDirectory();
    const filePath = path.join(directory, 'clip.mp4');
    fs.writeFileSync(filePath, 'video');

    const availability = await getAssetAvailability(filePath);

    expect(availability.exists).toBe(true);
    expect(availability.issue).toBeNull();
    expect(availability.savedPath).toBe(filePath);
    expect(availability.nearestExistingAncestor).toBeNull();
  });

  it('marks a missing file under an existing parent as missing_file', async () => {
    const directory = createTempDirectory();
    const filePath = path.join(directory, 'missing.mp4');

    const availability = await getAssetAvailability(filePath);

    expect(availability.exists).toBe(false);
    expect(availability.issue).toBe('missing_file');
    expect(availability.nearestExistingAncestor).toBe(directory);
  });

  it('marks a missing file under a missing parent chain as missing_parent', async () => {
    const directory = createTempDirectory();
    const existingParent = path.join(directory, 'mounted');
    fs.mkdirSync(existingParent);
    const filePath = path.join(existingParent, 'offline', 'nested', 'missing.mp4');

    const availability = await getAssetAvailability(filePath);

    expect(availability.exists).toBe(false);
    expect(availability.issue).toBe('missing_parent');
    expect(availability.nearestExistingAncestor).toBe(existingParent);
    expect(await findNearestExistingAncestor(filePath)).toBe(existingParent);
  });
});
