import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceFile = path.join(__dirname, '..', 'src', 'electron', 'preload.ts');
const targetDir = path.join(__dirname, '..', 'dist', 'src', 'electron');
const targetFile = path.join(targetDir, 'preload.cjs');

if (!fs.existsSync(sourceFile)) {
  console.error('Source preload TypeScript file not found:', sourceFile);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const sourceCode = fs.readFileSync(sourceFile, 'utf8');
const transpiled = ts.transpileModule(sourceCode, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourceFile,
});

fs.writeFileSync(targetFile, transpiled.outputText, 'utf8');
console.log('Transpiled preload script to:', targetFile);
