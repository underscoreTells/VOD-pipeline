# Phase 1 Implementation Plan: Infrastructure Setup

## Overview
Infrastructure setup: TypeScript configs, Electron shell, SQLite database, Svelte 5 UI with runes, IPC communication, FFmpeg installation.

**Key Decisions**: FFmpeg postinstall download → bundled (prod) → runtime fallback; DB in userData dir; IPC returns `{success, data?, error?}` pattern.

---

## Tasks

### Task 1.1: Initialize Repository
- Run `pnpm init`
- Create folders: `src/electron/`, `src/agent/`, `src/renderer/`, `src/shared/`, `database/`, `scripts/`
- `.gitignore`: node_modules, dist, .env, build artifacts

#### Task 1.2: Configure TypeScript
- Create 4 tsconfig files:
  - `tsconfig.json` (base) - Path aliases: `@` → `src/renderer`, `$shared` → `src/shared`
  - `tsconfig.electron.json` - ES2020 target, CommonJS, includes src/electron, src/agent
  - `tsconfig.renderer.json` - ESNext, runes enabled, includes src/renderer
  - `tsconfig.node.json` - Includes config files

#### Task 1.3: Configure Vite + Svelte 5
- `vite.config.ts`: Svelte plugin with `runes: true`, root: src/renderer, output: dist/renderer, port 5173
- `svelte.config.js`: `vitePreprocess()`, compiler options with `runes: true`
- Set up aliases: `@/` and `$shared/`

#### Task 1.4: Configure Electron & FFmpeg Install Script
- `electron-builder.json`: App ID, productName, extraResources for binaries
- `scripts/install-ffmpeg.js`: Download FFmpeg to `binaries/<platform>/` (Windows/macOS/Linux detection)
- `src/electron/main.ts`: App lifecycle, window creation, FFmpeg path detection, load dev server (port 5173) or built files
- `src/electron/preload.ts`: `contextBridge.exposeInMainWorld('electronAPI', ...)` with typed API

#### Task 1.5: Database Setup
- `database/schema.sql`: Tables for projects, assets, chapters, chapter_assets, transcripts, beats, conversations + indexes on project_id, chapter_id
- `src/electron/database/db.ts`: SQLite connection via better-sqlite3, init from schema.sql, functions: `createProject()`, `getProject()`, `listProjects()`, `deleteProject()` - each returns `{success, data?, error?}`

#### Task 1.6: Svelte 5 UI - App Shell
- `src/renderer/index.html`: `<div id="app"></div>` mount point
- `src/renderer/main.ts`: `mount(App, { target: document.getElementById('app')! })`
- `src/renderer/App.svelte`: Root with projects view vs project detail view toggle
- `src/renderer/lib/components/ProjectList.svelte`: Form for create project, grid display of projects
- `src/renderer/lib/state/project.svelte.ts`: State with `$state({ items: [], selectedId: null })`, `$derived` selectedProject, functions: `loadProjects()`, `createProject()`, `selectProject()`
- `src/shared/types/index.ts`: Project interface (id, name, created_at, updated_at)

#### Task 1.7: Basic IPC Setup
- `src/electron/ipc/channels.ts`: Constants for all ops: `PROJECT_CREATE`, `PROJECT_GET_ALL`, `PROJECT_LOAD`, `ASSET_ADD`, `CHAPTER_CREATE`, `AGENT_CHAT`, `AGENT_STREAM`
- `src/electron/ipc/handlers.ts`: ipcMain handlers for PROJECT ops (stubs for assets/chapters/agent), each calls DB and returns response
- Update `src/electron/preload.ts`: Add typed `projects: { create, getAll, get }` to electronAPI
- `src/renderer/lib/state/electron.svelte.ts`: Wrapper functions with error handling and type parsing
- Update `project.svelte.ts`: Use wrapper functions instead of direct window.electronAPI calls

---

### Completion Milestones

- **1.1**: pnpm init successful, directories created, .gitignore configured
- **1.2**: 4 tsconfig files created, path aliases working, no TS errors
- **1.3**: vite/svelte configs created, runes enabled, Vite can start (pending entry files)
- **1.4**: Electron launches, shows window, FFmpeg detection works, preload API exposed
- **1.5**: schema.sql with all tables, db connects to SQLite, project CRUD functions tested
- **1.6**: App.svelte renders, project state loads from API, project list displays
- **1.7**: Create → IPC → DB → saved; Load → DB → render; Select → update state

---

### Dependencies

- Task 1.3: `pnpm add svelte @sveltejs/vite-plugin-svelte vite`
- Task 1.4: `pnpm add electron electron-builder`
- Task 1.5: `pnpm add better-sqlite3 @types/better-sqlite3`
- All dev: `pnpm add -D typescript svelte-check`

---

### Testing

- After each task: `pnpm typecheck`
- Milestones 1.4-1.7: `pnpm dev` and verify
- After 1.5: Unit tests for DB
- After 1.7: Integration tests for IPC
