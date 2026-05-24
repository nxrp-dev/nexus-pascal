import * as fs from 'fs';
import * as vscode from 'vscode';

import { FpcItem } from './providers/fpcItem';
import { ProjectType } from './providers/projectType';
import { ProjectTemplateManager } from './providers/projectTemplate';
import { BuildMode, FpcTask, LazarusTask } from './vscode/vscodeTask';
import { FpcTaskProvider, LazarusTaskProvider } from './vscode/vscodeTaskProvider';
import { ExtensionPaths } from './services/extensionPaths';
import { PascalProjectModelService } from './services/pascalProjectModelService';
import { PascalTaskFactory } from './services/pascalTaskFactory';
import { LanguageClientHandle } from './services/languageClientHandle';
import { WorkspaceTasksService } from './services/workspaceTasksService';

const BUILD_LABELS = ['debug', 'release', 'Other ...'];
const COMMANDS = {
    build: 'nexusPascal.project.build',
    rebuild: 'nexusPascal.project.rebuild',
    openSetting: 'nexusPascal.project.opensetting',
    newProject: 'nexusPascal.project.newproject',
    newFromTemplate: 'nexusPascal.project.newfromtemplate',
    add: 'nexusPascal.project.add',
    setDefault: 'nexusPascal.project.setdefault',
    openWithLazarus: 'nexusPascal.project.openWithLazarus',
    selectFpcSourceDirectory: 'nexusPascal.languageServer.selectFpcSourceDirectory',
    completeCode: 'nexusPascal.code.complete'
};

export class FpcCommandManager {
    private readonly templateManager: ProjectTemplateManager;

    constructor(
        private readonly workspaceRoot: string,
        private readonly taskProvider: FpcTaskProvider,
        private readonly lazarusTaskProvider: LazarusTaskProvider,
        extensionPaths: ExtensionPaths,
        private readonly projectModelService: PascalProjectModelService,
        private readonly taskFactory: PascalTaskFactory,
        private readonly workspaceTasks: WorkspaceTasksService,
        private readonly refreshProjects: () => void,
        private readonly languageClient: LanguageClientHandle
    ) {
        this.templateManager = new ProjectTemplateManager(workspaceRoot, extensionPaths, workspaceTasks);
    }

    public registerAll(context: vscode.ExtensionContext): void {
        this.registerCommand(context, COMMANDS.build, this.projectBuild);
        this.registerCommand(context, COMMANDS.rebuild, this.projectRebuild);
        this.registerCommand(context, COMMANDS.openSetting, this.projectOpen);
        this.registerCommand(context, COMMANDS.newProject, this.projectNew);
        this.registerCommand(context, COMMANDS.newFromTemplate, this.projectNew);
        this.registerCommand(context, COMMANDS.add, this.projectAdd);
        this.registerCommand(context, COMMANDS.setDefault, this.projectSetDefault);
        this.registerCommand(context, COMMANDS.openWithLazarus, this.openWithLazarus);
        this.registerCommand(context, COMMANDS.selectFpcSourceDirectory, this.selectFpcSourceDirectory);

        context.subscriptions.push(
            vscode.commands.registerTextEditorCommand(COMMANDS.completeCode, this.codeComplete)
        );
    }

    private registerCommand(
        context: vscode.ExtensionContext,
        command: string,
        handler: (...args: any[]) => unknown
    ): void {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler));
    }

    private projectAdd = async (node?: FpcItem): Promise<void> => {
        if (!node || node.level !== 0) {
            return;
        }

        if (node.projectType === ProjectType.Lazarus) {
            vscode.window.showInformationMessage(
                'Lazarus build configurations are managed by the Lazarus project file.'
            );
            return;
        }

        const label = await this.askForBuildLabel();
        if (!label) {
            return;
        }

        const tasks = this.workspaceTasks.getAllTasks();
        const finalLabel = this.workspaceTasks.getUniqueFpcTaskLabel(label, node.label, tasks);
        if (!finalLabel) {
            vscode.window.showWarningMessage(`Task "${label}" already exists for this project. Skipping task creation.`);
            return;
        }

        tasks.push(this.workspaceTasks.createFpcTask(finalLabel, node.label));

        await this.workspaceTasks.updateTasks(tasks);
    };

    private projectBuild = async (node?: FpcItem): Promise<void> => {
        await this.executeProjectTask(node, false);
    };

    private projectRebuild = async (node?: FpcItem): Promise<void> => {
        await this.executeProjectTask(node, true);
    };

    private projectOpen = async (node?: FpcItem): Promise<void> => {
        const tasksFile = this.workspaceTasks.getTaskFilePath();
        if (!fs.existsSync(tasksFile)) {
            vscode.window.showErrorMessage('Task configuration file not found.');
            return;
        }

        const document = await vscode.workspace.openTextDocument(tasksFile);
        const selection = this.findTaskSelection(document, node?.label);
        await vscode.window.showTextDocument(document, { selection });
    };

    private selectFpcSourceDirectory = async (): Promise<void> => {
        const config = vscode.workspace.getConfiguration('nexusPascal.languageServer');
        const currentPath = config.get<string>('fpcSourceDirectory');
        const defaultUri = currentPath && fs.existsSync(currentPath)
            ? vscode.Uri.file(currentPath)
            : undefined;

        const selectedFolders = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
            title: 'Select Free Pascal Source Directory'
        });

        const selectedFolder = selectedFolders?.[0];
        if (!selectedFolder) {
            return;
        }

        await config.update('fpcSourceDirectory', selectedFolder.fsPath, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.openSettings', 'nexusPascal.languageServer.fpcSourceDirectory');
    };

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

    private projectSetDefault = async (node?: FpcItem): Promise<void> => {
        if (!node || node.level !== 1 || !node.target) {
            return;
        }

        await this.projectModelService.setDefaultTarget(node.target);
        await this.refreshProjectExplorer();
        await this.restartLanguageServer();
    };

    private openWithLazarus = async (node?: FpcItem): Promise<void> => {
        if (!node || node.level !== 0 || node.projectType !== ProjectType.Lazarus) {
            vscode.window.showErrorMessage('This command is only available for Lazarus projects.');
            return;
        }

        const projectFile = this.workspaceTasks.resolveWorkspacePath(node.file);
        if (!fs.existsSync(projectFile)) {
            vscode.window.showErrorMessage(`Project file not found: ${projectFile}`);
            return;
        }

        try {
            await vscode.env.openExternal(vscode.Uri.file(projectFile));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open with default application: ${error}`);
        }
    };

    private codeComplete = (textEditor: vscode.TextEditor): void => {
        this.languageClient.completeCode(textEditor);
    };

    private async executeProjectTask(node: FpcItem | undefined, rebuild: boolean): Promise<void> {
        if (!node || node.level === 0) {
            return;
        }

        if (!node.target) {
            vscode.window.showErrorMessage('Invalid project task.');
            return;
        }

        const task = this.taskFactory.createTask(node.target);
        if (rebuild) {
            this.setTaskBuildMode(task, BuildMode.rebuild);
        }

        await vscode.tasks.executeTask(task);
    }

    private setTaskBuildMode(task: vscode.Task, buildMode: BuildMode): void {
        const liveTask =
            this.taskProvider.taskMap.get(task.name) ||
            this.lazarusTaskProvider.taskMap.get(task.name) ||
            task;

        if (liveTask instanceof FpcTask || liveTask instanceof LazarusTask) {
            liveTask.BuildMode = buildMode;
        }
    }

    private async askForBuildLabel(): Promise<string | undefined> {
        const selected = await vscode.window.showQuickPick(BUILD_LABELS, { canPickMany: false });
        if (!selected) {
            return undefined;
        }

        if (selected !== 'Other ...') {
            return selected;
        }

        const customLabel = await vscode.window.showInputBox({ prompt: 'Input build label:' });
        return customLabel?.trim() || undefined;
    }

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

    private findTaskSelection(document: vscode.TextDocument, label?: string): vscode.Selection | undefined {
        if (!label) {
            return undefined;
        }

        const offset = document.getText().indexOf(`"label": "${label}"`);
        if (offset < 0) {
            return undefined;
        }

        const position = document.positionAt(offset);
        return new vscode.Selection(position, position);
    }

    private async refreshProjectExplorer(): Promise<void> {
        this.refreshProjects();
    }

    private async restartLanguageServer(): Promise<void> {
        await this.languageClient.restart();
    }
}
