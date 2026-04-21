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

<div class="flex h-screen flex-col">
  <header class="flex items-center justify-between border-b border-border-default bg-surface-raised px-8 py-4">
    <h1 class="m-0 text-app-2xl font-semibold text-text-primary">VOD Pipeline</h1>
    <div class="flex items-center gap-2">
      <IconButton
        icon={themeState.current === 'dark' ? Sun : Moon}
        size={18}
        onclick={toggleTheme}
        title="Toggle theme"
        class="h-10 w-10 border border-border-strong text-text-secondary hover:bg-surface-active"
      />
      <Button variant="secondary" onclick={openSettings} icon={Settings}>
        Settings
      </Button>
    </div>
  </header>

  <main
    class={cn(
      'flex-1 overflow-auto p-8',
      selectedProject ? 'overflow-hidden p-0' : 'overflow-auto p-8',
    )}
  >
    {#if !selectedProject}
      <section class="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div class="flex items-center justify-between gap-4">
          <h2 class="m-0 text-app-2xl font-semibold text-text-primary">Projects</h2>
          <Button variant="primary" onclick={() => showCreateDialog = true}>New Project</Button>
        </div>

        {#if projects.loading}
          <p class="rounded-lg border border-border-default bg-surface-raised px-6 py-8 text-center text-text-disabled">
            Loading projects...
          </p>
        {:else if projects.error}
          <p class="rounded-lg border border-accent-destructive bg-accent-destructive/10 px-6 py-8 text-center text-accent-destructive">
            {projects.error}
          </p>
        {:else if projects.items.length === 0}
          <p class="rounded-lg border border-border-default bg-surface-raised px-6 py-8 text-center text-text-disabled">
            No projects yet. Create one to get started!
          </p>
        {:else}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-6">
            {#each projects.items as project (project.id)}
              <button
                type="button"
                class="overflow-hidden rounded-lg border border-border-default bg-surface-raised text-left transition-transform transition-shadow hover:-translate-y-0.5 hover:shadow-lg"
                onclick={() => selectProject(project.id)}
                oncontextmenu={(event) => openProjectContextMenu(event, project.id, project.name)}
              >
                <div class="flex h-[140px] items-center justify-center bg-[linear-gradient(135deg,#667eea_0%,#764ba2_100%)]">
                  <span class="flex items-center justify-center text-white">
                    <Icon icon={Video} size={20} />
                  </span>
                </div>
                <div class="p-4">
                  <h3 class="mb-2 text-app-lg font-semibold text-text-primary">{project.name}</h3>
                  <p class="m-0 text-app-sm text-text-disabled">
                    {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </div>
              </button>
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
        <div class="flex w-[400px] max-w-full flex-col gap-4">
          <input
            type="text"
            bind:value={newProjectName}
            class="w-full rounded-sm border border-border-default bg-surface-elevated px-3 py-2 text-app-md text-text-primary placeholder:text-text-disabled"
            placeholder="Project name"
            onkeydown={(e) => {
              if (e.key === 'Enter' && newProjectName.trim()) {
                handleCreateProject();
              }
            }}
          />
          <div class="flex justify-end gap-2">
            <Button variant="secondary" onclick={() => showCreateDialog = false}>Cancel</Button>
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
