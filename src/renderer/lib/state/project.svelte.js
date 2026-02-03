import { createProject as ipcCreateProject, getProjects } from './electron.svelte';
export const projects = $state({
    items: [],
    loading: false,
    error: null,
    selectedId: null,
});
export function getSelectedProject() {
    return projects.items.find((p) => p.id === projects.selectedId) ?? null;
}
export async function loadProjects() {
    projects.loading = true;
    projects.error = null;
    try {
        const result = await getProjects();
        if (result.success && result.data) {
            projects.items = result.data;
        }
        else {
            projects.error = result.error ?? 'Failed to load projects';
        }
    }
    catch (error) {
        projects.error = error.message;
    }
    finally {
        projects.loading = false;
    }
}
export async function createProject(name) {
    try {
        const result = await ipcCreateProject(name);
        if (result.success && result.data) {
            projects.items = [result.data, ...projects.items];
            projects.selectedId = result.data.id;
        }
        else {
            throw new Error(result.error ?? 'Failed to create project');
        }
    }
    catch (error) {
        projects.error = error.message;
        throw error;
    }
}
export async function deleteProject(id) {
    throw new Error('deleteProject not implemented');
}
export function selectProject(id) {
    projects.selectedId = id;
}
