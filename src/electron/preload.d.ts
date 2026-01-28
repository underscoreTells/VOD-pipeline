export interface CreateProjectResult {
    success: boolean;
    data?: {
        id: number;
        name: string;
        created_at: string;
        updated_at: string;
    };
    error?: string;
}
export interface GetProjectsResult {
    success: boolean;
    data?: Array<{
        id: number;
        name: string;
        created_at: string;
        updated_at: string;
    }>;
    error?: string;
}
export interface GetProjectResult {
    success: boolean;
    data?: {
        id: number;
        name: string;
        created_at: string;
        updated_at: string;
    };
    error?: string;
}
export interface ElectronAPI {
    projects: {
        create: (name: string) => Promise<CreateProjectResult>;
        getAll: () => Promise<GetProjectsResult>;
        get: (id: number) => Promise<GetProjectResult>;
    };
}
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
