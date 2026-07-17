import type { GPUStatusOptions, GPUStatusResult } from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  GPUStatusOptions,
  GPUStatusResult,
  GPUStatusPayload,
} from '../../../shared/contracts/electron-api.js';

export async function getGPUStatus(options?: GPUStatusOptions): Promise<GPUStatusResult> {
  return await getElectronApi().gpu.getStatus(options);
}
