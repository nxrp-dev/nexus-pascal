import * as vscode from 'vscode';
import * as path from 'path';
import { FpcTaskDefinition, LazarusTaskDefinition, isFpcTaskDefinition, isLazarusTaskDefinition } from '../providers/taskDefinitions';
import { FpcTask, LazarusTask } from './vscodeTask';
import { FPC_TASK_TYPE, LAZARUS_TASK_TYPE } from './vscodeTaskTypes';

export class FpcTaskProvider implements vscode.TaskProvider {
    static FpcTaskType = FPC_TASK_TYPE;
    public taskMap: Map<string, vscode.Task> = new Map<string, vscode.Task>();

    constructor(
        private workspaceRoot: string,
        private readonly onTaskConfigurationChanged: () => void,
        private cwd: string | undefined = undefined
    ) {
    }

    public clean(): void {
        this.taskMap.clear();
    }

    public async provideTasks(): Promise<vscode.Task[]> {
        return this.getTasks();
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        if (!isFpcTaskDefinition(_task.definition)) {
            return undefined;
        }

        const definition = _task.definition;
        const file = definition.file;
        if (!file) {
            return undefined;
        }

        if (this.taskMap.has(_task.name)) {
            const task = this.taskMap.get(_task.name);
            task!.definition = definition;
            return task;
        }

        if (definition.cwd) {
            const rawCwd = definition.cwd;
            if (rawCwd.includes('${workspaceFolder}')) {
                this.cwd = rawCwd.replace(/\$\{workspaceFolder\}/g, this.workspaceRoot);
            } else if (path.isAbsolute(rawCwd)) {
                this.cwd = rawCwd;
            } else {
                this.cwd = path.join(this.workspaceRoot, rawCwd);
            }
        }

        const task = this.getTask(_task.name, file, definition);
        this.taskMap.set(_task.name, task);
        return task;
    }

    private async getTasks(): Promise<vscode.Task[]> {
        return [];
    }

    public getTask(name: string, file: string, definition: FpcTaskDefinition): vscode.Task {
        return new FpcTask(this.cwd ? this.cwd : this.workspaceRoot, name, file, definition);
    }

    public notifyTaskConfigurationChanged(): void {
        this.onTaskConfigurationChanged();
    }
}

export class LazarusTaskProvider implements vscode.TaskProvider {
    static LazarusTaskType = LAZARUS_TASK_TYPE;
    public taskMap: Map<string, vscode.Task> = new Map<string, vscode.Task>();

    constructor(private workspaceRoot: string) {
    }

    public async provideTasks(): Promise<vscode.Task[]> {
        return [];
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        if (!isLazarusTaskDefinition(_task.definition)) {
            return undefined;
        }

        const task = this.getTask(_task.name, _task.definition);
        this.taskMap.set(_task.name, task);
        return task;
    }

    public getTask(name: string, definition: LazarusTaskDefinition): vscode.Task {
        const task = new LazarusTask(this.resolveCwd(definition.cwd), name, definition);
        this.taskMap.set(name, task);
        return task;
    }

    private resolveCwd(rawCwd?: string): string {
        if (!rawCwd) {
            return this.workspaceRoot;
        }
        if (rawCwd.includes('${workspaceFolder}')) {
            return rawCwd.replace(/\$\{workspaceFolder\}/g, this.workspaceRoot);
        }
        if (path.isAbsolute(rawCwd)) {
            return rawCwd;
        }
        return path.join(this.workspaceRoot, rawCwd);
    }
}
