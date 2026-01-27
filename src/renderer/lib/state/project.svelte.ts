import { getProjects, type CreateProjectResult, type GetProjectsResult } from './electron.svelte';

export interface Project {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export const projects = $state({
  items: [] as Project[],
  loading: false,
  error: null as string | null,
  selectedId: null as number | null,
});

export function getSelectedProject(): Project | null {
  return projects.items.find((p) => p.id === projects.selectedId) ?? null;
}

export async function loadProjects() {
  projects.loading = true;
  projects.error = null;

  try {
    const result: GetProjectsResult = await getProjects();
    if (result.success && result.data) {
      projects.items = result.data;
    } else {
      projects.error = result.error ?? 'Failed to load projects';
    }
  } catch (error) {
    projects.error = (error as Error).message;
  } finally {
    projects.loading = false;
  }
}

export async function createProject(name: string) {
  try {
    const result: CreateProjectResult = await createProject(name);
    if (result.success && result.data) {
      projects.items = [result.data, ...projects.items];
      projects.selectedId = result.data.id;
    } else {
      throw new Error(result.error ?? 'Failed to create project');
    }
  } catch (error) {
    projects.error = (error as Error).message;
    throw error;
  }
}

export async function deleteProject(id: number) {
  // Placeholder - will implement in Phase 3
  console.log('Delete project:', id);
}

export function selectProject(id: number | null) {
  projects.selectedId = id;
}
