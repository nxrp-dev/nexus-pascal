import * as path from 'path';
import * as vscode from 'vscode';
import { PascalBuildTarget } from '../model/pascalProject';
import { DefaultBuildModeStorage } from '../providers/defaultBuildModeStorage';
import {
    FpcTaskDefinition,
    isFpcTaskDefinition,
    isLazarusTaskDefinition,
    NexusTaskDefinition
} from '../providers/taskDefinitions';
import { FpcTaskProvider, LazarusTaskProvider } from '../vscode/vscodeTaskProvider';

export class WorkspaceTasksService {
    public constructor(private readonly workspaceRoot: string) {
    }

    public getTaskFileUri(): vscode.Uri {
        return vscode.Uri.file(path.join(this.workspaceRoot, '.vscode', 'tasks.json'));
    }

    public getTaskFilePath(): string {
        return this.getTaskFileUri().fsPath;
    }

    public getAllTasks(resource?: vscode.Uri): any[] {
        return vscode.workspace
            .getConfiguration('tasks', resource ?? vscode.Uri.file(this.workspaceRoot))
            .get<any[]>('tasks', []);
    }

    public getTasks(): NexusTaskDefinition[] {
        return this.getAllTasks().filter((task): task is NexusTaskDefinition => this.isNexusPascalTask(task));
    }

    public async updateTasks(tasks: any[]): Promise<void> {
        await vscode.workspace
            .getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot))
            .update('tasks', tasks, vscode.ConfigurationTarget.WorkspaceFolder);
    }

    public findTaskByLabel(label: string, tasks: any[] = this.getAllTasks()): any | undefined {
        return tasks.find(task => this.getTaskLabel(task) === label);
    }

    public getTaskLabel(task: any): string | undefined {
        const label = task?.label ?? task?.taskName;
        return typeof label === 'string' ? label : undefined;
    }

    public getDefaultBuildTask(tasks: any[] = this.getAllTasks()): any | undefined {
        return tasks.find(task => this.isDefaultBuildTask(task));
    }

    public isDefaultBuildTask(task: any): boolean {
        return typeof task?.group === 'object'
            && task.group.kind === 'build'
            && task.group.isDefault === true;
    }

    public hasDefaultBuildTask(tasks: any[]): boolean {
        return tasks.some(task => this.isDefaultBuildTask(task));
    }

    public isNexusPascalTask(task: any): task is NexusTaskDefinition {
        return isFpcTaskDefinition(task) || isLazarusTaskDefinition(task);
    }

    public isDefaultLazarusBuildMode(projectFile: string, label: string): boolean {
        return DefaultBuildModeStorage.getInstance().isDefaultBuildMode(this.getLazarusBuildModeId(projectFile, label));
    }

    public async setDefaultBuildTarget(target: PascalBuildTarget): Promise<void> {
        if (target.kind === 'lazarus') {
            await this.setDefaultLazarusTarget(target);
            return;
        }

        await this.setDefaultFpcTarget(target);
    }

    public resolveWorkspacePath(value: string | undefined, basePath: string = this.workspaceRoot): string {
        if (!value) {
            return basePath;
        }

        const resolved = value.replace(/\$\{workspaceFolder\}/g, this.workspaceRoot);
        if (path.isAbsolute(resolved)) {
            return resolved;
        }

        return path.resolve(basePath, resolved);
    }

    public createFpcTask(label: string, file: string): FpcTaskDefinition {
        const task = new FpcTaskDefinition();
        task.label = label;
        task.file = file;
        task.buildOption = {
            syntaxMode: 'ObjFPC',
            unitOutputDir: './out'
        };
        return task;
    }

    public getUniqueFpcTaskLabel(label: string, projectLabel: string, tasks: any[] = this.getAllTasks()): string | undefined {
        const currentProjectName = path.basename(projectLabel, path.extname(projectLabel));
        const duplicateTasks = tasks.filter(task => this.getTaskLabel(task) === label);

        if (duplicateTasks.length === 0) {
            return label;
        }

        const hasDifferentProjectTask = duplicateTasks.some(task => {
            const taskFile = typeof task.file === 'string' ? task.file : '';
            const taskProjectName = path.basename(taskFile, path.extname(taskFile));
            return taskProjectName !== currentProjectName;
        });

        if (!hasDifferentProjectTask) {
            return undefined;
        }

        const projectLabelTask = `${label}-${currentProjectName}`;
        return tasks.some(task => this.getTaskLabel(task) === projectLabelTask)
            ? undefined
            : projectLabelTask;
    }

    private async setDefaultFpcTarget(target: PascalBuildTarget & { kind: 'fpc' }): Promise<void> {
        DefaultBuildModeStorage.getInstance().setDefaultBuildMode('');
        const tasks = this.getAllTasks();
        let tasksUpdated = false;

        for (const task of tasks) {
            const taskType = String(task?.type).toLowerCase();
            if (taskType !== FpcTaskProvider.FpcTaskType && taskType !== LazarusTaskProvider.LazarusTaskType) {
                continue;
            }

            const isTargetTask = taskType === FpcTaskProvider.FpcTaskType
                && this.getTaskLabel(task) === target.label
                && this.resolveWorkspacePath(task.file, this.resolveWorkspacePath(task.cwd)) === target.projectFile;

            if (this.applyDefaultFlag(task, isTargetTask)) {
                tasksUpdated = true;
            }
        }

        if (tasksUpdated) {
            await this.updateTasks(tasks);
        }
    }

    private async setDefaultLazarusTarget(target: PascalBuildTarget & { kind: 'lazarus' }): Promise<void> {
        DefaultBuildModeStorage.getInstance().setDefaultBuildMode(this.getLazarusBuildModeId(target.projectFile, target.label));
        const tasks = this.getAllTasks();
        let tasksUpdated = false;

        for (const task of tasks) {
            const taskType = String(task?.type).toLowerCase();
            if (taskType !== FpcTaskProvider.FpcTaskType && taskType !== LazarusTaskProvider.LazarusTaskType) {
                continue;
            }

            const isTargetTask = taskType === LazarusTaskProvider.LazarusTaskType
                && this.getTaskLabel(task) === target.label
                && this.resolveWorkspacePath(task.project, this.resolveWorkspacePath(task.cwd)) === target.projectFile;

            if (this.applyDefaultFlag(task, isTargetTask)) {
                tasksUpdated = true;
            }
        }

        if (tasksUpdated) {
            await this.updateTasks(tasks);
        }
    }

    private applyDefaultFlag(task: any, isTargetTask: boolean): boolean {
        if (!task.group && !isTargetTask) {
            return false;
        }
        if (!task.group) {
            task.group = { kind: 'build' };
        }

        const desiredDefault = isTargetTask ? true : undefined;
        if (task.group.isDefault === desiredDefault) {
            return false;
        }

        task.group.isDefault = desiredDefault;
        return true;
    }

    private getLazarusBuildModeId(projectFile: string, label: string): string {
        return `${projectFile}-${label}`;
    }
}
