import { safeStorage } from 'electron';
import { createLogger } from '../logger.js';

const logger = createLogger('SettingsService');

const SETTINGS_SAFE_PREFIX = 'safe:';
const SETTINGS_PLAINTEXT_PREFIX = 'plain:';

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

export function encryptSettingsPayload(text: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(text).toString('base64');
    return `${SETTINGS_SAFE_PREFIX}${encrypted}`;
  }

  logger.warn('safeStorage unavailable; using local plaintext fallback for API key storage.');
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return `${SETTINGS_PLAINTEXT_PREFIX}${encoded}`;
}

export function decryptSettingsPayload(encrypted: string): string {
  if (encrypted.startsWith(SETTINGS_SAFE_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System encryption is not available to decrypt saved settings. Re-enter API keys.');
    }

    const payload = encrypted.slice(SETTINGS_SAFE_PREFIX.length);
    const buffer = Buffer.from(payload, 'base64');
    return safeStorage.decryptString(buffer);
  }

  if (encrypted.startsWith(SETTINGS_PLAINTEXT_PREFIX)) {
    const payload = encrypted.slice(SETTINGS_PLAINTEXT_PREFIX.length);
    return Buffer.from(payload, 'base64').toString('utf8');
  }

  const buffer = Buffer.from(encrypted, 'base64');
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buffer);
    } catch {
      const decoded = buffer.toString('utf8');
      if (looksLikeJson(decoded)) {
        return decoded;
      }

      throw new Error('Unable to decrypt saved settings payload. Re-enter API keys.');
    }
  }

  const decoded = buffer.toString('utf8');
  if (looksLikeJson(decoded)) {
    return decoded;
  }

  throw new Error('System encryption is not available to decrypt saved settings. Re-enter API keys.');
}
