<script lang="ts">
  import { projects, getSelectedProject, loadProjects, createProject, deleteProject, selectProject } from './lib/state/project.svelte';
  import { openSettings, loadSettings } from './lib/state/settings.svelte';
  import { themeState, toggleTheme } from './lib/state/theme.svelte';
  import ProjectDetail from './lib/components/ProjectDetail.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import Button from './lib/components/ui/Button.svelte';
  import ContextMenu from './lib/components/ui/ContextMenu.svelte';
  import Dialog from './lib/components/ui/Dialog.svelte';
  import Icon from './lib/components/ui/Icon.svelte';
  import IconButton from './lib/components/ui/IconButton.svelte';
  import { cn } from './lib/utils/cn';
  import { Video, Sun, Moon, Settings } from './lib/constants';

  const selectedProject = $derived.by(() => getSelectedProject());

  let newProjectName = $state('');
  let showCreateDialog = $state(false);
  let deletingProjectId = $state<number | null>(null);
  let projectContextMenu = $state({
    open: false,
    x: 0,
    y: 0,
    projectId: null as number | null,
    projectName: '',
  });

  $effect(() => {
    loadProjects();
    loadSettings();
  });

  function handleCreateProject() {
    if (!newProjectName.trim()) return;

    createProject(newProjectName.trim())
      .then(() => {
        newProjectName = '';
        showCreateDialog = false;
      })
      .catch((error) => {
        console.error('Failed to create project:', error);
      });
  }

  function handleBackToProjects() {
    selectProject(null);
  }

  async function handleDeleteProject(projectId: number, projectName: string) {
    if (deletingProjectId === projectId) return;

    const confirmed = window.confirm(
      `Delete project "${projectName}"?\n\nThis permanently deletes the project and all related chapters, clips, transcripts, and waveform data.`,
    );

    if (!confirmed) return;

    deletingProjectId = projectId;
    try {
      await deleteProject(projectId);
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      deletingProjectId = null;
    }
  }

  function closeProjectContextMenu() {
    projectContextMenu.open = false;
    projectContextMenu.projectId = null;
    projectContextMenu.projectName = '';
  }

  function openProjectContextMenu(event: MouseEvent, projectId: number, projectName: string) {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 52;
    const maxX = window.innerWidth - menuWidth - 8;
    const maxY = window.innerHeight - menuHeight - 8;

    projectContextMenu.x = Math.max(8, Math.min(event.clientX, maxX));
    projectContextMenu.y = Math.max(8, Math.min(event.clientY, maxY));
    projectContextMenu.projectId = projectId;
    projectContextMenu.projectName = projectName;
    projectContextMenu.open = true;
  }

  function handleContextDelete() {
    const projectId = projectContextMenu.projectId;
    const projectName = projectContextMenu.projectName;
    closeProjectContextMenu();

    if (projectId === null) return;

    void handleDeleteProject(projectId, projectName);
  }
</script>

<div class="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden">
  <header class="flex items-center justify-between px-8 py-6 z-10 relative">
    <div class="flex items-center gap-4">
      <div class="h-8 w-8 rounded-md bg-surface-raised border border-border-default flex items-center justify-center">
        <Icon icon={Video} size={16} class="text-text-primary" />
      </div>
      <h1 class="m-0 text-app-xl font-bold tracking-tighter text-text-primary">VOD Pipeline</h1>
    </div>
    <div class="flex items-center gap-3">
      <IconButton
        icon={themeState.current === 'dark' ? Sun : Moon}
        size={16}
        onclick={toggleTheme}
        title="Toggle theme"
        class="h-9 w-9 rounded-full bg-surface-elevated text-text-secondary hover:text-text-primary transition-all border border-border-subtle"
      />
      <Button variant="ghost" onclick={openSettings} icon={Settings} class="h-9">
        Settings
      </Button>
    </div>
  </header>

  <main
    class={cn(
      'flex-1 min-h-0 w-full',
      selectedProject ? 'overflow-hidden p-0' : 'overflow-auto p-4 md:p-8 max-w-[1400px] mx-auto',
    )}
  >
    {#if !selectedProject}
      <section class="flex flex-col gap-12 w-full pt-4 md:pt-10">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-6 w-full max-w-4xl">
          <div class="flex flex-col gap-2">
            <h2 class="m-0 text-app-3xl md:text-[3rem] font-bold tracking-tighter leading-none text-text-primary max-w-lg">
              Your Video Projects
            </h2>
            <p class="text-app-md text-text-secondary max-w-md mt-2">
              Transform raw streams into polished stories with AI-assisted narrative beat extraction.
            </p>
          </div>
          <Button variant="primary" onclick={() => showCreateDialog = true} class="font-medium px-6 py-2.5 h-auto">
            New Project
          </Button>
        </div>

        {#if projects.loading}
          <div class="surface-card p-12 text-center text-text-tertiary max-w-4xl border-dashed">
            <div class="animate-pulse">Loading workspace...</div>
          </div>
        {:else if projects.error}
          <div class="surface-card p-8 border-accent-destructive bg-accent-destructive/5 text-accent-destructive max-w-4xl">
            {projects.error}
          </div>
        {:else if projects.items.length === 0}
          <div class="surface-card p-16 flex flex-col items-center justify-center gap-4 text-center max-w-4xl border-dashed">
            <div class="h-16 w-16 rounded-md bg-surface-raised border border-border-subtle flex items-center justify-center mb-4">
              <Icon icon={Video} size={28} class="text-text-tertiary" />
            </div>
            <h3 class="text-app-xl font-bold tracking-tight m-0 text-text-primary">Ready to cut</h3>
            <p class="text-text-secondary m-0 max-w-[30ch]">
              Drop your first VOD in and let the pipeline extract the story.
            </p>
            <Button variant="secondary" onclick={() => showCreateDialog = true} class="mt-4">
              Create your first project
            </Button>
          </div>
        {:else}
          <!-- Bento Grid Layout -->
          <div class="grid grid-flow-dense grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-[280px]">
            {#each projects.items as project, i (project.id)}
              <div class="flex flex-col group relative">
                <button
                  type="button"
                  class="surface-card flex-1 p-8 text-left transition-all duration-200 hover:bg-surface-elevated active:scale-[0.98] outline-none focus-visible:ring-[3px] focus-visible:ring-border-focus flex flex-col justify-between"
                  onclick={() => selectProject(project.id)}
                  oncontextmenu={(event) => openProjectContextMenu(event, project.id, project.name)}
                >
                  <div class="flex items-start justify-between w-full">
                    <div class="h-10 w-10 rounded-md bg-surface-raised border border-border-default flex items-center justify-center">
                       <Icon icon={Video} size={18} class="text-text-primary" />
                    </div>
                  </div>
                  
                  <div class="mt-auto">
                    <h3 class="text-app-xl font-bold tracking-tight text-text-primary m-0 line-clamp-2">
                      {project.name}
                    </h3>
                  </div>
                </button>
                <div class="pt-3 px-1 flex items-center justify-between text-app-sm text-text-secondary">
                  <span class="font-mono text-xs">{new Date(project.created_at).toLocaleDateString()}</span>
                  <span class="opacity-0 group-hover:opacity-100 transition-opacity duration-200">Open project →</span>
                </div>
              </div>
            {/each}
          </div>

          {#if projectContextMenu.open}
            <ContextMenu
              x={projectContextMenu.x}
              y={projectContextMenu.y}
              onclose={closeProjectContextMenu}
              items={[
                {
                  label: deletingProjectId === projectContextMenu.projectId ? 'Deleting...' : 'Delete project',
                  action: handleContextDelete,
                  destructive: true,
                  disabled: deletingProjectId === projectContextMenu.projectId,
                },
              ]}
            />
          {/if}
        {/if}
      </section>

      <Dialog open={showCreateDialog} title="Create New Project" onClose={() => showCreateDialog = false}>
        <div class="flex w-[400px] max-w-full flex-col gap-6 pt-2">
          <div class="flex flex-col gap-2">
            <label for="projectName" class="text-app-sm font-medium text-text-secondary">Project Name</label>
            <input
              id="projectName"
              type="text"
              bind:value={newProjectName}
              class="w-full h-10 rounded-md border border-border-default bg-surface-base px-3 py-2 text-app-md text-text-primary placeholder:text-text-disabled focus:ring-[3px] focus:ring-border-focus focus:border-border-focus transition-all duration-120"
              placeholder="e.g. Mario Odyssey Part 1"
              onkeydown={(e) => {
                if (e.key === 'Enter' && newProjectName.trim()) {
                  handleCreateProject();
                }
              }}
            />
          </div>
          <div class="flex justify-end gap-3">
            <Button variant="ghost" onclick={() => showCreateDialog = false}>Cancel</Button>
            <Button variant="primary" onclick={handleCreateProject} disabled={!newProjectName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    {:else}
      <ProjectDetail project={selectedProject} onBack={handleBackToProjects} />
    {/if}

    <SettingsPanel />
  </main>
</div>
