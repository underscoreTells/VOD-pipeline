import type {
  CreateProjectResult,
  DeleteProjectResult,
  GetProjectResult,
  GetProjectsResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  CreateProjectResult,
  DeleteProjectResult,
  GetProjectResult,
  GetProjectsResult,
} from '../../../shared/contracts/electron-api.js';

export async function createProject(name: string): Promise<CreateProjectResult> {
  return await getElectronApi().projects.create(name);
}

export async function getProjects(): Promise<GetProjectsResult> {
  return await getElectronApi().projects.getAll();
}

export async function getProject(id: number): Promise<GetProjectResult> {
  return await getElectronApi().projects.get(id);
}

export async function deleteProject(id: number): Promise<DeleteProjectResult> {
  return await getElectronApi().projects.delete(id);
}
