import type { GPUStatusResult } from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type { GPUStatusResult, GPUStatusPayload } from '../../../shared/contracts/electron-api.js';

export async function getGPUStatus(): Promise<GPUStatusResult> {
  return await getElectronApi().gpu.getStatus();
}
