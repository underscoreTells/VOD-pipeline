export interface Project {
    id: number;
    name: string;
    created_at: string;
    updated_at: string;
}
export declare const projects: {
    items: Project[];
    loading: boolean;
    error: string | null;
    selectedId: number | null;
};
export declare function getSelectedProject(): Project | null;
export declare function loadProjects(): Promise<void>;
export declare function createProject(name: string): Promise<void>;
export declare function deleteProject(id: number): Promise<void>;
export declare function selectProject(id: number | null): void;
