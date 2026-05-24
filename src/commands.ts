import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { getClient, getProjectProvider } from './services/runtime';
import { FpcItem } from './providers/fpcItem';
import { ProjectType } from './providers/projectType';
import { ProjectTemplateManager } from './providers/projectTemplate';
import { BuildMode, FpcTask, LazarusTask, lazarusTaskProvider, taskProvider } from './providers/task';

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
    private static _context: vscode.ExtensionContext;
    private readonly templateManager: ProjectTemplateManager;

    constructor(private readonly workspaceRoot: string) {
        this.templateManager = new ProjectTemplateManager(workspaceRoot);
    }

    public static setContext(context: vscode.ExtensionContext): void {
        FpcCommandManager._context = context;
    }

    public static get context(): vscode.ExtensionContext {
        if (!FpcCommandManager._context) {
            throw new Error('Extension context not initialized');
        }
        return FpcCommandManager._context;
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

        const tasks = this.getConfiguredTasks();
        const finalLabel = this.getUniqueTaskLabel(label, node, tasks);
        if (!finalLabel) {
            return;
        }

        tasks.push({
            label: finalLabel,
            file: node.label,
            type: 'fpc',
            buildOption: {
                syntaxMode: 'ObjFPC',
                unitOutputDir: './out'
            }
        });

        await this.updateConfiguredTasks(tasks);
    };

    private projectBuild = async (node?: FpcItem): Promise<void> => {
        await this.executeProjectTask(node, false);
    };

    private projectRebuild = async (node?: FpcItem): Promise<void> => {
        await this.executeProjectTask(node, true);
    };

    private projectOpen = async (node?: FpcItem): Promise<void> => {
        const tasksFile = path.join(this.workspaceRoot, '.vscode', 'tasks.json');
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
        if (!node || node.level !== 1 || !node.projectTask) {
            return;
        }

        await node.projectTask.setAsDefault();
        await this.refreshProjectExplorer();
        await this.restartLanguageServer();
    };

    private openWithLazarus = async (node?: FpcItem): Promise<void> => {
        if (!node || node.level !== 0 || node.projectType !== ProjectType.Lazarus) {
            vscode.window.showErrorMessage('This command is only available for Lazarus projects.');
            return;
        }

        const projectFile = this.resolveWorkspacePath(node.file);
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
        getClient()?.doCodeComplete(textEditor);
    };

    private async executeProjectTask(node: FpcItem | undefined, rebuild: boolean): Promise<void> {
        if (!node || node.level === 0) {
            return;
        }

        const projectTask = node.projectTask;
        if (!projectTask) {
            vscode.window.showErrorMessage('Invalid project task.');
            return;
        }

        const task = await projectTask.getTask();
        if (rebuild) {
            this.setTaskBuildMode(task, BuildMode.rebuild);
        }

        await vscode.tasks.executeTask(task);
    }

    private setTaskBuildMode(task: vscode.Task, buildMode: BuildMode): void {
        const liveTask =
            taskProvider?.taskMap.get(task.name) ||
            lazarusTaskProvider?.taskMap.get(task.name) ||
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

    private getConfiguredTasks(): any[] {
        return this.getTasksConfiguration().get<any[]>('tasks', []);
    }

    private async updateConfiguredTasks(tasks: any[]): Promise<void> {
        await this.getTasksConfiguration().update(
            'tasks',
            tasks,
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    }

    private getTasksConfiguration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));
    }

    private getUniqueTaskLabel(label: string, node: FpcItem, tasks: any[]): string | undefined {
        const currentProjectName = path.basename(node.label, path.extname(node.label));
        const duplicateTasks = tasks.filter(task => task.label === label);

        if (duplicateTasks.length === 0) {
            return label;
        }

        const hasDifferentProjectTask = duplicateTasks.some(task => {
            const taskFile = typeof task.file === 'string' ? task.file : '';
            const taskProjectName = path.basename(taskFile, path.extname(taskFile));
            return taskProjectName !== currentProjectName;
        });

        if (!hasDifferentProjectTask) {
            vscode.window.showWarningMessage(`Task "${label}" already exists for this project. Skipping task creation.`);
            return undefined;
        }

        const projectLabel = `${label}-${currentProjectName}`;
        if (tasks.some(task => task.label === projectLabel)) {
            vscode.window.showWarningMessage(`Task "${projectLabel}" already exists. Skipping task creation.`);
            return undefined;
        }

        return projectLabel;
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

    private resolveWorkspacePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.join(this.workspaceRoot, filePath);
    }

    private async refreshProjectExplorer(): Promise<void> {
        getProjectProvider()?.refresh();
    }

    private async restartLanguageServer(): Promise<void> {
        await getClient()?.restart();
    }
}
