import { WizardRequest } from '../wizard/wizardTypes';

export type ProjectCreationKind = 'fpc' | 'lazarus' | 'nexus';

export interface ProjectCreationTemplateOption {
    id: string;
    name: string;
    kind: ProjectCreationKind;
    sourcePath?: string;
}

export interface ProjectCreationRequest extends WizardRequest {
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
