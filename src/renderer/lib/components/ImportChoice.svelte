<script lang="ts">
  import { chaptersState, setImportChoice, setIsImporting, autoCreateChaptersFromFiles } from "../state/chapters.svelte";
  import { getPathForFile } from "../api/system.js";
  import Icon from './ui/Icon.svelte';
  import { Video, FolderOpen } from '../constants';

  interface Props {
    projectId: number;
    onVODImport: (filePath: string) => void;
    onFilesImport: (filePaths: string[]) => void;
  }

  let { projectId, onVODImport, onFilesImport }: Props = $props();

  let isDragging = $state(false);
  let importError = $state<string | null>(null);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent, type: "vod" | "files") {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    importError = null;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const videoFiles = fileList.filter((f) => isVideoFile(f.name));

    if (videoFiles.length === 0) {
      importError = "Please drop video files only";
      return;
    }

    if (type === "vod") {
      if (videoFiles.length > 1) {
        importError = "For VOD import, please drop only one file";
        return;
      }
      const file = videoFiles[0];
      const filePath = await getFilePath(file);
      if (filePath) {
        handleVODImport(filePath);
      }
    } else {
      // Files import
      const filePaths: string[] = [];
      for (const file of videoFiles) {
        const path = await getFilePath(file);
        if (path) filePaths.push(path);
      }
      if (filePaths.length > 0) {
        handleFilesImport(filePaths);
      }
    }
  }

  async function getFilePath(file: File): Promise<string | null> {
    try {
      return getPathForFile(file);
    } catch (error) {
      console.error("[ImportChoice] Failed to get file path:", error);
      return null;
    }
  }

  function isVideoFile(filename: string): boolean {
    const videoExtensions = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".ts", ".m2ts", ".mts"];
    const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
    return videoExtensions.includes(ext);
  }

  async function handleBrowseVOD() {
    importError = null;
    try {
      const input = document.createElement("input");
      input.type = "file";
      // Use explicit extensions instead of video/* for better cross-platform support
      input.accept = ".mp4,.mkv,.mov,.avi,.webm,.m4v,.ts,.m2ts,.mts";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const filePath = await getFilePath(file);
          if (filePath) {
            handleVODImport(filePath);
          }
        }
      };
      input.click();
    } catch (error) {
      importError = "Failed to open file browser";
    }
  }

  async function handleBrowseFiles() {
    importError = null;
    try {
      const input = document.createElement("input");
      input.type = "file";
      // Use explicit extensions instead of video/* for better cross-platform support
      input.accept = ".mp4,.mkv,.mov,.avi,.webm,.m4v,.ts,.m2ts,.mts";
      input.multiple = true;
      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          const filePaths: string[] = [];
          for (const file of Array.from(files)) {
            const path = await getFilePath(file);
            if (path) filePaths.push(path);
          }
          if (filePaths.length > 0) {
            handleFilesImport(filePaths);
          }
        }
      };
      input.click();
    } catch (error) {
      importError = "Failed to open file browser";
    }
  }

  async function handleVODImport(filePath: string) {
    setImportChoice("vod");
    setIsImporting(true);
    onVODImport(filePath);
  }

  async function handleFilesImport(filePaths: string[]) {
    setImportChoice("files");
    setIsImporting(true);
    onFilesImport(filePaths);
  }
</script>

<div class="import-choice">
  <h2>How would you like to start?</h2>
  
  {#if importError}
    <div class="error-message">
      {importError}
    </div>
  {/if}

  <div class="options-grid">
    <!-- VOD Import Option -->
    <div
      class="import-option"
      class:dragging={isDragging}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, "vod")}
      role="button"
      tabindex="0"
    >
      <div class="option-icon"><Icon icon={Video} size={32} /></div>
      <h3>Import Full VOD</h3>
      <p class="option-description">
        Import a single large video file and manually define chapters
      </p>
      <button class="browse-btn" onclick={handleBrowseVOD}>
        Browse...
      </button>
      <p class="drop-hint">or drop a video file here</p>
    </div>

    <!-- Individual Files Option -->
    <div
      class="import-option"
      class:dragging={isDragging}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, "files")}
      role="button"
      tabindex="0"
    >
      <div class="option-icon"><Icon icon={FolderOpen} size={32} /></div>
      <h3>Import Individual Files</h3>
      <p class="option-description">
        Import pre-cut video files as chapters (each file = 1 chapter)
      </p>
      <button class="browse-btn" onclick={handleBrowseFiles}>
        Browse...
      </button>
      <p class="drop-hint">or drop multiple files here</p>
    </div>
  </div>
</div>

<style>
  .import-choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12);
    min-height: 100%;
  }

  h2 {
    margin: 0 0 var(--space-8) 0;
    color: var(--text-primary);
    font-size: var(--text-2xl);
    font-weight: 500;
  }

  .error-message {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
    padding: 0.75rem var(--space-4);
    border-radius: 6px;
    margin-bottom: var(--space-6);
    font-size: var(--text-base);
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    max-width: 800px;
    width: 100%;
  }

  @media (max-width: 768px) {
    .options-grid {
      grid-template-columns: 1fr;
    }
  }

  .import-option {
    background: var(--surface-elevated);
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .import-option:hover {
    border-color: var(--accent-primary);
    background: #2a2a2a;
  }

  .import-option.dragging {
    border-color: #4ade80;
    background: rgba(74, 222, 128, 0.05);
  }

  .option-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-4);
  }

  h3 {
    margin: 0 0 0.75rem 0;
    color: var(--text-primary);
    font-size: var(--text-xl);
  }

  .option-description {
    margin: 0 0 var(--space-6) 0;
    color: var(--text-tertiary);
    font-size: var(--text-base);
    line-height: 1.5;
  }

  .browse-btn {
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    padding: 0.625rem var(--space-6);
    border-radius: 6px;
    cursor: pointer;
    font-size: var(--text-base);
    font-weight: 500;
    transition: background 0.2s;
  }

  .browse-btn:hover {
    background: var(--accent-primary-hover);
  }

  .drop-hint {
    margin: var(--space-4) 0 0 0;
    color: var(--text-disabled);
    font-size: 0.75rem;
    font-style: italic;
  }
</style>
