import * as path from 'path';
import * as vscode from 'vscode';
import { WizardDefinition, WizardDetail, WizardField, WizardMessage, WizardOutput, WizardPlan } from '../wizard/wizardTypes';
import { ProjectCreationService } from './projectCreationService';
import {
    ProjectCreationKind,
    ProjectCreationPlan,
    ProjectCreationRequest,
    ProjectCreationTemplateOption
} from './projectCreationTypes';

export interface ProjectCreationWizardPlan extends WizardPlan {
    request: ProjectCreationRequest;
    projectPlan: ProjectCreationPlan;
}

export class ProjectCreationWizardDefinition implements WizardDefinition<ProjectCreationRequest, ProjectCreationWizardPlan> {
    public readonly id: string;
    public readonly title: string;

    public constructor(
        private readonly creationService: ProjectCreationService,
        private readonly initialKind: ProjectCreationKind
    ) {
        this.id = `nexusProjectWizard:${initialKind}`;
        this.title = this.kindTitle(initialKind);
    }

    public async getInitialRequest(): Promise<ProjectCreationRequest> {
        const kind = this.initialKind;
        const templateId = await this.defaultTemplateId(kind);

        return {
            kind,
            templateId,
            projectName: 'newproject',
            targetDir: this.creationService.getWorkspaceRoot()
        };
    }

    public async getFields(request: ProjectCreationRequest): Promise<WizardField[]> {
        const normalized = await this.normalizeRequest(request);
        const templates = await this.creationService.getTemplates(normalized.kind);

        return [
            {
                id: 'templateId',
                label: 'Starter',
                type: 'select',
                value: this.resolveTemplateId(normalized.templateId, templates),
                options: templates.map(template => ({
                    value: template.id,
                    label: template.name
                })),
                hidden: normalized.kind === 'nexus'
            },
            {
                id: 'projectName',
                label: 'Project Name',
                type: 'text',
                value: normalized.projectName,
                required: true
            },
            {
                id: 'targetDir',
                label: 'Destination Folder',
                type: 'folder',
                value: normalized.targetDir,
                required: true,
                browseLabel: 'Select Project Folder'
            }
        ];
    }

    public async createPlan(request: ProjectCreationRequest): Promise<ProjectCreationWizardPlan> {
        const normalized = await this.normalizeRequest(request);
        const plan = await this.creationService.createPlan(normalized);

        return {
            title: this.title,
            summary: plan.templateName
                ? `${plan.templateName} "${plan.projectName}" in ${plan.targetDir}`
                : 'Choose project options.',
            canExecute: plan.canCreate,
            messages: this.createMessages(plan),
            outputs: this.createOutputs(plan),
            details: this.createDetails(plan),
            request: normalized,
            projectPlan: plan
        };
    }

    public async execute(request: ProjectCreationRequest, _plan: ProjectCreationWizardPlan): Promise<void> {
        const normalized = await this.normalizeRequest(request);
        await this.creationService.execute(normalized);
        vscode.window.showInformationMessage(`Project created: ${normalized.projectName}`);
    }

    private async normalizeRequest(request: ProjectCreationRequest): Promise<ProjectCreationRequest> {
        const kind = this.normalizeKind(request.kind);
        const templates = await this.creationService.getTemplates(kind);
        const templateId = kind === 'nexus'
            ? undefined
            : this.resolveTemplateId(request.templateId, templates);

        return {
            kind,
            templateId,
            projectName: String(request.projectName || ''),
            targetDir: String(request.targetDir || this.creationService.getWorkspaceRoot())
        };
    }

    private normalizeKind(kind: string | undefined): ProjectCreationKind {
        if (kind === 'fpc' || kind === 'lazarus' || kind === 'nexus') {
            return kind;
        }

        return this.initialKind;
    }

    private async defaultTemplateId(kind: ProjectCreationKind): Promise<string | undefined> {
        if (kind === 'nexus') {
            return undefined;
        }

        const templates = await this.creationService.getTemplates(kind);
        return templates[0]?.id;
    }

    private resolveTemplateId(templateId: string | undefined, templates: ProjectCreationTemplateOption[]): string | undefined {
        if (templateId && templates.some(template => template.id === templateId)) {
            return templateId;
        }

        return templates[0]?.id;
    }

    private createMessages(plan: ProjectCreationPlan): WizardMessage[] {
        const validationSeverity = plan.canCreate ? 'warning' : 'error';
        return [
            ...plan.warnings.map(text => ({ severity: validationSeverity as 'warning' | 'error', text })),
            ...plan.collisions.map(fileName => ({
                severity: 'warning' as const,
                text: `Existing file may be overwritten: ${fileName}`
            }))
        ];
    }

    private createOutputs(plan: ProjectCreationPlan): WizardOutput[] {
        return plan.files.map(fileName => ({
            label: 'File',
            path: path.join(plan.targetDir, fileName)
        }));
    }

    private createDetails(plan: ProjectCreationPlan): WizardDetail[] {
        return [
            { label: 'Project type', value: this.kindLabel(plan.kind) },
            { label: 'Starter', value: plan.templateName || '(none selected)' },
            { label: 'Destination', value: plan.targetDir }
        ];
    }

    private kindLabel(kind: ProjectCreationKind): string {
        switch (kind) {
            case 'fpc':
                return 'Free Pascal';
            case 'lazarus':
                return 'Lazarus';
            case 'nexus':
                return 'Nexus Project';
        }
    }

    private kindTitle(kind: ProjectCreationKind): string {
        switch (kind) {
            case 'fpc':
                return 'New Free Pascal Project';
            case 'lazarus':
                return 'New Lazarus Project';
            case 'nexus':
                return 'New Nexus Project';
        }
    }
}
