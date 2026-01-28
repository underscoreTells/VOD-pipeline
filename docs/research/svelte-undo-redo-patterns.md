# Svelte 5 Undo/Redo Patterns Research

## Overview

This document researches undo/redo patterns specifically for Svelte 5 with the runes API ($state, $derived, $effect). These patterns are particularly relevant for the VOD Pipeline timeline editor, which requires robust state management for clip manipulation, beat extraction, and narrative analysis.

## Table of Contents

1. [Svelte 5-Specific Undo/Redo](#svelte-5-specific-undoredo)
2. [Command Pattern Implementation](#command-pattern-implementation)
3. [State Snapshot Approach](#state-snapshot-approach)
4. [Integration with Components](#integration-with-components)
5. [Timeline-Specific Considerations](#timeline-specific-considerations)
6. [Existing Libraries](#existing-libraries)
7. [Best Practices](#best-practices)

---

## Svelte 5-Specific Undo/Redo

### Key Svelte 5 Runes for Undo/Redo

#### `$state` - Reactive State
The foundation of Svelte 5 reactivity. Creates deeply reactive proxies for objects/arrays.

```typescript
// Basic state declaration
let count = $state(0);
let todos = $state([
  { done: false, text: 'add more todos' }
]);

// Nested objects are fully reactive
let timeline = $state({
  clips: [
    { id: 1, in: 0, out: 30, order: 0 }
  ],
  duration: 30
});
```

**Key characteristics:**
- Objects/arrays are wrapped in proxies for granular reactivity
- Changes at any depth trigger UI updates
- Proxy overhead is minimal due to fine-grained signals

#### `$state.snapshot` - State Snapshotting
**Crucial for undo/redo** - Converts reactive proxies back to plain objects for history storage.

```typescript
let state = $state({ count: 0 });

// Save snapshot (removes proxy wrapper)
const snapshot1 = $state.snapshot(state);
console.log(snapshot1); // { count: 0 } (plain object)

state.count = 100;
const snapshot2 = $state.snapshot(state);
console.log(snapshot2); // { count: 100 }

// Can use with structuredClone for deep copies
const deepCopy = structuredClone($state.snapshot(state));
```

**Why it matters for undo/redo:**
- Avoids storing proxies (which maintain internal state)
- Reduces memory footprint
- Enables serialization (for localStorage, database, etc.)
- Works with `structuredClone` for circular-safe deep copies

#### `$effect` - Side Effects
Perfect for history tracking when state changes occur.

```typescript
let history = $state([]);
let historyPointer = $state(-1);
let currentState = $state({ clips: [] });

$effect(() => {
  // Track changes for undo
  if (historyPointer < history.length - 1) {
    // Truncate redo branch when new changes occur
    history = history.slice(0, historyPointer + 1);
  }
  
  const snapshot = $state.snapshot(currentState);
  history.push(snapshot);
  historyPointer = history.length - 1;
  
  console.log('State saved to history:', snapshot);
});
```

**Important:** `$effect` runs after DOM updates and batches changes, making it efficient for debounced history tracking.

### Differences from Svelte 4 Stores

| Aspect | Svelte 4 Stores | Svelte 5 Runes |
|--------|-----------------|----------------|
| API | `writable`, `readable`, `derived` | `$state`, `$derived` |
| Syntax | `$count` prefix | Direct access: `count` |
| Location | Anywhere | `.svelte` files or `.svelte.ts/.svelte.js` |
| Export | Store contract required | Cannot export `$state` directly |
| State management | Manual updates | Proxy-based automatic updates |
| Snapshotting | Manual: `JSON.parse(JSON.stringify(store))` | Built-in: `$state.snapshot()` |

**Migration implications:**
```svelte
<!-- Svelte 4 -->
<script>
  import { writable } from 'svelte/store';
  
  const count = writable(0);
  
  function increment() {
    count.update(n => n + 1);
  }
</script>

<button on:click={increment}>
  {$count}
</button>

<!-- Svelte 5 -->
<script>
  let count = $state(0);
  
  function increment() {
    count += 1;
  }
</script>

<button onclick={increment}>
  {count}
</button>
```

### Example: Simple Counter with Undo/Redo

```typescript
// counter.svelte.ts
export function createCounter() {
  let count = $state(0);
  
  // History stacks
  let undoStack = $state<number[]>([]);
  let redoStack = $state<number[]>([]);
  
  // Derived state for button states
  let canUndo = $derived(undoStack.length > 0);
  let canRedo = $derived(redoStack.length > 0);
  
  function saveToHistory() {
    undoStack.push(count);
    redoStack = []; // Clear redo on new action
  }
  
  function increment() {
    saveToHistory();
    count += 1;
  }
  
  function decrement() {
    saveToHistory();
    count -= 1;
  }
  
  function undo() {
    if (!canUndo) return;
    redoStack.push(count);
    count = undoStack.pop()!;
  }
  
  function redo() {
    if (!canRedo) return;
    undoStack.push(count);
    count = redoStack.pop()!;
  }
  
  return {
    get count() { return count; },
    set count(v) { count = v; },
    increment,
    decrement,
    undo,
    redo,
    get canUndo() { return canUndo; },
    get canRedo() { return canRedo; },
    clear: () => {
      count = 0;
      undoStack = [];
      redoStack = [];
    }
  };
}
```

---

## Command Pattern Implementation

### What is the Command Pattern?

The Command pattern encapsulates a request as an object, thereby letting you parameterize clients with different requests, queue or log requests, and support undoable operations.

**Key components:**
1. **Command Interface**: Defines `execute()` and `undo()` methods
2. **Concrete Commands**: Implement the interface with specific actions
3. **Invoker**: Executes commands and manages history
4. **Client**: Creates and configures commands

### Basic Command Pattern with Svelte 5

```typescript
// types.ts
export interface Command {
  execute(): void;
  undo(): void;
  // Optional: For command coalescing
  key?: string;
}

export interface CommandHistory {
  execute(command: Command): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  clear(): void;
}
```

### State-Based Commands (Snapshot Approach)

```typescript
// command-history.svelte.ts
import type { Command, CommandHistory } from './types';

export function createCommandHistory(
  maxSize: number = 50,
  coalesce: boolean = true
): CommandHistory {
  let undoStack = $state<Command[]>([]);
  let redoStack = $state<Command[]>([]);
  
  let canUndo = $derived(undoStack.length > 0);
  let canRedo = $derived(redoStack.length > 0);
  
  function execute(command: Command): void {
    // Execute the command
    command.execute();
    
    // Command coalescing for rapid changes
    if (coalesce && command.key) {
      const lastCommand = undoStack[undoStack.length - 1];
      if (lastCommand?.key === command.key) {
        undoStack[undoStack.length - 1] = command;
        redoStack = [];
        return;
      }
    }
    
    // Add to undo stack, clear redo
    undoStack.push(command);
    redoStack = [];
    
    // Limit history size
    if (undoStack.length > maxSize) {
      undoStack.shift();
    }
  }
  
  function undo(): void {
    if (!canUndo) return;
    const command = undoStack.pop()!;
    command.undo();
    redoStack.push(command);
  }
  
  function redo(): void {
    if (!canRedo) return;
    const command = redoStack.pop()!;
    command.execute();
    undoStack.push(command);
  }
  
  function clear(): void {
    undoStack = [];
    redoStack = [];
  }
  
  return {
    execute,
    undo,
    redo,
    get canUndo() { return canUndo; },
    get canRedo() { return canRedo; },
    clear
  };
}
```

### State Snapshot Command

Useful for complex state where inverse operations are difficult:

```typescript
// state-command.svelte.ts
import type { Command } from './types';

export class StateCommand<T> implements Command {
  constructor(
    private target: () => T,
    private setter: (value: T) => void,
    private oldValue: T,
    public key?: string
  ) {}
  
  execute(): void {
    // The state was already changed when command was created
    // This is a no-op, but included for consistency
  }
  
  undo(): void {
    this.setter(this.oldValue);
  }
}

// Factory function for convenience
export function createStateCommand<T>(
  target: () => T,
  setter: (value: T) => void,
  newValue: T,
  key?: string
): StateCommand<T> {
  const oldValue = target();
  setter(newValue);
  return new StateCommand(target, setter, oldValue, key);
}

// Usage example with timeline
const history = createCommandHistory();

// Clip position change
function moveClip(clipId: number, newPosition: number) {
  history.execute(createStateCommand(
    () => timeline.clips.find(c => c.id === clipId)!.order,
    (order) => {
      timeline.clips.find(c => c.id === clipId)!.order = order;
    },
    newPosition,
    'clip-move'
  ));
}
```

### Inverse Operation Commands

More efficient for simple operations (less memory):

```typescript
// value-change-command.svelte.ts
import type { Command } from './types';

export class ValueChangeCommand implements Command {
  constructor(
    private target: () => any,
    private setter: (value: any) => void,
    private delta: number, // For numeric values
    public key?: string
  ) {}
  
  execute(): void {
    this.setter(this.target() + this.delta);
  }
  
  undo(): void {
    this.setter(this.target() - this.delta);
  }
}

// Usage
function incrementCount(history: CommandHistory) {
  history.execute(new ValueChangeCommand(
    () => count,
    (v) => count = v,
    1,
    'count-change'
  ));
}
```

### Composite Commands (Batch Operations)

Group multiple commands into a single undoable action:

```typescript
// composite-command.svelte.ts
import type { Command } from './types';

export class CompositeCommand implements Command {
  private commands: Command[] = [];
  
  add(command: Command): void {
    this.commands.push(command);
  }
  
  execute(): void {
    this.commands.forEach(cmd => cmd.execute());
  }
  
  undo(): void {
    // Undo in reverse order
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

// Usage: Delete multiple clips at once
function deleteClips(clipIds: number[], history: CommandHistory) {
  const composite = new CompositeCommand();

  for (const id of clipIds) {
    const deleteCommand = {
      execute: () => {
        const clip = timeline.clips.find(c => c.id === id);
        if (clip) {
          this.deleted = clip;
          timeline.clips = timeline.clips.filter(c => c.id !== id);
        }
      },
      undo: () => {
        if (this.deleted) {
          timeline.clips = [...timeline.clips, this.deleted];
        }
      },
      key: 'delete-clip',
      deleted: null as any
    };
    composite.add(deleteCommand);
  }

  history.execute(composite);
}
```

### Macro Commands (Repeated Operations)

For operations that need to be executed multiple times:

```typescript
// macro-command.svelte.ts
export class MacroCommand implements Command {
  constructor(
    private command: Command,
    private times: number
  ) {}
  
  execute(): void {
    for (let i = 0; i < this.times; i++) {
      this.command.execute();
    }
  }
  
  undo(): void {
    for (let i = 0; i < this.times; i++) {
      this.command.undo();
    }
  }
}
```

---

## State Snapshot Approach

### When to Use Snapshots

**Use snapshots when:**
- State is complex and inverse operations are impractical
- Memory is not a critical constraint
- You need to serialize state for persistence
- Multiple components share the same state
- State contains circular references

**Use commands when:**
- State changes are simple and predictable
- Memory efficiency is important
- Inverse operations are straightforward

### Basic Snapshot Implementation

```typescript
// snapshot-history.svelte.ts
export function createSnapshotHistory<T>(
  initialState: T,
  maxSize: number = 30
) {
  let currentState = $state<T>(initialState);
  let snapshots = $state<T[]>([$state.snapshot(initialState)]);
  let pointer = $state(0);
  
  let canUndo = $derived(pointer > 0);
  let canRedo = $derived(pointer < snapshots.length - 1);
  
  function saveState() {
    const snapshot = $state.snapshot(currentState);
    
    // Truncate redo branch
    if (pointer < snapshots.length - 1) {
      snapshots = snapshots.slice(0, pointer + 1);
    }
    
    // Push new state
    snapshots.push(snapshot);
    pointer = snapshots.length - 1;
    
    // Limit history
    if (snapshots.length > maxSize) {
      snapshots.shift();
      pointer--;
    }
  }
  
  function undo() {
    if (!canUndo) return;
    pointer--;
    currentState = $state(snapshots[pointer]);
  }
  
  function redo() {
    if (!canRedo) return;
    pointer++;
    currentState = $state(snapshots[pointer]);
  }
  
  function updateState(updater: (state: T) => T) {
    currentState = updater(currentState);
    saveState();
  }
  
  return {
    get state() { return currentState; },
    set state(v) { currentState = v; saveState(); },
    canUndo,
    canRedo,
    undo,
    redo,
    updateState,
    clear: () => {
      currentState = $state(initialState);
      snapshots = [$state.snapshot(initialState)];
      pointer = 0;
    },
    get history() { return snapshots; }
  };
}
```

### Deep Clone vs Structured Clone

#### JSON stringify/parse (Simple but limited)
```typescript
const snapshot = JSON.parse(JSON.stringify(state));
```
**Pros:**
- No dependencies
- Works with basic types

**Cons:**
- Doesn't handle circular references
- Loses function references
- Doesn't handle Date, Map, Set, RegExp, etc.
- Loses type information in TypeScript

#### structuredClone (Modern browser API)
```typescript
const snapshot = structuredClone(state);
```
**Pros:**
- Handles circular references
- Supports more types (Date, Map, Set, ArrayBuffer, etc.)
- Native browser API (no dependencies)

**Cons:**
- Slightly slower than JSON
- Doesn't handle functions or class instances

#### Third-party libraries
```typescript
import { cloneDeep } from 'lodash-es';
const snapshot = cloneDeep(state);
```
**Pros:**
- Most comprehensive
- Handles edge cases
- Better performance for large objects

**Cons:**
- Adds dependency
- Larger bundle size

**Recommendation:** Use `structuredClone` with `$state.snapshot` for most cases in modern browsers:
```typescript
const snapshot = structuredClone($state.snapshot(state));
```

### Memory-Saving Optimizations

#### Partial Snapshots
Only save changed parts of state:

```typescript
interface TimelineState {
  clips: Clip[];
  selectedClipId: number | null;
}

function createPartialSnapshotHistory() {
  let state = $state<TimelineState>({ clips: [], selectedClipId: null });
  let history = $state<{
    clips: Clip[] | null;
    selectedClipId: number | null | 'unchanged';
  }[]>([
    { clips: null, selectedClipId: 'unchanged' }
  ]);
  let pointer = $state(0);
  
  function saveSnapshot(changedKey: keyof TimelineState) {
    const current = $state.snapshot(state);
    const partial: typeof history[0] = {
      clips: changedKey === 'clips' ? current.clips : 'unchanged',
      selectedClipId: changedKey === 'selectedClipId' 
        ? current.selectedClipId 
        : 'unchanged'
    };
    
    if (pointer < history.length - 1) {
      history = history.slice(0, pointer + 1);
    }
    
    history.push(partial);
    pointer = history.length - 1;
  }
  
  function undo() {
    if (pointer <= 0) return;
    const previous = history[pointer];
    
    if (previous.clips !== 'unchanged') {
      state.clips = $state(previous.clips);
    }
    if (previous.selectedClipId !== 'unchanged') {
      state.selectedClipId = previous.selectedClipId;
    }
    
    pointer--;
  }
  
  return { state, saveSnapshot, undo, redo: /*...*/ };
}
```

#### Incremental Diffs
Store only differences (similar to git):

```typescript
type Diff = {
  path: string[];
  op: 'add' | 'remove' | 'replace';
  value?: any;
  oldValue?: any;
};

function createDiffHistory<T extends object>() {
  let state = $state<T>();
  let diffs = $state<Diff[][]>([]);
  let pointer = $state(-1);
  
  function applyDiffs(object: T, diffList: Diff[]): T {
    let result = { ...object };
    
    for (const diff of diffList) {
      // Navigate to path
      let target: any = result;
      let key = diff.path[0];
      
      for (let i = 1; i < diff.path.length; i++) {
        target = target[diff.path[i - 1]];
      }
      
      // Apply operation
      if (diff.op === 'replace') {
        target[key] = diff.value;
      }
      // ... handle other operations
    }
    
    return result as T;
  }
  
  function generateDiffs(oldState: T, newState: T): Diff[] {
    // Implementation depends on your needs
    // Could use jsondiffpatch or similar library
    return [];
  }
  
  function saveChanges(newState: T) {
    const diffList = generateDiffs(state, newState);
    
    if (diffList.length === 0) return; // No actual changes
    
    if (pointer < diffs.length - 1) {
      diffs = diffs.slice(0, pointer + 1);
    }
    
    diffs.push(diffList);
    state = $state(newState);
    pointer = diffs.length - 1;
  }
  
  // ... rest of implementation
}
```

#### Snapshot Compression
For very large state, compress snapshots:

```typescript
import { compress, decompress } from 'lz-string';

function createCompressedHistory<T>(initialState: T) {
  let state = $state<T>(initialState);
  let compressedHistory = $state<string[]>([
    compress(JSON.stringify(initialState))
  ]);
  let pointer = $state(0);
  
  function saveState() {
    const json = JSON.stringify($state.snapshot(state));
    const compressed = compress(json);
    
    compressedHistory.push(compressed);
    pointer = compressedHistory.length - 1;
  }
  
  function undo() {
    if (pointer <= 0) return;
    pointer--;
    const decompressed = decompress(compressedHistory[pointer]);
    state = $state(JSON.parse(decompressed));
  }
  
  return { state, saveState, undo, redo: /*...*/ };
}
```

**When to compress:**
- State is > 100KB per snapshot
- You need 100+ history entries
- Available memory is limited
- You can tolerate CPU cost for decompression

### Performance Considerations

#### Benchmarking Snapshot Sizes

```typescript
// Estimate snapshot size in bytes
function estimateSnapshotSize(state: any): number {
  const json = JSON.stringify(state);
  return new Blob([json]).size;
}

// Usage
console.log('Snapshot size:', estimateSnapshotSize(timeline), 'bytes');
```

#### Debouncing Rapid Changes

```typescript
// debounce.svelte.ts
export function debounce<T>(
  fn: (arg: T) => void,
  delay: number
): (arg: T) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (arg: T) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(arg), delay);
  };
}

// Usage with history
const debouncedSave = debounce(() => {
  history.save();
}, 500);

function onTimelineChange() {
  updateTimeline();
  debouncedSave();
}
```

#### Virtual Scrolling with History
For large lists, virtual scroll and record visible changes:

```typescript
interface VirtualState<T> {
  items: T[];
  viewport: { start: number; end: number };
}

function createVirtualHistory<T>(
  initialState: VirtualState<T>
) {
  let state = $state(initialState);
  let history = $state<{
    changedItems: Map<number, T>;
    viewport: typeof initialState.viewport;
  }[]>([]);
  
  function saveChanges(changedIndices: Set<number>) {
    const changedItems = new Map<number, T>();
    
    // Only save items that changed
    for (const index of changedIndices) {
      changedItems.set(index, state.items[index]);
    }
    
    history.push({
      changedItems,
      viewport: { ...state.viewport }
    });
  }
  
  return { state, saveChanges, undo, redo };
}
```

---

## Integration with Components

### Undo/Redo Store in .svelte.ts File

Create a reusable history store that can be imported anywhere:

```typescript
// lib/undo-redo.svelte.ts
import type { Command } from './types';

export function createUndoRedoStore() {
  let undoStack = $state<Command[]>([]);
  let redoStack = $state<Command[]>([]);
  let maxSize = $state(50);
  let coalesce = $state(true);
  let groupKey: string | null = null;
  
  let canUndo = $derived(undoStack.length > 0);
  let canRedo = $derived(redoStack.length > 0);
  let isGrouping = $derived(groupKey !== null);
  
  function execute(command: Command): void {
    command.execute();
    
    // Handle grouping
    if (groupKey) {
      command.key = groupKey;
      const lastCommand = undoStack[undoStack.length - 1];
      if (coalesce && lastCommand?.key === groupKey) {
        undoStack[undoStack.length - 1] = command;
        redoStack = [];
        return;
      }
    }
    
    undoStack.push(command);
    redoStack = [];
    
    // Limit size
    if (undoStack.length > maxSize) {
      undoStack.shift();
    }
  }
  
  function undo(): void {
    if (!canUndo) return;
    const command = undoStack.pop()!;
    command.undo();
    redoStack.push(command);
  }
  
  function redo(): void {
    if (!canRedo) return;
    const command = redoStack.pop()!;
    command.execute();
    undoStack.push(command);
  }
  
  function setMaxSize(size: number): void {
    maxSize = size;
  }
  
  function setCoalesce(enabled: boolean): void {
    coalesce = enabled;
  }
  
  function group(key: string, actions: () => void): void {
    groupKey = key;
    actions();
    groupKey = null;
  }
  
  function clear(): void {
    undoStack = [];
    redoStack = [];
  }
  
  return {
    execute,
    undo,
    redo,
    canUndo,
    canRedo,
    isGrouping,
    setMaxSize,
    setCoalesce,
    group,
    clear,
    get history() { return undoStack; }
  };
}

// Export singleton instance
export const globalUndoRedo = createUndoRedoStore();
```

### Using in Components

```svelte
<!-- Timeline.svelte -->
<script lang="ts">
  import { globalUndoRedo } from '$lib/undo-redo.svelte.ts';
  import { createStateCommand } from './state-command.svelte.ts';
  
  let clips = $state<Clip[]>([]);
  let selectedClipId = $state<number | null>(null);
  
  function moveClip(clipId: number, newPosition: number) {
    globalUndoRedo.execute(createStateCommand(
      () => clips.find(c => c.id === clipId)!.order,
      (order) => {
        clips.find(c => c.id === clipId)!.order = order;
      },
      newPosition
    ));
  }
  
  function deleteClip(clipId: number) {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    
    globalUndoRedo.execute(createStateCommand(
      () => clips,
      (c) => clips = c.filter(cli => cli.id !== clipId),
      clips.filter(c => c.id !== clipId)
    ));
  }
  
  function batchDelete(clipIds: number[]) {
    globalUndoRedo.group('delete-clips', () => {
      for (const id of clipIds) {
        globalUndoRedo.execute(/* ... */);
      }
    });
  }
</script>

<div class="toolbar">
  <button 
    onclick={() => globalUndoRedo.undo()} 
    disabled={!globalUndoRedo.canUndo}
  >
    Undo (Ctrl+Z)
  </button>
  <button 
    onclick={() => globalUndoRedo.redo()} 
    disabled={!globalUndoRedo.canRedo}
  >
    Redo (Ctrl+Shift+Z)
  </button>
</div>

{#each clips as clip (clip.id)}
  <Clip 
    {clip} 
    onMove={moveClip}
    onDelete={deleteClip}
  />
{/each}
```

### Keyboard Shortcuts

```typescript
// shortcuts.svelte.ts
import { onMount } from 'svelte';
import { globalUndoRedo } from './undo-redo.svelte.ts';

export function setupKeyboardShortcuts() {
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Windows/Linux
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            globalUndoRedo.redo();
          } else {
            globalUndoRedo.undo();
          }
        }
        if (event.key === 'y') {
          event.preventDefault();
          globalUndoRedo.redo();
        }
      }
      
      // Mac-specific
      if (event.metaKey) {
        if (event.key === 'z') {
          event.preventDefault();
          globalUndoRedo.undo();
        }
        if (event.shiftKey && event.key === 'z') {
          event.preventDefault();
          globalUndoRedo.redo();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });
}
```

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { setupKeyboardShortcuts } from './shortcuts.svelte.ts';
  
  setupKeyboardShortcuts();
</script>
```

### UI Controls with Context

```typescript
// undo-redo-context.svelte.ts
import { setContext, getContext } from 'svelte';
import type { CommandHistory } from './types';

const CONTEXT_KEY = Symbol('undo-redo');

export function provideUndoRedo(history: CommandHistory) {
  setContext(CONTEXT_KEY, history);
}

export function useUndoRedo() {
  return getContext<CommandHistory>(CONTEXT_KEY);
}
```

```svelte
<!-- Layout.svelte -->
<script lang="ts">
  import { provideUndoRedo } from './undo-redo-context.svelte.ts';
  import { globalUndoRedo } from './undo-redo.svelte.ts';
  
  provideUndoRedo(globalUndoRedo);
</script>

<slot />

<!-- UndoRedoToolbar.svelte -->
<script lang="ts">
  import { useUndoRedo } from './undo-redo-context.svelte.ts';
  
  const history = useUndoRedo();
</script>

<div class="toolbar">
  <button 
    onclick={() => history.undo()}
    disabled={!history.canUndo}
    title="Undo (Ctrl+Z)"
    class="toolbar-button"
    class:disabled={!history.canUndo}
  >
    <svg><!-- undo icon --></svg>
  </button>
  
  <button 
    onclick={() => history.redo()}
    disabled={!history.canRedo}
    title="Redo (Ctrl+Shift+Z)"
    class="toolbar-button"
    class:disabled={!history.canRedo}
  >
    <svg><!-- redo icon --></svg>
  </button>
</div>

<style>
  .toolbar-button {
    @apply p-2 rounded hover:bg-gray-200 transition;
  }
  .toolbar-button:disabled,
  .toolbar-button.disabled {
    @apply opacity-50 cursor-not-allowed;
  }
</style>
```

### Integrating with Libraries

#### Timeline Library Integration

```typescript
// timeline-commands.svelte.ts
import { createCommandHistory } from './command-history.svelte.ts';

export function createTimelineTimelineHistory() {
  const history = createCommandHistory(100, true);
  
  return {
    ...history,
    // Timeline-specific commands
    moveClip: (clipId: number, fromPosition: number, toPosition: number) => {
      history.execute({
        key: 'clip-move',
        execute: () => {
          const clip = timeline.clips.find(c => c.id === clipId);
          if (clip) clip.order = toPosition;
        },
        undo: () => {
          const clip = timeline.clips.find(c => c.id === clipId);
          if (clip) clip.order = fromPosition;
        }
      });
    },
    
    trimClip: (clipId: number, fromIn: number, fromOut: number, toIn: number, toOut: number) => {
      history.execute({
        key: 'clip-trim',
        execute: () => {
          const clip = timeline.clips.find(c => c.id === clipId);
          if (clip) {
            clip.in = toIn;
            clip.out = toOut;
          }
        },
        undo: () => {
          const clip = timeline.clips.find(c => c.id === clipId);
          if (clip) {
            clip.in = fromIn;
            clip.out = fromOut;
          }
        }
      });
    },
    
    splitClip: (clipId: number, splitPoint: number) => {
      history.execute({
        key: 'clip-split',
        execute: () => {
          const originalClip = timeline.clips.find(c => c.id === clipId);
          if (!originalClip) return;

          const newClipId = Date.now();
          const newClip = {
            ...originalClip,
            id: newClipId,
            in: splitPoint
          };

          originalClip.out = splitPoint;
          timeline.clips.push(newClip);
        },
        undo: () => {
          const newClipId = 0;
          timeline.clips = timeline.clips.filter(c => c.id !== newClipId);
          const originalClip = timeline.clips.find(c => c.id === clipId);
          if (originalClip) originalClip.out = splitPoint;
        }
      });
    }
  };
}
```

### Global Keyboard Shortcut Handler

```typescript
// global-keybinds.svelte.ts
import { onDestroy } from 'svelte';
import { globalUndoRedo } from './undo-redo.svelte.ts';

export function useGlobalKeybinds() {
  function setupKeybinds() {
    const handleKeydown = (e: KeyboardEvent) => {
      // Ignore if in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          globalUndoRedo.redo();
        } else {
          globalUndoRedo.undo();
        }
        return;
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        globalUndoRedo.redo();
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }
  
  const cleanup = setupKeybinds();
  
  onDestroy(cleanup);
}
```

---

## Timeline-Specific Considerations

### Timeline State Model

```typescript
// timeline-types.ts
export interface Clip {
  id: number;
  assetId: number;
  in: number;       // Start point in source (seconds)
  out: number;      // End point in source (seconds)
  start: number;    // Position on timeline (seconds)
  duration: number; // out - in
  order: number;    // Order in clip sequence
}

export interface TimelineState {
  clips: Clip[];
  duration: number;
  playhead: number;
  selection: Set<number>;
  zoom: number;
  scrollOffset: number;
}
```

### Saving Timeline State

```typescript
// timeline-history.svelte.ts
import { createSnapshotHistory } from './snapshot-history.svelte.ts';

export function createTimelineHistory() {
  const history = createSnapshotHistory<TimelineState>(
    {
      clips: [],
      duration: 0,
      playhead: 0,
      selection: new Set(),
      zoom: 100, // pixels per second
      scrollOffset: 0
    },
    50
  );
  
  // Enhanced methods for timeline
  function moveClip(clipId: number, newOrder: number) {
    history.updateState(state => {
      const clip = state.clips.find(c => c.id === clipId);
      if (!clip) return state;
      
      const newClips = [...state.clips];
      newClips.splice(state.clips.indexOf(clip), 1);
      newClips.splice(newOrder, 0, clip);
      
      // Update start times based on new order
      let currentTime = 0;
      newClips.forEach(c => {
        c.start = currentTime;
        currentTime += c.duration;
      });
      
      return {
        ...state,
        clips: newClips
      };
    });
  }
  
  function trimClip(clipId: number, newIn: number, newOut: number) {
    history.updateState(state => {
      const clip = state.clips.find(c => c.id === clipId);
      if (!clip) return state;
      
      const newClip = {
        ...clip,
        in: newIn,
        out: newOut,
        duration: newOut - newIn
      };
      
      const newClips = state.clips.map(c =>
        c.id === clipId ? newClip : c
      );
      
      // Recalculate start times for subsequent clips
      let currentTime = 0;
      newClips.forEach(c => {
        c.start = currentTime;
        currentTime += c.duration;
      });
      
      return {
        ...state,
        clips: newClips,
        duration: currentTime
      };
    });
  }
  
  return {
    ...history,
    moveClip,
    trimClip
  };
}
```

### Optimizing History for Timeline Operations

#### Debounce Clip Dragging
When dragging clips, don't save after every pixel move:

```typescript
// debounced-timeline.svelte.ts
import { debounce } from './debounce.svelte.ts';

export function createOptimizedTimeline() {
  const history = createTimelineHistory();
  let isDragging = $state(false);
  
  function startDrag(clipId: number) {
    isDragging = true;
    // Capture initial state
    const initialState = $state.snapshot(history.state);
  }
  
  const endDrag = debounce(() => {
    isDragging = false;
    // Save final state
  }, 300);
  
  function onClipDrag(clipId: number, newPosition: number) {
    if (isDragging) {
      // Update state without saving to history
      history.state.clips.find(c => c.id === clipId)!.order = newPosition;
      endDrag();
    }
  }
  
  return {
    ...history,
    startDrag,
    onClipDrag,
    isDragging
  };
}
```

#### Coalesce Related Operations

```typescript
// Group operations that conceptually belong together
function reorganizeChapters(newOrder: Chapter[]) {
  globalUndoRedo.group('reorganize-chapters', () => {
    newOrder.forEach((chapter, index) => {
      globalUndoRedo.execute(createStateCommand(
        () => timeline.chapters[index].order,
        (order) => timeline.chapters[index].order = order,
        chapter.order
      ));
    });
  });
}
```

#### Selective History Recording

Not all timeline changes need history:

```typescript
interface TimelineHistoryManager {
  skipHistory: boolean;
  
  withoutHistory<T>(fn: () => T): T;
}

export function createTimelineHistoryManager(): TimelineHistoryManager {
  let skipHistory = $state(false);
  
  function withoutHistory<T>(fn: () => T): T {
    skipHistory = true;
    try {
      return fn();
    } finally {
      skipHistory = false;
    }
  }
  
  return {
    get skipHistory() { return skipHistory; },
    withoutHistory
  };
}

// Usage
const historyManager = createTimelineHistoryManager();

// Changes without history - e.g., temporary preview
historyManager.withoutHistory(() => {
  timeline.playhead = previewPosition;
});

// Changes with history
function moveClip(clipId: number, newPos: number) {
  if (historyManager.skipHistory) {
    // Direct update
    timeline.clips.find(c => c.id === clipId)!.order = newPos;
  } else {
    // Update with history
    globalUndoRedo.execute(/* ... */);
  }
}
```

### Handling Audio Waveform Visualization

Waveforms are expensive to render; optimize their history:

```typescript
// waveform-history.svelte.ts
export interface TimelineWithWaveform extends TimelineState {
  waveforms: Map<number, Float32Array>; // Large data
  waveformCache: Map<string, HTMLCanvasElement>;
}

export function createWaveformAwareHistory() {
  let state = $state<TimelineWithWaveform>({
    clips: [],
    waveforms: new Map(),
    waveformCache: new Map()
  });
  
  let history = $state<{
    operations: Operation[];
    waveformData?: Map<number, Float32Array>; // Only save when needed
  }[]>([]);
  
  function saveSnapshot(excludeWaveforms: boolean = true) {
    const snapshot: typeof history[0] = {
      operations: []
    };
    
    if (!excludeWaveforms) {
      snapshot.waveformData = state.waveforms;
    }
    
    history.push(snapshot);
  }
  
  return {
    state,
    saveSnapshot,
    undo: () => {
      // Restore waveforms only if available in snapshot
      const prev = history[history.length - 1];
      if (prev.waveformData) {
        state.waveforms = prev.waveformData;
      }
    },
    redo: /* ... */
  };
}
```

### Timeline Duration Calculation

Efficiently calculate total duration on undo/redo:

```typescript
// duration-calculator.svelte.ts
export function createTimelineWithDuration() {
  let clips = $state<Clip[]>([]);
  
  let totalDuration = $derived(() => {
    let max = 0;
    for (const clip of clips) {
      const end = clip.start + clip.duration;
      if (end > max) max = end;
    }
    return max;
  });
  
  return {
    clips,
    totalDuration
  };
}
```

### Multi-Selection Undo/Redo

```typescript
// multi-selection-history.svelte.ts
export function createMultiSelectionHistory() {
  let timeline = $state<TimelineState>({
    clips: [],
    selection: new Set()
  });
  
  function deleteSelected() {
    const selectedIds = Array.from(timeline.selection);
    const deletedClips = timeline.clips.filter(c => 
      selectedIds.includes(c.id)
    );
    
    globalUndoRedo.execute({
      key: 'delete-clips',
      execute: () => {
        timeline.clips = timeline.clips.filter(c => !selectedIds.includes(c.id));
        timeline.selection = new Set();
      },
      undo: () => {
        timeline.clips = [...timeline.clips, ...deletedClips];
        timeline.selection = new Set(selectedIds);
      }
    });
  }
  
  function moveSelected(delta: number) {
    const selectedIds = Array.from(timeline.selection);
    const originalStarts = new Map(
      selectedIds.map(id => [id, timeline.clips.find(c => c.id === id)!.start])
    );
    
    globalUndoRedo.execute({
      key: 'move-clips',
      execute: () => {
        timeline.clips.forEach(clip => {
          if (selectedIds.includes(clip.id)) {
            clip.start += delta;
          }
        });
      },
      undo: () => {
        timeline.clips.forEach(clip => {
          if (selectedIds.includes(clip.id)) {
            clip.start = originalStarts.get(clip.id)!;
          }
        });
      }
    });
  }
  
  return {
    timeline,
    deleteSelected,
    moveSelected
  };
}
```

### Limiting History by Operations, Not Just Size

```typescript
// operation-aware-history.svelte.ts
type OperationType = 'move' | 'trim' | 'delete' | 'add';

interface OperationMetadata {
  type: OperationType;
  timestamp: number;
  clipsAffected: number[];
}

export function createOperationAwareHistory() {
  let history = $state<Array<Operation & { metadata: OperationMetadata }>>([]);
  let pointer = $state(-1);
  
  // Keep at most:
  // - 100 recent operations
  // - 50 move/trim operations (these are frequent)
  // - Unlimited delete operations (rare but important)
  
  function pruneHistory() {
    const recent = history.slice(-100);
    const deletes = recent.filter(op => op.metadata.type === 'delete');
    const others = recent.filter(op => op.metadata.type !== 'delete');
    
    history = [...deletes, ...others.slice(-50)];
  }
  
  function executeWithMetadata(command: Command, metadata: OperationMetadata) {
    command.execute();
    history.push({ ...command, metadata });
    pruneHistory();
  }
  
  return {
    execute: executeWithMetadata,
    undo,
    redo
  };
}
```

---

## Existing Libraries

### reddojs

**URL:** https://github.com/eihabkhan/reddojs

**Features:**
- Tiny (< 1kb gzipped)
- Zero dependencies
- Framework agnostic core
- Official Svelte 5 adapter
- Command coalescing
- TypeScript support

**Installation:**
```bash
npm install @reddojs/svelte
```

**Usage:**
```typescript
import { useHistory } from '@reddojs/svelte';

const { execute, undo, redo, canUndo, canRedo } = useHistory({ size: 100 });

let count = $state(0);

function increment() {
  execute({
    do: () => count++,
    undo: () => count--
  });
}
```

**Pros:**
- Lightweight
- Simple API
- Svelte 5 compatible
- Well-typed

**Cons:**
- Limited customization
- No built-in timeline-specific features

**Verdict:** Good starting point for simple undo/redo. For complex timeline operations, consider building on top or using a custom implementation.

### Other Notable Libraries

1. **zundo** (Zustand middleware)
   - Popular, but React-focused
   - Could be adapted with `$state` integration

2. **@wordpress/undo-manager**
   - Robust undo/redo from Gutenberg
   - Heavy (~450kb)
   - Overkill for most use cases

3. **use-undo**
   - React hooks
   - Would need adapter for Svelte 5

**Recommendation:** Build custom implementation using `$state`, `$state.snapshot`, and `$effect` for full control and optimal performance.

---

## Best Practices

### Performance Best Practices

```typescript
// 1. Debounce rapid changes
function createOptimizedHistory() {
  let state = $state({});
  let history = $state([]);
  
  const saveToHistory = debounce(() => {
    history.push($state.snapshot(state));
  }, 300);
  
  function updateState(newState: any) {
    state = newState;
    saveToHistory();
  }
  
  return { state, updateState, undo, redo };
}

// 2. Coalesce similar operations
function createCoalescingHistory() {
  let history = $state<{ command: Command; key: string }[]>([]);
  
  function execute(command: Command, key?: string) {
    // Merge consecutive operations with same key
    if (key) {
      const last = history[history.length - 1];
      if (last?.key === key) {
        last.command = command;
        return;
      }
    }
    
    history.push({ command, key: key || 'default' });
  }
  
  return { execute, undo };
}

// 3. Use derived state for computed values
function createTimelineHistory() {
  let clips = $state<Clip[]>([]);
  
  // Efficiently computed duration
  let totalDuration = $derived(() => {
    let max = 0;
    for (const clip of clips) {
      const end = clip.start + clip.duration;
      max = Math.max(max, end);
    }
    return max;
  });
  
  return { clips, totalDuration };
}

// 4. Limit memory usage with partial snapshots
function createMemoryEfficientHistory() {
  let state = $state<LargeObject>({});
  
  let history = $state<{ changedPath: string; value: any }[]>([]);
  
  function setValue(path: string, value: any) {
    const oldValue = get(state, path);
    set(state, path, value);
    
    history.push({ changedPath: path, value: oldValue });
  }
  
  return { state, setValue, undo };
}
```

### Memory Management

```typescript
// 1. Limit history size
function createFixedHistory(size: number = 50) {
  let history = $state<any[]>([]);
  
  function pushState(state: any) {
    history.push(state);
    if (history.length > size) {
      history.shift();
    }
  }
  
  return { history, pushState };
}

// 2. Use WeakMap for large objects
function createWeakHistory() {
  let references = new WeakMap<any, any>();
  
  function trackChanges(original: any, modified: any) {
    references.set(modified, { original, timestamp: Date.now() });
  }
  
  function undo(modified: any) {
    const data = references.get(modified);
    if (data) {
      // Restore from original
      return data.original;
    }
  }
  
  return { trackChanges, undo };
}

// 3. Compress history snapshots
import { compress, decompress } from 'lz-string';

function createCompressedHistory() {
  let compressedHistory = $state<string[]>([]);
  
  function save(state: any) {
    const json = JSON.stringify($state.snapshot(state));
    const compressed = compress(json);
    compressedHistory.push(compressed);
  }
  
  function restore(index: number) {
    const decompressed = decompress(compressedHistory[index]);
    return JSON.parse(decompressed);
  }
  
  return { save, restore };
}

// 4. Virtual DOM updates only on undo/redo
function createOptimizedHistory() {
  let state = $state({});
  let history = $state<any[]>([]);
  let pointer = $state(0);
  
  function undo() {
    if (pointer > 0) {
      pointer--;
      state = $state(history[pointer]);
    }
  }
  
  // State is reference-based; only updates trigger reactivity
  return { state, undo, redo };
}
```

### User Experience Best Practices

```typescript
// 1. Visual feedback during undo/redo
function createUndoWithFeedback() {
  let isUndoing = $state(false);
  let lastAction = $derived(
    isUndoing ? 'Undoing...' : ''
  );
  
  async function undo() {
    isUndoing = true;
    try {
      await performUndo();
    } finally {
      isUndoing = false;
    }
  }
  
  return { undo, lastAction };
}

// 2. Batch operations for complex actions
function createBatchHistory() {
  let isBatching = $state(false);
  let batch = $state<Command[]>([]);
  
  function batchExecute(commands: Command[]) {
    isBatching = true;
    commands.forEach(c => c.execute());
    isBatching = false;
    batch = commands; // Save as single undo point
  }
  
  return { batchExecute, isBatching };
}

// 3. Clear history on destructive operations
function createSmartHistory() {
  let history = $state<any[]>([]);
  
  function clearOnDestructive() {
    // Clear when loading new project
    history = [];
  }
  
  return { history, clearOnDestructive };
}

// 4. Show history info to user
function createInspectableHistory() {
  let history = $state<{ label: string; operation: Command }[]>([]);
  
  function execute(label: string, command: Command) {
    command.execute();
    history.push({ label, operation: command });
  }
  
  function undo() {
    const { label, operation } = history.pop()!;
    operation.undo();
    console.log(`Undid: ${label}`);
  }
  
  return { execute, undo, getLabels: () => history.map(h => h.label) };
}
```

### Testing Undo/Redo

```typescript
// test-undo-redo.test.ts
import { describe, it, expect } from 'vitest';
import { createCommandHistory } from './command-history.svelte.ts';

describe('Undo/Redo History', () => {
  it('should undo a simple operation', () => {
    const history = createCommandHistory(10, false);
    let count = 0;
    
    history.execute({
      execute: () => count++,
      undo: () => count--
    });
    
    expect(count).toBe(1);
    
    history.undo();
    expect(count).toBe(0);
  });
  
  it('should redo an undone operation', () => {
    const history = createCommandHistory(10, false);
    let count = 0;
    
    history.execute({
      execute: () => count++,
      undo: () => count--
    });
    
    history.undo();
    expect(count).toBe(0);
    
    history.redo();
    expect(count).toBe(1);
  });
  
  it('should coalesce consecutive operations with same key', () => {
    const history = createCommandHistory(10, true);
    let count = 0;
    
    history.execute({ execute: () => count++, undo: () => count--, key: 'increment' });
    expect(count).toBe(1);
    
    history.execute({ execute: () => count++, undo: () => count--, key: 'increment' });
    // Only one entry in history after coalescing
    
    history.undo();
    expect(count).toBe(0);
  });
  
  it('should limit history size', () => {
    const history = createCommandHistory(3, false);
    
    for (let i = 0; i < 10; i++) {
      history.execute({ execute: () => {}, undo: () => {} });
    }
    
    // Only last 3 operations
    expect(history.canRedo).toBe(false);
  });
});
```

### Error Handling

```typescript
function createSafeHistory() {
  let history = $state<Command[]>([]);
  let errors = $state<Error[]>([]);
  
  function execute(command: Command) {
    try {
      command.execute();
      history.push(command);
    } catch (error) {
      errors.push(error as Error);
      console.error('Command execution failed:', error);
    }
  }
  
  function undo() {
    const command = history[history.length - 1];
    try {
      command.undo();
      history.pop();
    } catch (error) {
      errors.push(error as Error);
      console.error('Undo failed:', error);
    }
  }
  
  return {
    execute,
    undo,
    errors,
    clearErrors: () => errors = []
  };
}
```

## Conclusion

Svelte 5's runes API provides powerful primitives for implementing undo/redo functionality:

1. **`$state`** - Creates reactive state that's easy to snapshot
2. **`$state.snapshot`** - Efficiently removes proxies for history storage
3. **`$derived`** - Computed values stay up-to-date across undos
4. **`$effect`** - Track changes automatically for history

**Recommended approach for VOD Pipeline:**

```typescript
// lib/core/timeline-history.svelte.ts
export function createTimelineHistory() {
  const commandHistory = createCommandHistory(50, true);
  const state = $state<TimelineState>(initialState);
  
  return {
    state,
    execute: commandHistory.execute,
    undo: commandHistory.undo,
    redo: commandHistory.redo,
    canUndo: commandHistory.canUndo,
    canRedo: commandHistory.canRedo,
    
    // Timeline-specific commands
    moveClip: (id: number, to: number) => {
      const from = state.clips.find(c => c.id === id)!.order;
      commandHistory.execute({
        key: 'clip-move',
        execute: () => updateClipOrder(id, to),
        undo: () => updateClipOrder(id, from)
      });
    },
    
    trimClip: (id: number, in: number, out: number) => {
      const old = state.clips.find(c => c.id === id)!;
      commandHistory.execute({
        key: 'clip-trim',
        execute: () => updateClipBounds(id, in, out),
        undo: () => updateClipBounds(id, old.in, old.out)
      });
    }
  };
}
```

This approach combines:
- Command pattern for precise undo/redo
- Efficient memory usage with state snapshots
- Integration with Svelte 5's reactivity
- Timeline-specific optimization (coalescing, debouncing, partial snapshots)

---

## References

- [Svelte $state](https://svelte.dev/docs/svelte/$state)
- [Svelte $derived](https://svelte.dev/docs/svelte/$derived)
- [Svelte $effect](https://svelte.dev/docs/svelte/$effect)
- [Svelte runes blog](https://svelte.dev/blog/runes)
- [Refactoring Guru Command pattern](https://refactoring.guru/design-patterns/command)
- [reddojs repo](https://github.com/eihabkhan/reddojs)
- [undo-redo topic](https://github.com/topics/undo-redo)
