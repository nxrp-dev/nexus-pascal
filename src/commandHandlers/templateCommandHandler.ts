import * as vscode from 'vscode';
import { ProjectCreationKind } from '../projectCreation/projectCreationTypes';
import { ProjectCreationService } from '../projectCreation/projectCreationService';
import { ProjectCreationWizardPanel } from '../projectCreation/projectCreationWizardPanel';
import { ProjectTemplateManager } from '../providers/projectTemplate';
import { ExtensionPaths } from '../services/extensionPaths';
import { WorkspaceTasksService } from '../services/workspaceTasksService';

export class TemplateCommandHandler {
    private readonly templateManager: ProjectTemplateManager;
    private readonly projectCreationService: ProjectCreationService;
    private extensionUri: vscode.Uri | undefined;

    public constructor(
        private readonly workspaceRoot: string,
        extensionPaths: ExtensionPaths,
        workspaceTasks: WorkspaceTasksService
    ) {
        this.templateManager = new ProjectTemplateManager(workspaceRoot, extensionPaths, workspaceTasks);
        this.projectCreationService = new ProjectCreationService(workspaceRoot, this.templateManager);
    }

    public register(context: vscode.ExtensionContext): void {
        this.extensionUri = context.extensionUri;
        this.registerCommand(context, 'nexusPascal.project.newproject', () => this.showProjectWizard('nexus'));
        this.registerCommand(context, 'nexusPascal.project.newFpcProject', () => this.showProjectWizard('fpc'));
        this.registerCommand(context, 'nexusPascal.project.newLazarusProject', () => this.showProjectWizard('lazarus'));
        this.registerCommand(context, 'nexusPascal.project.newNexusProject', () => this.showProjectWizard('nexus'));
    }

    private registerCommand(
        context: vscode.ExtensionContext,
        command: string,
        handler: (...args: any[]) => unknown
    ): void {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler));
    }

    private showProjectWizard = async (initialKind: ProjectCreationKind): Promise<void> => {
        try {
            await ProjectCreationWizardPanel.show(
                this.extensionUri || vscode.Uri.file(this.workspaceRoot),
                this.projectCreationService,
                initialKind
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create project: ${error}`);
        }
    };
}
