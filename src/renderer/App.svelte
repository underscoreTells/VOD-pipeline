<script lang="ts">
  import { projects, getSelectedProject, loadProjects, createProject, deleteProject, selectProject } from './lib/state/project.svelte';
  import { settingsState, openSettings, loadSettings } from './lib/state/settings.svelte';
  import { themeState, toggleTheme } from './lib/state/theme.svelte';
  import ProjectDetail from './lib/components/ProjectDetail.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import Icon from './lib/components/ui/Icon.svelte';
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
    if (newProjectName.trim()) {
      createProject(newProjectName.trim())
        .then(() => {
          newProjectName = '';
          showCreateDialog = false;
        })
        .catch((error) => {
          console.error('Failed to create project:', error);
        });
    }
  }

  function handleBackToProjects() {
    selectProject(null);
  }

  async function handleDeleteProject(projectId: number, projectName: string) {
    if (deletingProjectId === projectId) return;

    const confirmed = window.confirm(
      `Delete project "${projectName}"?\n\nThis permanently deletes the project and all related chapters, clips, transcripts, and waveform data.`
    );

    if (!confirmed) {
      return;
    }

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

    if (projectId === null) {
      return;
    }

    void handleDeleteProject(projectId, projectName);
  }

  $effect(() => {
    if (!projectContextMenu.open) return;

    const handleWindowPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.project-context-menu')) return;
      closeProjectContextMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeProjectContextMenu();
      }
    };

    const handleResize = () => {
      closeProjectContextMenu();
    };

    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<div class="app">
  <header>
    <h1>VOD Pipeline</h1>
    <button class="settings-btn theme-toggle" onclick={toggleTheme} title="Toggle theme">
      {#if themeState.current === 'dark'}<Icon icon={Sun} size={18} />{:else}<Icon icon={Moon} size={18} />{/if}
    </button>
    <button class="settings-btn" onclick={openSettings} title="Settings">
      <Icon icon={Settings} size={18} />
      Settings
    </button>
  </header>

  <main class="container" class:project-open={selectedProject !== null}>
    <!-- Projects View -->
    {#if !selectedProject}
      <section class="projects-section">
        <div class="section-header">
          <h2>Projects</h2>
          <button onclick={() => showCreateDialog = true}>New Project</button>
        </div>

        {#if projects.loading}
          <p class="loading">Loading projects...</p>
        {:else if projects.error}
          <p class="error">{projects.error}</p>
        {:else if projects.items.length === 0}
          <p class="empty">No projects yet. Create one to get started!</p>
        {:else}
          <div class="projects-grid">
            {#each projects.items as project (project.id)}
              <div 
                class="project-card" 
                onclick={() => selectProject(project.id)}
                oncontextmenu={(event) => openProjectContextMenu(event, project.id, project.name)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectProject(project.id);
                  }
                }}
                role="button"
                tabindex="0"
              >
                <div class="project-thumbnail">
                  <span class="project-icon"><Icon icon={Video} size={20} /></span>
                </div>
                <div class="project-info">
                  <h3>{project.name}</h3>
                  <p class="project-date">
                    {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            {/each}
          </div>

          {#if projectContextMenu.open}
            <div
              class="project-context-menu"
              role="menu"
              style={`left: ${projectContextMenu.x}px; top: ${projectContextMenu.y}px;`}
            >
              <button
                type="button"
                class="project-context-item"
                role="menuitem"
                disabled={deletingProjectId === projectContextMenu.projectId}
                onclick={handleContextDelete}
              >
                {deletingProjectId === projectContextMenu.projectId
                  ? 'Deleting...'
                  : 'Delete project'}
              </button>
            </div>
          {/if}
        {/if}
      </section>

      <!-- Create Project Dialog -->
      {#if showCreateDialog}
        <div class="dialog-overlay" onclick={() => showCreateDialog = false}>
          <div class="dialog" onclick={(e) => e.stopPropagation()}>
            <h2>Create New Project</h2>
            <input 
              type="text" 
              bind:value={newProjectName} 
              placeholder="Project name" 
              onkeydown={(e) => {
                if (e.key === 'Enter' && newProjectName.trim()) {
                  handleCreateProject();
                }
              }}
            />
            <div class="dialog-actions">
              <button onclick={() => showCreateDialog = false}>Cancel</button>
              <button 
                class="primary" 
                onclick={handleCreateProject} 
                disabled={!newProjectName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      {/if}
      
    {:else if selectedProject}
      <!-- Project Detail View with Timeline Editor -->
      <ProjectDetail 
        project={selectedProject} 
        onBack={handleBackToProjects}
      />
    {/if}
    
    <!-- Settings Panel - rendered outside conditional so it works from any view -->
    <SettingsPanel />
  </main>
</div>

<style>
  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    background: var(--surface-page);
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font-sans);
  }

  :global(*) {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }

  :global(*::-webkit-scrollbar) {
    width: var(--scrollbar-width);
    height: var(--scrollbar-width);
  }

  :global(*::-webkit-scrollbar-track) {
    background: var(--scrollbar-track);
  }

  :global(*::-webkit-scrollbar-thumb) {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-pill);
  }

  :global(*::-webkit-scrollbar-thumb:hover) {
    background: var(--scrollbar-thumb-hover);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--surface-raised);
    color: var(--text-primary);
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--border-default);
  }

  header h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .settings-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .settings-btn:hover {
    background: var(--surface-active);
    color: var(--text-primary);
    border-color: #555;
  }

  .container {
    flex: 1;
    overflow: auto;
    padding: 2rem;
  }

  .container.project-open {
    padding: 0;
    overflow: hidden;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .section-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  button {
    padding: 0.5rem 1rem;
    background: #007bff;
    color: var(--text-primary);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.875rem;
  }

  button:hover {
    background: #0056b3;
  }

  button.primary {
    background: #28a745;
  }

  button.primary:hover {
    background: #218838;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading, .error, .empty {
    text-align: center;
    padding: 2rem;
    color: var(--text-disabled);
  }

  .error {
    color: #dc3545;
  }

  .projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1.5rem;
  }

  .project-card {
    background: var(--text-primary);
    border: 1px solid var(--text-secondary);
    border-radius: var(--radius-lg);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .project-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .project-context-menu {
    position: fixed;
    z-index: 1200;
    min-width: 220px;
    padding: 0.25rem;
    background: var(--surface-raised);
    border: 1px solid #3a3a3a;
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  }

  .project-context-item {
    width: 100%;
    padding: 0.5rem 0.75rem;
    text-align: left;
    border: none;
    background: transparent;
    color: #f4f4f5;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    line-height: 1.2;
  }

  .project-context-item:hover:not(:disabled) {
    background: #4d1b1b;
    color: #ffd5d5;
  }

  .project-context-item:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .project-thumbnail {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .project-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .project-info {
    padding: 1rem;
  }

  .project-info h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .project-date {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-disabled);
  }

  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: var(--text-primary);
    border-radius: var(--radius-lg);
    padding: 2rem;
    width: 100%;
    max-width: 400px;
  }

  .dialog h2 {
    margin-top: 0;
  }

  .dialog input {
    width: 100%;
    padding: 0.5rem;
    margin: 1rem 0;
    border: 1px solid var(--text-secondary);
    border-radius: var(--radius-sm);
    font-size: 1rem;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .project-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .project-header h2 {
    margin: 0;
  }

  .project-content {
    padding: 2rem;
    background: #f5f5f5;
    border-radius: var(--radius-lg);
  }

  .placeholder {
    text-align: center;
    color: var(--text-disabled);
  }
</style>
