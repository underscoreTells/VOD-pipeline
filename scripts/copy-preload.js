import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceFile = path.join(__dirname, '..', 'src', 'electron', 'preload.cjs');
const targetDir = path.join(__dirname, '..', 'dist', 'src', 'electron');
const targetFile = path.join(targetDir, 'preload.cjs');

if (!fs.existsSync(sourceFile)) {
  console.error('Source preload file not found:', sourceFile);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.copyFileSync(sourceFile, targetFile);
console.log('Copied preload script to:', targetFile);
