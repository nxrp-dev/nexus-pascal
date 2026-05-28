import * as vscode from 'vscode';
import { ProjectTemplateManager } from '../providers/projectTemplate';
import { ExtensionPaths } from '../services/extensionPaths';
import { WorkspaceTasksService } from '../services/workspaceTasksService';

export class TemplateCommandHandler {
    private readonly templateManager: ProjectTemplateManager;

    public constructor(
        workspaceRoot: string,
        extensionPaths: ExtensionPaths,
        workspaceTasks: WorkspaceTasksService
    ) {
        this.templateManager = new ProjectTemplateManager(workspaceRoot, extensionPaths, workspaceTasks);
    }

    public register(context: vscode.ExtensionContext): void {
        this.registerCommand(context, 'nexusPascal.project.newproject', this.projectNew);
        this.registerCommand(context, 'nexusPascal.project.newfromtemplate', this.projectNew);
    }

    private registerCommand(
        context: vscode.ExtensionContext,
        command: string,
        handler: (...args: any[]) => unknown
    ): void {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler));
    }

    private projectNew = async (): Promise<void> => {
        try {
            const selectedTemplate = await this.templateManager.selectTemplate();
            if (!selectedTemplate) {
                return;
            }

            const projectName = await this.askForProjectName();
            if (!projectName) {
                return;
            }

            await this.templateManager.createProjectFromTemplate(selectedTemplate, projectName);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create project from starter: ${error}`);
        }
    };

    private async askForProjectName(): Promise<string | undefined> {
        const value = await vscode.window.showInputBox({
            prompt: 'Enter project name',
            value: 'newproject',
            validateInput: (value: string) => {
                const trimmed = value.trim();
                if (!trimmed) {
                    return 'Project name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                    return 'Project name can only contain letters, numbers, underscores and hyphens';
                }
                return null;
            }
        });
        return value?.trim() || undefined;
    }
}
