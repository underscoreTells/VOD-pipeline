# Phase 1 Implementation Plan: Infrastructure Setup

## Overview

Phase 1 sets up the foundational infrastructure: package manager initialization, TypeScript configuration, Svelte 5 + Vite setup, Electron shell, SQLite database, UI scaffold, and IPC communication bridge.

## Decisions Made

### FFmpeg Approach
Postinstall download + runtime fallback:
- Development: Downloads to `binaries/` folder during `pnpm install`
- Production: Bundles binaries via electron-builder `extraResources`
- Fallback: Runtime download to userData directory if bundled binary is missing

### Database Location
Electron userData directory (`app.getPath('userData')`) - standard for Electron apps across all platforms.

### Development Tools
DevTools auto-open in development mode - can be closed when not needed.

### Error Handling Pattern
Return `{ success: boolean, data?, error? }` pattern in IPC responses.

---

## Tasks Breakdown

### Task 1.1: Initialize Repository
**Actions:**
1. Initialize pnpm project: `pnpm init`
2. Create folder structure:
   - `src/electron/` - Main process (window, DB, IPC, FFmpeg orchestration)
   - `src/agent/` - Agent child process (LangChain + LangGraph)
   - `src/renderer/` - Svelte 5 UI (chat, timeline, projects)
   - `src/shared/` - Shared types/constants across processes
   - `database/` - SQLite schema file (at project root, per requirements)
   - `scripts/` - Build/install scripts
3. Create `.gitignore` (node_modules, dist, .env, build artifacts)

**Expected Outcome:** Project structure created, ready for configuration files.

---

### Task 1.2: Configure TypeScript
**Actions:**
Create 4 tsconfig files:

1. **tsconfig.json (base)** - Shared settings, path aliases (`@` → `src/renderer`, `$shared` → `src/shared`)
2. **tsconfig.electron.json** - Main + agent processes (CommonJS, ES2020 target)
3. **tsconfig.renderer.json** - Svelte 5 renderer (ESNext, ESNext module, runes enabled)
4. **tsconfig.node.json** - Config files (vite.config.ts, svelte.config.js, electron-builder.json)

**Research References:** docs/research/svelte-5-architecture.md (TypeScript + Svelte 5 configuration)

**Expected Outcome:** All TypeScript processes configured with appropriate targets and path resolution.

---

### Task 1.3: Configure Vite + Svelte 5
**Actions:**
1. Create `vite.config.ts`:
   - Plugin: `@sveltejs/vite-plugin-svelte` with `runes: true`
   - Root: `src/renderer`, Output: `dist/renderer`, Base: `./`
   - Aliases: `@/` → `src/renderer`, `$shared/` → `src/shared`
   - Server: port 5173, strictPort
2. Create `svelte.config.js`:
   - Preprocessor: `vitePreprocess()`
   - Compiler options: `runes: true`

**Research References:** docs/research/svelte-5-architecture.md (Vite + Svelte 5 setup, line 430-504)

**Expected Outcome:** Vite development server configured for Svelte 5 with runes.

---

### Task 1.4: Configure Electron & FFmpeg Install Script
**Actions:**
1. Create `electron-builder.json`:
   - App ID, icon, platform-specific output targets
   - `extraResources` for FFmpeg binaries
   - `asarUnpack` configuration
2. Create `scripts/install-ffmpeg.js`:
   - Platform detection (Windows/macOS/Linux)
   - Download FFmpeg binary from official sources
   - Extract to `binaries/<platform>/` directory
   - Verify installation
3. Create `src/electron/main.ts`:
   - Electron app lifecycle (app.whenReady, window creation)
   - Load dev server or built files
   - FFmpeg path detection on startup
   - IPC handler registration
   - Agent worker process spawning with auto-restart (stub for Phase 2)
4. Create `src/electron/preload.ts`:
   - `contextBridge.exposeInMainWorld()` for API exposure
   - Define ElectronAPI types

**Research References:**
- docs/research/ffmpeg-electron-install.md (complete install script implementation)
- docs/research/svelte-5-architecture.md (Electron + Svelte 5 integration, line 551-980)

**Expected Outcome:** Electron shell can launch window, detect FFmpeg, and expose IPC to renderer.

---

### Task 1.5: Database Setup
**Actions:**
1. Create `database/schema.sql`:
   - Tables: `projects`, `assets`, `chapters`, `chapter_assets`, `transcripts`, `beats`, `conversations`
   - Indexes on `project_id`, `chapter_id`
   - (Note: Will add additional tables later in Phase 3b for timeline/editor features)
2. Create `src/electron/database/db.ts`:
   - SQLite connection using `better-sqlite3`
   - Database initialization (create tables if not exist from schema.sql)
   - CRUD functions:
     - `createProject(name)`
     - `getProject(id)`
     - `listProjects()`
     - `deleteProject(id)`
     - (Additional CRUD for assets/chapters/transcripts comes in Phase 3)

**Research References:** PLAN.md (database schema, lines 88-174)

**Expected Outcome:** SQLite database operational with basic project CRUD.

---

### Task 1.6: Svelte 5 UI - App Shell
**Actions:**
1. Create `src/renderer/index.html`:
   - HTML entry with `<div id="app"></div>` mount point
2. Create `src/renderer/main.ts`:
   - Svelte 5 `mount()` API (not `new App()`)
   - Mount to `#app` element
3. Create `src/renderer/App.svelte`:
   - Root component with:
     - Projects view (grid of project thumbnails - placeholder for now)
     - Project detail view (sidebar + main content workspace - placeholder for now)
   - Structure using Svelte 5 runes (`$state`, `$props`)
4. Create `src/renderer/lib/state/project.svelte.ts`:
   - `projects = $state({ items: [], selectedId: null })`
   - `selectedProject = $derived(() => ...)`
   - Functions: `loadProjects()`, `createProject(name)`, `selectProject(id)`
   - Load projects from Electron API on init

**Research References:** docs/research/svelte-5-architecture.md (runes API, .svelte.ts state files, line 189-323)

**Expected Outcome:** Basic UI shell loads with project list (even if empty initially).

---

### Task 1.7: Basic IPC Setup
**Actions:**
1. Create `src/electron/ipc/channels.ts`:
   - Channel constants for all IPC ops:
     - `PROJECT_CREATE`, `PROJECT_GET_ALL`, `PROJECT_LOAD`
     - `ASSET_ADD`, `CHAPTER_CREATE` (placeholders for Phase 3)
     - `AGENT_CHAT`, `AGENT_STREAM` (placeholders for Phase 2)

2. Create `src/electron/ipc/handlers.ts`:
   - `PROJECT_CREATE`: Invoke DB `createProject()`, return result
   - `PROJECT_GET_ALL`: Invoke DB `listProjects()`, return list
   - `PROJECT_LOAD`: Invoke DB `getProject()`, return project
   - (Asset/chapter handlers stubbed for Phase 3)
   - (Agent handlers stubbed for Phase 2)

3. Update `src/electron/preload.ts`:
   - Expose typed ElectronAPI:
     ```typescript
     electronAPI: {
       projects: { create(), getAll(), get(id) }
       // more in later phases
     }
     ```

4. Create `src/renderer/lib/state/electron.svelte.ts`:
   - Wrapper functions calling `window.electronAPI.*`
   - Error handling and return value parsing
   - All functions return typed responses

**Research References:** docs/research/svelte-5-architecture.md (Electron IPC patterns, line 634-743)

**Expected Outcome:** Renderer can successfully call IPC to main process and receive responses.

---

## Completion Milestones

### Milestone 1.1: Package & Folder Structure (End of Task 1.1)
- pnpm init successful
- All directories created
- .gitignore configured

### Milestone 1.2: TypeScript Ready (End of Task 1.2)
- 4 tsconfig files created
- Path aliases working
- No TypeScript errors in config files

### Milestone 1.3: Vite + Svelte 5 Ready (End of Task 1.3)
- vite.config.ts created
- svelte.config.js created
- Runes enabled
- Vite dev server can start (pending Task 1.6 for entry files)

### Milestone 1.4: Electron Shell Running (End of Task 1.4)
- electron-builder.json configured
- FFmpeg install script created and tested
- Electron app launches, shows window
- FFmpeg path detection works
- Preload script exposes API (even if empty)

### Milestone 1.5: Database Operational (End of Task 1.5)
- schema.sql created with all tables
- db.ts connects to SQLite
- Basic project CRUD functions tested

### Milestone 1.6: UI Rendering (End of Task 1.6)
- App.svelte renders in Electron window
- Project state loads from Electron API
- Project list displays (even if empty)

### Milestone 1.7: End-to-End IPC Working (End of Project Phase 1)
- Create project from UI → IPC → DB → saved
- Load projects from DB → IPC → render in UI
- Select project in UI → update selected state
- **Result:** Working Electron + Svelte 5 app with project management

---

## Dependencies by Phase

**Task 1.3 requires:** `pnpm add svelte @sveltejs/vite-plugin-svelte vite`
**Task 1.4 requires:** `pnpm add electron electron-builder`
**Task 1.5 requires:** `pnpm add better-sqlite3 @types/better-sqlite3`

**All devDependencies:** `pnpm add -D typescript svelte-check`

---

## Testing Strategy

After each task is complete:
1. Run `pnpm typecheck` to verify TypeScript
2. For milestones 1.4-1.7: Run `pnpm dev` and verify functionality
3. Write unit tests for DB functions (after Task 1.5)
4. Write integration tests for IPC handlers (after Task 1.7)

---

## Research References

- **docs/research/svelte-5-architecture.md** - Svelte 5 runes, TypeScript config, Electron + Svelte integration
- **docs/research/ffmpeg-electron-install.md** - FFmpeg binary installation script
- **PLAN.md** - Overall project architecture and database schema
- **docs/phase-1-3-plan.md** - Detailed tasks for phases 1-3
