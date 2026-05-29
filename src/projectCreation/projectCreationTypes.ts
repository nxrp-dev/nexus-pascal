export type ProjectCreationKind = 'fpc' | 'lazarus' | 'nexus';

export interface ProjectCreationTemplateOption {
    id: string;
    name: string;
    kind: ProjectCreationKind;
    sourcePath?: string;
}

export interface ProjectCreationRequest {
    kind: ProjectCreationKind;
    templateId?: string;
    projectName: string;
    targetDir: string;
}

export interface ProjectCreationPlan {
    kind: ProjectCreationKind;
    templateName: string;
    projectName: string;
    targetDir: string;
    files: string[];
    collisions: string[];
    warnings: string[];
    canCreate: boolean;
}
