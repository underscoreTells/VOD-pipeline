export interface CreateProjectResult {
  success: boolean;
  data?: { id: number; name: string; created_at: string; updated_at: string };
  error?: string;
}

export interface GetProjectsResult {
  success: boolean;
  data?: Array<{ id: number; name: string; created_at: string; updated_at: string }>;
  error?: string;
}

export interface GetProjectResult {
  success: boolean;
  data?: { id: number; name: string; created_at: string; updated_at: string };
  error?: string;
}

export async function createProject(name: string): Promise<CreateProjectResult> {
  return await window.electronAPI.projects.create(name);
}

export async function getProjects(): Promise<GetProjectsResult> {
  return await window.electronAPI.projects.getAll();
}

export async function getProject(id: number): Promise<GetProjectResult> {
  return await window.electronAPI.projects.get(id);
}
