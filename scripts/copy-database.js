import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.join(__dirname, '..', 'database');
const targetDir = path.join(__dirname, '..', 'dist', 'database');

// Ensure target directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('Created directory:', targetDir);
}

// Copy schema.sql
const sourceFile = path.join(sourceDir, 'schema.sql');
const targetFile = path.join(targetDir, 'schema.sql');

if (fs.existsSync(sourceFile)) {
  fs.copyFileSync(sourceFile, targetFile);
  console.log('Copied database schema to:', targetFile);
} else {
  console.error('Source schema file not found:', sourceFile);
  process.exit(1);
}

console.log('Database setup complete.');
