import * as fs from 'fs';
import * as path from 'path';
import { ProjectTemplate, ProjectTemplateManager } from '../providers/projectTemplate';
import {
    ProjectCreationKind,
    ProjectCreationPlan,
    ProjectCreationRequest,
    ProjectCreationTemplateOption
} from './projectCreationTypes';

export class ProjectCreationService {
    private static readonly NexusTemplateId = 'nexus:descriptor';

    public constructor(
        private readonly workspaceRoot: string,
        private readonly templateManager: ProjectTemplateManager
    ) {
    }

    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    public async getTemplates(kind: ProjectCreationKind): Promise<ProjectCreationTemplateOption[]> {
        if (kind === 'nexus') {
            return [{
                id: ProjectCreationService.NexusTemplateId,
                name: 'Nexus Project',
                kind
            }];
        }

        const category = kind === 'lazarus'
            ? ProjectTemplateManager.LazarusCategory
            : ProjectTemplateManager.FreePascalCategory;
        const templates = await this.templateManager.getAvailableTemplatesFromCategory(category);

        return templates.map(template => ({
            id: template.sourcePath,
            name: template.name,
            kind,
            sourcePath: template.sourcePath
        }));
    }

    public async createPlan(request: ProjectCreationRequest): Promise<ProjectCreationPlan> {
        const warnings = this.validateRequest(request);
        const template = await this.resolveTemplate(request);

        if (request.kind === 'nexus') {
            const descriptorFile = path.join(request.targetDir, 'nexus.project.json');
            const collisions = this.fileExistsWarningPath(descriptorFile);
            return {
                kind: request.kind,
                templateName: 'Nexus Project',
                projectName: request.projectName,
                targetDir: request.targetDir,
                files: ['nexus.project.json'],
                collisions,
                warnings,
                canCreate: warnings.length === 0
            };
        }

        if (!template) {
            return {
                kind: request.kind,
                templateName: '',
                projectName: request.projectName,
                targetDir: request.targetDir,
                files: [],
                collisions: [],
                warnings: [...warnings, 'Select a project starter.'],
                canCreate: false
            };
        }

        const files = this.templateManager.getPlannedFiles(template, request.projectName);
        const collisions = this.templateManager.getCollisions(template, request.targetDir, request.projectName);

        return {
            kind: request.kind,
            templateName: template.name,
            projectName: request.projectName,
            targetDir: request.targetDir,
            files,
            collisions,
            warnings,
            canCreate: warnings.length === 0
        };
    }

    public async execute(request: ProjectCreationRequest): Promise<void> {
        const plan = await this.createPlan(request);
        if (!plan.canCreate) {
            throw new Error(plan.warnings.join(' '));
        }

        if (request.kind === 'nexus') {
            await this.templateManager.createNexusProject(request.projectName, request.targetDir);
            return;
        }

        const template = await this.resolveTemplate(request);
        if (!template) {
            throw new Error('Project starter was not found.');
        }

        await this.templateManager.createProjectFromTemplate(template, request.projectName, request.targetDir);
    }

    private async resolveTemplate(request: ProjectCreationRequest): Promise<ProjectTemplate | undefined> {
        if (request.kind === 'nexus' || !request.templateId) {
            return undefined;
        }

        const templates = await this.getTemplates(request.kind);
        const selected = templates.find(template => template.id === request.templateId);
        if (!selected?.sourcePath) {
            return undefined;
        }

        return {
            name: selected.name,
            sourcePath: selected.sourcePath
        };
    }

    private validateRequest(request: ProjectCreationRequest): string[] {
        const warnings: string[] = [];
        const projectName = request.projectName.trim();

        if (!projectName) {
            warnings.push('Project name is required.');
        } else if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
            warnings.push('Project name can only contain letters, numbers, underscores and hyphens.');
        }

        if (!request.targetDir.trim()) {
            warnings.push('Destination folder is required.');
        }

        return warnings;
    }

    private fileExistsWarningPath(filePath: string): string[] {
        return fs.existsSync(filePath) ? [filePath] : [];
    }
}
