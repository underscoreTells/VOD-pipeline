import type {
  SettingsDecryptResult,
  SettingsEncryptResult,
  ProviderModelsListParams,
  ProviderModelsListResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  SettingsDecryptResult,
  SettingsEncryptResult,
} from '../../../shared/contracts/electron-api.js';

export async function encryptSettings(text: string): Promise<SettingsEncryptResult> {
  return await getElectronApi().settings.encrypt(text);
}

export async function decryptSettings(encrypted: string): Promise<SettingsDecryptResult> {
  return await getElectronApi().settings.decrypt(encrypted);
}

export async function listProviderModels(params: ProviderModelsListParams): Promise<ProviderModelsListResult> {
  return await getElectronApi().settings.listProviderModels(params);
}
