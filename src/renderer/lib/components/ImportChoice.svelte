<script lang="ts">
  import { setImportChoice, setIsImporting } from "../state/chapters.svelte";
  import { getPathForFile } from "../api/system.js";
  import Button from './ui/Button.svelte';
  import Icon from './ui/Icon.svelte';
  import { cn } from '../utils/cn';
  import { Video, FolderOpen } from '../constants';

  interface Props {
    projectId: number;
    onVODImport: (filePath: string) => void;
    onFilesImport: (filePaths: string[]) => void;
  }

  let { onVODImport, onFilesImport }: Props = $props();

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

      const filePath = await getFilePath(videoFiles[0]);
      if (filePath) {
        handleVODImport(filePath);
      }
      return;
    }

    const filePaths: string[] = [];
    for (const file of videoFiles) {
      const path = await getFilePath(file);
      if (path) filePaths.push(path);
    }

    if (filePaths.length > 0) {
      handleFilesImport(filePaths);
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
      input.accept = ".mp4,.mkv,.mov,.avi,.webm,.m4v,.ts,.m2ts,.mts";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const filePath = await getFilePath(file);
        if (filePath) {
          handleVODImport(filePath);
        }
      };
      input.click();
    } catch {
      importError = "Failed to open file browser";
    }
  }

  async function handleBrowseFiles() {
    importError = null;

    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".mp4,.mkv,.mov,.avi,.webm,.m4v,.ts,.m2ts,.mts";
      input.multiple = true;
      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files || files.length === 0) return;

        const filePaths: string[] = [];
        for (const file of Array.from(files)) {
          const path = await getFilePath(file);
          if (path) filePaths.push(path);
        }

        if (filePaths.length > 0) {
          handleFilesImport(filePaths);
        }
      };
      input.click();
    } catch {
      importError = "Failed to open file browser";
    }
  }

  function handleVODImport(filePath: string) {
    setImportChoice("vod");
    setIsImporting(true);
    onVODImport(filePath);
  }

  function handleFilesImport(filePaths: string[]) {
    setImportChoice("files");
    setIsImporting(true);
    onFilesImport(filePaths);
  }
</script>

<div class="flex min-h-full flex-col items-center justify-center px-4 py-12">
  <h2 class="mb-8 text-center text-app-2xl font-medium text-text-primary">How would you like to start?</h2>

  {#if importError}
    <div class="mb-6 rounded-md bg-red-400/10 px-4 py-3 text-app-base text-red-400">
      {importError}
    </div>
  {/if}

  <div class="grid w-full max-w-[800px] grid-cols-1 gap-8 md:grid-cols-2">
    <div
      class={cn(
        'rounded-xl border-2 border-dashed border-border-strong bg-surface-elevated p-8 text-center transition-colors hover:border-accent-primary hover:bg-surface-hover',
        isDragging && 'border-accent-success bg-accent-success/5',
      )}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, "vod")}
      role="button"
      tabindex="0"
    >
      <div class="mb-4 flex items-center justify-center text-text-primary">
        <Icon icon={Video} size={32} />
      </div>
      <h3 class="mb-3 text-app-xl font-semibold text-text-primary">Import Full VOD</h3>
      <p class="mb-6 text-app-base leading-6 text-text-tertiary">
        Import a single large video file and manually define chapters
      </p>
      <Button class="px-6 py-2.5" variant="primary" onclick={handleBrowseVOD}>
        Browse...
      </Button>
      <p class="mt-4 text-[0.75rem] italic text-text-disabled">or drop a video file here</p>
    </div>

    <div
      class={cn(
        'rounded-xl border-2 border-dashed border-border-strong bg-surface-elevated p-8 text-center transition-colors hover:border-accent-primary hover:bg-surface-hover',
        isDragging && 'border-accent-success bg-accent-success/5',
      )}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, "files")}
      role="button"
      tabindex="0"
    >
      <div class="mb-4 flex items-center justify-center text-text-primary">
        <Icon icon={FolderOpen} size={32} />
      </div>
      <h3 class="mb-3 text-app-xl font-semibold text-text-primary">Import Individual Files</h3>
      <p class="mb-6 text-app-base leading-6 text-text-tertiary">
        Import pre-cut video files as chapters (each file = 1 chapter)
      </p>
      <Button class="px-6 py-2.5" variant="primary" onclick={handleBrowseFiles}>
        Browse...
      </Button>
      <p class="mt-4 text-[0.75rem] italic text-text-disabled">or drop multiple files here</p>
    </div>
  </div>
</div>
