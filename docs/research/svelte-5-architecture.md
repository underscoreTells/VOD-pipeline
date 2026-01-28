# Svelte 5 Architecture Research

**Date:** January 23, 2026  
**Research Focus:** State management, project structure, TypeScript integration, and Electron integration with Svelte 5

---

## 1. Svelte 5 State Management: What Replaced Stores?

### The Big Change: Runes API

Svelte 5 introduces a completely new reactivity system built on **Runes**. Runes are compiler instructions (functions starting with `$`) that control Svelte's reactivity. This is a **paradigm shift** from the previous Svelte 4 patterns.

### Key Insight: Stores Are No Longer Needed

Prior to Svelte 5, stores (`writable`, `readable`, `derived`) were the go-to solution for:
- Cross-component state sharing
- Extracting logic outside components
- Managing complex data streams

With Svelte 5's **universal reactivity**, stores are largely unnecessary for most use cases.

---

## 2. Core Runes: The New State Management API

### `$state` - Reactive State

Creates reactive state that triggers UI updates when changed.

```svelte
<script>
  // Simple primitive
  let count = $state(0);
  
  // objects and arrays are deeply reactive
  let todos = $state([
    { done: false, text: 'buy milk' }
  ]);
  
  // Class fields
  class Todo {
    done = $state(false);
    text = $state('');
  }
</script>

<button onclick={() => count++}>
  clicks: {count}
</button>
```

**Key Properties:**
- The returned value is the actual value (not an object with `.value` like React)
- Objects and arrays become **deeply reactive proxies**
- Mutating properties of reactive objects triggers reactivity: `todos[0].done = !todos[0].done`

**Variants:**
- `$state.raw()` - Non-deeply reactive state (for performance with large objects)
- `$state.snapshot(state)` - Get a non-proxied static snapshot of state
- `$state.eager(value)` - Force immediate UI update

### `$derived` - Computed State

Declares state derived from other reactive values.

```svelte
<script>
  let count = $state(0);
  
  // Simple expression
  let doubled = $derived(count * 2);
  
  // Complex derivation
  let arraySum = $derived.by(() => {
    let sum = 0;
    for (const n of numbers) {
      sum += n;
    }
    return sum;
  });
</script>
```

**Key Properties:**
- Expression must be free of side effects
- State changes inside derived are disallowed
- Dependencies are tracked at **runtime** (vs static analysis in Svelte 4's `$:`)
- Derived values are **not** converted to proxies (unless they were proxies to begin with)
- Can be **overridden by reassignment** (useful for optimistic UI)

### `$effect` - Side Effects

Runs code when state changes (replaces `$:` statements for side effects).

```svelte
<script>
  let canvas;
  let size = $state(50);
  let color = $state('#ff3e00');

  $effect(() => {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
  });
  
  // Manual cleanup
  $effect(() => {
    const interval = setInterval(() => {
      count += 1;
    }, 1000);
    
    return () => clearInterval(interval);
  });
</script>
```

**Key Properties:**
- Runs **after** DOM updates (vs `$:` which ran **before**)
- Use `$effect.pre()` to run **before** DOM updates
- Dependencies are tracked at runtime
- Only runs in browser (not during SSR)
- Can return a cleanup function
- **Tracking is synchronous** - async values (after `await`, `setTimeout`) are not tracked

**When NOT to use `$effect`:**
- Don't use for synchronizing state; use `$derived` instead
- Avoid complex dependency chains

### `$props` - Component Props

Declares component inputs.

```svelte
<script>
  import type { Component, ComponentProps } from 'svelte';
  
  // Full props object (no destructuring)
  let props = $props();
  
  // Destructured with defaults
  let { 
    required, 
    optional = 'default',
    className,
    ...rest 
  } = $props();
  
  // With TypeScript types
  interface Props {
    requiredProperty: number;
    optionalProperty?: boolean;
    eventHandler: (arg: string) => void;
    [key: string]: unknown;
  }
  
  let { requiredProperty, optionalProperty, eventHandler }: Props = $props();
  
  // Generic component typing
  interface ListProps<T> {
    items: T[];
    onSelect(item: T): void;
  }
</script>

<button {onclick} className={className} {...rest}>
  {required}
</button>
```

**Key Properties:**
- Use destructuring for clean prop access
- Renaming with JS destructuring: `let { class: klass } = $props()`
- Rest props with `[...rest]` pattern
- **Props are references** that update when parent updates
- **Avoid mutating props directly** - use callback props or `$bindable`

### Other Runes

- **`$bindable`** - Creates two-way bindings for props
- **`$inspect`** - Development tool for debugging reactivity
- **`$host`** - For custom elements
- **`$props.id()`** - Generates unique component IDs

---

## 3. Sharing State Without Stores: The New Patterns

### Pattern 1: `.svelte.ts` / `.svelte.js` Files

**This is the most important new pattern for cross-component state.**

These files behave like any other module but allow using runes. This completely replaces the need for stores in most cases.

```typescript
// store/user.svelte.ts
export const userState = $state({
  name: '',
  email: '',
  preferences: {
    theme: 'dark',
    notifications: true
  }
});

export const derivedState = $derived(() => ({
  displayName: userState.name || 'Guest',
  isDarkMode: userState.preferences.theme === 'dark'
}));

// Helper functions (not exported reassignments)
export function updateUser(name: string) {
  userState.name = name;
}

export function toggleNotifications() {
  userState.preferences.notifications = !userState.preferences.notifications;
}
```

```svelte
<!-- ComponentA.svelte -->
<script>
  import { userState, updateUser } from '$lib/store/user.svelte';
</script>

<input 
  bind:value={userState.name} 
  oninput={() => updateUser(userState.name)} 
/>
<p>Hello, {userState.name}!</p>
```

```svelte
<!-- ComponentB.svelte -->
<script>
  import { derivedState } from '$lib/store/user.svelte';
</script>

<p>Display: {derivedState().displayName}</p>
```

**Important constraint:** You cannot export **reassigned** state directly.
```typescript
// ❌ This will NOT work
export let counter = $state(0);

// ✅ This works - access via object property
export const counterState = $state({ count: 0 });
```

### Pattern 2: Context API with Reactive State

```svelte
<!-- Parent.svelte -->
<script>
  import { setContext } from 'svelte';
  import Child from './Child.svelte';

  let counter = $state({ count: 0 });

  setContext('counter', counter);
</script>

<button onclick={() => counter.count += 1}>
  increment
</button>
<Child />
```

```svelte
<!-- Child.svelte -->
<script>
  import { getContext } from 'svelte';
  
  const counter = getContext<{ count: number }>('counter');
</script>

<p>Count: {counter.count}</p>
```

**Type-safe context (Svelte 5.40+):**
```typescript
import { createContext } from 'svelte';

export const [getCounter, setCounter] = 
  createContext<{ count: number }>();
```

### Pattern 3: Store API (Still Available)

Stores exist but are **only recommended** for:
- Complex asynchronous data streams
- When you need manual control over subscriptions
- When migrating from Svelte 4
- When working with RxJS

```typescript
import { writable, derived, readable } from 'svelte/store';

// Writable
const count = writable(0);
count.set(1);
count.update(n => n + 1);

// Derived
const doubled = derived(count, $count => $count * 2);

// Use with $ syntax
<script>
  import { count } from './store';
</script>
<p>{$count}</p>
```

---

## 4. Project Structure Recommendations for Svelte 5

### Recommended Folder Structure

```
my-svelte-app/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── ui/           # Reusable UI components
│   │   │   │   ├── Button.svelte
│   │   │   │   ├── Input.svelte
│   │   │   │   └── index.ts  # Barrel exports
│   │   │   └── layout/       # Layout components
│   │   │       ├── Header.svelte
│   │   │       └── Sidebar.svelte
│   │   ├── stores/           # State modules (.svelte.ts files)
│   │   │   ├── user.svelte.ts
│   │   │   ├── ui.svelte.ts
│   │   │   └── data.svelte.ts
│   │   ├── services/         # API calls, business logic
│   │   │   ├── api.ts
│   │   │   └── auth.ts
│   │   ├── utils/            # Pure functions and helpers
│   │   │   ├── date.ts
│   │   │   └── validation.ts
│   │   ├── types/            # TypeScript type definitions
│   │   │   ├── api.ts
│   │   │   ├── models.ts
│   │   │   └── index.ts
│   │   ├── composables/      # Reusable reactive logic (.svelte.ts)
│   │   │   ├── useCounter.svelte.ts
│   │   │   └── useLocalStorage.svelte.ts
│   │   └── index.ts          # Barrel exports
│   ├── routes/               # (if using SvelteKit)
│   │   └── ...
│   ├── App.svelte           # Root component
│   ├── main.ts              # Entry point
│   └── app.css              # Global styles
├── public/                  # Static assets
├── tests/                   # Test files
├── svelte.config.js         # Svelte configuration
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
└── package.json
```

### Type Definitions

Use a dedicated `types/` directory for complex types:

```typescript
// src/lib/types/models.ts
export interface User {
  id: string;
  name: string;
  email: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  notifications: boolean;
}

// src/lib/types/api.ts
export interface ApiResponse<T> {
  data: T;
  error?: string;
  meta?: {
    total: number;
    page: number;
    perPage: number;
  };
}

// src/lib/types/events.ts
export interface ComponentEvents {
  update: CustomEvent<{ value: string }>;
  delete: CustomEvent<{ id: string }>;
}
```

### Barrel Exports

Clean up imports with barrel exports:

```typescript
// src/lib/components/ui/index.ts
export { default as Button } from './Button.svelte';
export { default as Input } from './Input.svelte';
export { default as Modal } from './Modal.svelte';

// Usage in components
<script>
  import { Button, Input } from '$lib/components/ui';
</script>
```

---

## 5. TypeScript + Svelte 5 Configuration

### Basic Setup

**Install dependencies:**
```bash
npm install -D svelte @sveltejs/vite-plugin-svelte typescript
```

**svelte.config.js:**
```javascript
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,        // Enable Svelte 5 runes mode
    dev: !process.env.PROD,
  }
};
```

**vite.config.ts:**
```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      $lib: resolve(__dirname, './src/lib'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowJs": true,
    "checkJs": false,
    "paths": {
      "@/*": ["./src/*"],
      "$lib/*": ["./src/lib/*"]
    }
  },
  "include": ["src/**/*.d.ts", "src/**/*.ts", "src/**/*.js", "src/**/*.svelte"],
  "references": [
    { "path": "./tsconfig.node.json" }
  ]
}
```

**tsconfig.node.json:**
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts", "svelte.config.js"]
}
```

### TypeScript in Components

```svelte
<script lang="ts" generics="T extends Record<string, any>">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props {
    items: T[];
    onSelect: (item: T) => void;
    optional?: boolean;
    snippet: Snippet<[string]>;
  }

  let { items, onSelect, optional = false, snippet }: Props = $props();
  
  let selected = $state<T | null>(null);
</script>

<button onclick={() => items.forEach(onSelect)}>
  {@render snippet('world')}
</button>
```

### Working with Generics

```svelte
<script lang="ts" generics="T extends { id: string; name: string }">
  interface ListProps {
    items: T[];
    onSelect(item: T): void;
  }

  let { items, onSelect }: ListProps = $props();
</script>

<ul>
  {#each items as item}
    <li onclick={() => onSelect(item)}>{item.name}</li>
  {/each}
</ul>
```

---

## 6. Svelte 5 + Electron Integration

### Architecture Overview

Electron apps have two main processes:

1. **Main Process** - Node.js environment, controls app lifecycle and native APIs
2. **Renderer Process** - Web environment, runs the Svelte UI

### Recommended Project Structure

```
electron-svelte-app/
├── src/
│   ├── main/
│   │   ├── index.ts           # Main process entry
│   │   ├── ipc/
│   │   │   ├── handlers.ts    # IPC message handlers
│   │   │   └── channels.ts    # Channel definitions
│   │   └── preload/
│   │       └── index.ts       # Preload script
│   ├── renderer/
│   │   ├── App.svelte         # Root Svelte component
│   │   ├── main.ts            # Renderer entry
│   │   ├── lib/
│   │   │   ├── components/
│   │   │   ├── stores/        # .svelte.ts files
│   │   │   └── utils/
│   │   └── styles/
│   └── shared/
│       ├── types/            # Shared TypeScript types
│       └── constants/        # Shared constants
├── dist/
│   ├── main/                  # Main process output
│   └── renderer/              # Renderer process output
├── public/                    # Static assets for renderer
├── vite.config.ts             # Vite config for renderer
├── tsconfig.json
├── tsconfig.main.json         # Main process tsconfig
├── tsconfig.renderer.json     # Renderer process tsconfig
├── package.json
└── Electron config files...
```

### Main Process Setup

**src/main/index.ts:**
```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,        // Always enabled by default
      nodeIntegration: false,        // Always disabled for security
    },
  });

  // In development, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
import { registerIpcHandlers } from './ipc/handlers';
registerIpcHandlers();
```

**src/main/ipc/channels.ts:**
```typescript
// Define all IPC channels in one place for type safety
export const IPC_CHANNELS = {
  GET_PROJECTS: 'get-projects',
  SAVE_PROJECT: 'save-project',
  DELETE_PROJECT: 'delete-project',
  OPEN_FILE: 'open-file',
  SAVE_FILE: 'save-file',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
```

**src/main/ipc/handlers.ts:**
```typescript
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels';
import * as fs from 'fs/promises';
import * as path from 'path';

// Shared types
export interface ProjectData {
  id: string;
  name: string;
  filePath: string;
  updatedAt: Date;
}

export function registerIpcHandlers() {
  // Get all projects
  ipcMain.handle(IPC_CHANNELS.GET_PROJECTS, async () => {
    try {
      // Your logic to fetch projects
      const projects = await getProjectsFromDisk();
      return { success: true, data: projects };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Save project
  ipcMain.handle(IPC_CHANNELS.SAVE_PROJECT, async (_, project: ProjectData) => {
    try {
      await saveProjectToDisk(project);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Open file dialog
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE, async () => {
    const { dialog } = require('electron');
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });
    return filePaths;
  });
}

async function getProjectsFromDisk(): Promise<ProjectData[]> {
  // Implementation
  return [];
}

async function saveProjectToDisk(project: ProjectData): Promise<void> {
  // Implementation
}
```

### Preload Script Setup

**src/main/preload/index.ts:**
```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../ipc/channels';
import type { ProjectData } from '../ipc/handlers';

export type ElectronAPI = {
  projects: {
    getAll: () => Promise<{ success: boolean; data?: ProjectData[]; error?: string }>;
    save: (project: ProjectData) => Promise<{ success: boolean; error?: string }>;
  };
  files: {
    open: () => Promise<string[]>;
  };
};

const electronAPI: ElectronAPI = {
  projects: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROJECTS),
    save: (project) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_PROJECT, project),
  },
  files: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

### Renderer Process Setup

**Vite configuration for Electron:**
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  
  return {
    plugins: [svelte()],
    root: 'src/renderer',
    base: './',
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        $shared: resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
```

**Entry point for renderer:**
```typescript
// src/renderer/main.ts
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app'),
});

export default app;
```

**HTML entry:**
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>VOD Pipeline</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

### Using Svelte 5 State with Electron

**Create a reactive store for Electron API in .svelte.ts:**
```typescript
// src/renderer/stores/projects.svelte.ts
import type { ProjectData } from '$shared/types';

export const projects = $state({
  items: [] as ProjectData[],
  loading: false,
  error: null as string | null,
  selectedId: null as string | null,
});

// Derived state
export const selectedProject = $derived(() => 
  projects.items.find(p => p.id === projects.selectedId) || null
);

export async function loadProjects() {
  projects.loading = true;
  projects.error = null;
  
  try {
    const result = await window.electronAPI.projects.getAll();
    if (result.success && result.data) {
      projects.items = result.data;
    } else {
      projects.error = result.error || 'Failed to load projects';
    }
  } catch (error) {
    projects.error = (error as Error).message;
  } finally {
    projects.loading = false;
  }
}

export async function saveProject(project: ProjectData) {
  const result = await window.electronAPI.projects.save(project);
  if (result.success) {
    // Update local state optimistically
    const index = projects.items.findIndex(p => p.id === project.id);
    if (index >= 0) {
      projects.items[index] = project;
    } else {
      projects.items = [...projects.items, project];
    }
  } else {
    throw new Error(result.error);
  }
}

export function selectProject(id: string | null) {
  projects.selectedId = id;
}
```

**Use in a component:**
```svelte
<script>
  import { projects, selectedProject, loadProjects } from '$lib/stores/projects.svelte';

  // Load projects on mount
  $effect(() => {
    loadProjects();
  });
</script>

{#if projects.loading}
  <p>Loading projects...</p>
{:else if projects.error}
  <p class="error">{projects.error}</p>
{:else}
  <ul>
    {#each projects.items as project (project.id)}
      <li 
        class:active={project.id === projects.selectedId}
        onclick={() => selectProject(project.id)}
      >
        {project.name}
      </li>
    {/each}
  </ul>
  
  {#if selectedProject}
    <div class="project-details">
      <h2>{selectedProject.name}</h2>
      <p>Last updated: {selectedProject.updatedAt}</p>
    </div>
  {/if}
{/if}

<style>
  .active { background: #007bff; color: white; }
  .error { color: #dc3545; }
</style>
```

### TypeScript Declarations for Electron API

**src/types/electron.d.ts:**
```typescript
import type { ProjectData } from './api';

export interface ElectronAPI {
  projects: {
    getAll: () => Promise<{
      success: boolean;
      data?: ProjectData[];
      error?: string;
    }>;
    save: (project: ProjectData) => Promise<{
      success: boolean;
      error?: string;
    }>;
    delete: (id: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
  files: {
    open: () => Promise<string[]>;
    save: (content: string) => Promise<string | null>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

### Package.json Configuration

```json
{
  "name": "electron-svelte-app",
  "version": "1.0.0",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "concurrently \"npm run dev:renderer\" \"npm run dev:main\"",
    "dev:renderer": "vite",
    "dev:main": "tsc -w -p tsconfig.main.json && electron dist/main/index.js",
    "build": "npm run build:renderer && npm run build:main",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    "lint": "eslint . --ext .ts,.svelte",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json"
  },
  "dependencies": {
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "concurrently": "^8.2.2",
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

---

## 7. Key Migration Patterns from Svelte 4

### Component Properties

**Svelte 4:**
```svelte
<script>
  export let name = 'world';
  export let age;
</script>
```

**Svelte 5:**
```svelte
<script>
  let { name = 'world', age } = $props();
</script>
```

### Reactive Statements

**Svelte 4:**
```svelte
<script>
  let count = 0;
  $: doubled = count * 2;
  $: console.log('Count:', count);
</script>
```

**Svelte 5:**
```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
  $effect(() => console.log('Count:', count));
</script>
```

### Events

**Svelte 4:**
```svelte
<button on:click={handler}>Click</button>
<Child on:save={onSave} />
```

**Svelte 5:**
```svelte
<button onclick={handler}>Click</button>
<Child save={onSave} />
```

### Component Instantiation

**Svelte 4:**
```ts
const app = new App({
  target: document.getElementById('app'),
  props: { foo: 'bar' }
});
```

**Svelte 5:**
```ts
import { mount } from 'svelte';
const app = mount(App, {
  target: document.getElementById('app'),
  props: { foo: 'bar' }
});
```

---

## 8. Practical Examples

### Example 1: Todo List with Cross-Component State

**stores/todo.svelte.ts:**
```typescript
export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: Date;
}

export const todoState = $state({
  todos: [] as Todo[],
  filter: 'all' as 'all' | 'active' | 'completed',
});

export const filteredTodos = $derived(() => {
  switch (todoState.filter) {
    case 'active':
      return todoState.todos.filter(t => !t.done);
    case 'completed':
      return todoState.todos.filter(t => t.done);
    default:
      return todoState.todos;
  }
});

export const remainingCount = $derived(
  todoState.todos.filter(t => !t.done).length
);

export function addTodo(text: string) {
  const todo: Todo = {
    id: crypto.randomUUID(),
    text,
    done: false,
    createdAt: new Date(),
  };
  todoState.todos = [...todoState.todos, todo];
}

export function toggleTodo(id: string) {
  const todo = todoState.todos.find(t => t.id === id);
  if (todo) {
    todo.done = !todo.done;
  }
}

export function deleteTodo(id: string) {
  todoState.todos = todoState.todos.filter(t => t.id !== id);
}

export function setFilter(filter: typeof todoState.filter) {
  todoState.filter = filter;
}

export function clearCompleted() {
  todoState.todos = todoState.todos.filter(t => !t.done);
}
```

**components/TodoInput.svelte:**
```svelte
<script>
  import { addTodo, todoState } from '$lib/stores/todo.svelte';

  let inputEl: HTMLInputElement;
  let text = $state('');
  
  $effect(() => {
    if (todoState.todos.length > 0) {
      inputEl?.focus();
    }
  });

  function handleSubmit() {
    if (text.trim()) {
      addTodo(text.trim());
      text = '';
    }
  }
</script>

<form onsubmit|preventDefault={handleSubmit}>
  <input 
    bind:this={inputEl}
    bind:value={text} 
    placeholder="What needs to be done?"
  />
  <button type="submit" disabled={!text.trim()}>Add</button>
</form>
```

**components/TodoList.svelte:**
```svelte
<script>
  import { filteredTodos, toggleTodo, deleteTodo } from '$lib/stores/todo.svelte';
</script>

<ul>
  {#each filteredTodos as todo (todo.id)}
    <li class:completed={todo.done}>
      <input 
        type="checkbox" 
        checked={todo.done} 
        onclick={() => toggleTodo(todo.id)} 
      />
      <span>{todo.text}</span>
      <button onclick={() => deleteTodo(todo.id)}>×</button>
    </li>
  {/each}
</ul>

<style>
  .completed span {
    text-decoration: line-through;
    opacity: 0.5;
  }
</style>
```

**components/TodoFilter.svelte:**
```svelte
<script>
  import { todoState, setFilter, remainingCount, clearCompleted } from '$lib/stores/todo.svelte';
</script>

<div class="filters">
  <button class:active={todoState.filter === 'all'} onclick={() => setFilter('all')}>
    All
  </button>
  <button class:active={todoState.filter === 'active'} onclick={() => setFilter('active')}>
    Active ({remainingCount})
  </button>
  <button class:active={todoState.filter === 'completed'} onclick={() => setFilter('completed')}>
    Completed
  </button>
  <button onclick={clearCompleted}>Clear completed</button>
</div>

<style>
  .filters { display: flex; gap: 0.5rem; }
  .active { font-weight: bold; }
</style>
```

**App.svelte:**
```svelte
<script>
  import TodoInput from './components/TodoInput.svelte';
  import TodoList from './components/TodoList.svelte';
  import TodoFilter from './components/TodoFilter.svelte';
</script>

<div class="app">
  <h1>Todo</h1>
  <TodoInput />
  <TodoList />
  <TodoFilter />
</div>

<style>
  .app {
    max-width: 500px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui;
  }
</style>
```

### Example 2: Composable Hook Pattern (.svelte.ts)

**composables/useLocalStorage.svelte.ts:**
```typescript
export function useLocalStorage<T>(key: string, initialValue: T) {
  // Load from localStorage
  const saved = localStorage.getItem(key);
  let value = $state<T>(saved ? JSON.parse(saved) : initialValue);
  
  $effect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  });
  
  return {
    get value() { return value; },
    set value(v: T) { value = v; }
  };
}
```

**Usage:**
```svelte
<script>
  import { useLocalStorage } from '$lib/composables/useLocalStorage.svelte.ts';

  interface Settings {
    theme: 'light' | 'dark';
    fontSize: number;
    notifications: boolean;
  }

  const settings = useLocalStorage<Settings>('settings', {
    theme: 'light',
    fontSize: 16,
    notifications: true,
  });

  // Access
  console.log(settings.value.theme);

  // Update
  settings.value.theme = 'dark';
</script>

<select bind:value={settings.value.theme}>
  <option value="light">Light</option>
  <option value="dark">Dark</option>
</select>
```

### Example 3: Data Fetching with Loading/Error States

**composables/useFetch.svelte.ts:**
```typescript
export function useFetch<T>(url: () => string) {
  const data = $state<T | null>(null);
  const loading = $state(true);
  const error = $state<string | null>(null);

  async function fetch() {
    loading = true;
    error = null;
    
    try {
      const res = await fetch(url());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetch();
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    refetch: fetch,
  };
}
```

---

## 9. Best Practices and Gotchas

### DO

- Use `.svelte.ts` files for shared reactive state
- Use `$derived` for computed values instead of side effects
- Use `$effect` sparingly - prefer `$derived` for most use cases
- Use destructuring with `$props` for cleaner prop access
- Use TypeScript for type safety
- Use context for deep component trees
- Use `$state.raw()` for performance with large immutable objects

### DON'T

- Don't mutate props directly (use callbacks or `$bindable`)
- Don't run side effects inside `$derived`
- Don't use `$:` statements (migrate to runes)
- Don't export reassigned `$state` directly
- Don't use `on:click` - use `onclick`
- Don't use `export let` - use `$props()`
- Don't use `<slot>` for children - use snippets:**

```typescript
// ❌ This won't work
export let counter = $state(0);

// ❌ This also won't work
const counter = $state(0);
export { counter };

// ✅ Correct way - export object, not reassignment
export const counterState = $state({ count: 0 });
```

---

## 10. Resources and Further Reading

### Official Documentation
- [Svelte 5 Docs](https://svelte.dev/docs)
- [Svelte 5 Migration Guide](https://svelte.dev/docs/svelte/v5-migration-guide)
- [What are Runes?](https://svelte.dev/docs/svelte/what-are-runes)
- [Svelte TypeScript Docs](https://svelte.dev/docs/svelte/typescript)
- [.svelte.js/.svelte.ts Files](https://svelte.dev/docs/svelte/svelte-js-files)

### Related Tools
- [Vite Plugin Svelte](https://github.com/sveltejs/vite-plugin-svelte)
- [Svelte Check](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check)
- [Electron Docs](https://www.electronjs.org/docs)

### Key Takeaways

1. **Runes replace stores** for most cross-component state scenarios
2. **`.svelte.ts` files are the new pattern** for shared reactive logic
3. **Universal reactivity** means you can use `$state` anywhere, not just in components
4. **TypeScript integration** is first-class and highly recommended
5. **Context API** is still useful for deeply nested component trees
6. **Stores still exist** but are reserved for specific use cases (async streams, RxJS)

---

*This research document was compiled on January 23, 2026, based on the latest Svelte 5 official documentation and best practices.*
