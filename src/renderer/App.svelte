<script lang="ts">
  import { projects, getSelectedProject, loadProjects, createProject, selectProject } from './lib/state/project.svelte';
  import ProjectDetail from './lib/components/ProjectDetail.svelte';

  const selectedProject = $derived.by(() => getSelectedProject());

  let newProjectName = $state('');
  let showCreateDialog = $state(false);

  $effect(() => {
    loadProjects();
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
</script>

<div class="app">
  <header>
    <h1>VOD Pipeline</h1>
  </header>

  <main class="container">
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
                  <span class="project-icon">📹</span>
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
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }

  header {
    background: #1e1e1e;
    color: white;
    padding: 1rem 2rem;
    border-bottom: 1px solid #333;
  }

  header h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .container {
    flex: 1;
    overflow: auto;
    padding: 2rem;
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
    color: white;
    border: none;
    border-radius: 4px;
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
    color: #666;
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
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .project-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .project-thumbnail {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .project-icon {
    font-size: 4rem;
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
    color: #666;
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
    background: white;
    border-radius: 8px;
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
    border: 1px solid #ddd;
    border-radius: 4px;
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
    border-radius: 8px;
  }

  .placeholder {
    text-align: center;
    color: #666;
  }
</style>
