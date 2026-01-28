import Database from 'better-sqlite3';
export declare function initializeDatabase(): Database.Database;
export declare function getDatabase(): Database.Database;
export declare function closeDatabase(): void;
export interface Project {
    id?: number;
    name: string;
    created_at?: string;
    updated_at?: string;
}
export declare function createProject(name: string): Project;
export declare function getProject(id: number): Project | null;
export declare function listProjects(): Project[];
export declare function deleteProject(id: number): boolean;
export declare function updateProject(id: number, name: string): boolean;
