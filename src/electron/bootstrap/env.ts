import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createLogger } from '../logger.js';

const logger = createLogger('Env');

export function loadEnvironment(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    logger.debug('No .env file found at', envPath);
    return;
  }

  const result = dotenv.config({ path: envPath });
  if (result.error) {
    logger.error('Failed to load .env file:', result.error);
    return;
  }

  logger.debug('Loaded environment from', envPath);
}
