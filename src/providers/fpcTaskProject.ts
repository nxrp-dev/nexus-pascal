import * as vscode from 'vscode';
import * as path from 'path';
import { CompileOption } from '../languageServer/options';
import { LanguageServerProjectContext } from '../languageServer/projectContext';
import { IProjectIntf, IProjectTask } from './projectIntf';
import { DefaultBuildModeStorage } from './defaultBuildModeStorage';
import { taskProvider } from './task';

export class FpcTask implements IProjectTask {
    isInLpi: boolean = false;
    constructor(
        public label: string,
        public isDefault: boolean,
        public project: IProjectIntf,
        private taskDefinition: any
    ) {}

    getCompileOption(workspaceRoot: string): CompileOption {
        return new CompileOption(this.taskDefinition, workspaceRoot);
    }

    getLanguageServerContext(workspaceRoot: string): LanguageServerProjectContext {
        const option = this.getCompileOption(workspaceRoot);
        const fpcOptions = option.toOptionString()
            .split(' ')
            .filter(value => value.length > 0 && !value.startsWith('-v'));

        return {
            kind: 'fpc',
            label: this.label,
            projectFile: option.file,
            workingDirectory: option.cwd,
            fpcOptions,
            allowFpcGlobalUnitPaths: true
        };
    }

    getTreeItem(): vscode.TreeItem {
        let displayLabel = this.label;

        if (this.taskDefinition.targetOS || this.taskDefinition.targetCPU) {
            displayLabel += '-';
            if (this.taskDefinition.targetOS) {
                displayLabel += this.taskDefinition.targetOS;
            }
            if (this.taskDefinition.targetCPU) {
                displayLabel += '-' + this.taskDefinition.targetCPU;
            }
        }

        const item = new vscode.TreeItem(displayLabel, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'fpcbuild';
        item.tooltip = `${displayLabel} (${this.project.file})`;

        if (this.isDefault) {
            item.description = 'default';
        }

        return item;
    }

    async getTask(): Promise<vscode.Task> {
        // If this is an auto-generated task (label is [default]), ensure it's saved to tasks.json
        if (this.label === '[default]' && this.project.file) {
            await this.ensureTaskInTasksJson();
        }
        
        return taskProvider.getTask(
            this.label,
            this.project.file,
            this.taskDefinition
        );
    }

    private async ensureTaskInTasksJson(): Promise<void> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                return;
            }

            const config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(workspaceRoot));
            const tasks = config.get<any[]>('tasks') || [];

            const existingTask = tasks.find(task => 
                task.type === 'fpc' && path.basename(task.file) === path.basename(this.project.file)
            );

            if (!existingTask) {
                const relFile = path.isAbsolute(this.project.file) ? path.relative(workspaceRoot, this.project.file) : this.project.file;
                const fileName = path.basename(this.project.file, path.extname(this.project.file));
                const newTask = {
                    type: 'fpc',
                    label: fileName,
                    file: relFile,
                    buildOption: {
                        unitOutputDir: './bin/${targetOS}-${targetCPU}'
                    },
                    group: {
                        kind: 'build',
                        isDefault: false
                    }
                };

                tasks.push(newTask);

                await config.update('tasks', tasks, vscode.ConfigurationTarget.WorkspaceFolder);
                console.log(`Auto-generated FPC task for ${this.project.file}`);
                
                this.taskDefinition = newTask;
                this.label = fileName;
            }
        } catch (error) {
            console.error(`Error ensuring task in tasks.json:`, error);
        }
    }

    async setAsDefault(): Promise<void> {
        // If this is an auto-generated task (label is [default]), ensure it's saved to tasks.json
        if (this.label === '[default]' && this.project.file) {
            await this.ensureTaskInTasksJson();
        }

        this.isDefault = true;
        
        const storage = DefaultBuildModeStorage.getInstance();
        storage.setDefaultBuildMode("");
        
        if (this.taskDefinition) {
            if (!this.taskDefinition.group) {
                this.taskDefinition.group = {};
            }
            this.taskDefinition.group.isDefault = true;

            try {
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot) {
                    const config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(workspaceRoot));
                    const tasks = config.get<any[]>('tasks') || [];

                    let tasksUpdated = false;
                    for (const task of tasks) {
                        if (task.type === 'fpc') {
                            if (task.label === this.label && path.basename(task.file) === path.basename(this.project.file)) {
                                if (!task.group) {
                                    task.group = { kind: 'build', isDefault: true };
                                } else {
                                    task.group.isDefault = true;
                                }
                                tasksUpdated = true;
                            } else {
                                if (task.group && task.group.isDefault) {
                                    task.group.isDefault = undefined;
                                    tasksUpdated = true;
                                }
                            }
                        }
                    }

                    if (tasksUpdated) {
                        await config.update(
                            "tasks",
                            tasks,
                            vscode.ConfigurationTarget.WorkspaceFolder
                        );
                        console.log(`Set FPC task ${this.label} as default`);
                    }
                }
            } catch (error) {
                console.error('Error setting FPC task as default:', error);
            }
        }
    }
}

export class FpcTaskProject implements IProjectIntf {
    public tasks: IProjectTask[] = [];

    constructor(
        public label: string,
        public file: string,
        isDefault: boolean,
        taskDefinitions: any[] | any = []
    ) {
        const taskDefs = Array.isArray(taskDefinitions) ? taskDefinitions : (taskDefinitions ? [taskDefinitions] : []);
        
        for (const taskDef of taskDefs) {
            if (taskDef) {
                const isTaskDefault = taskDef.group?.isDefault || false;
                this.tasks.push(new FpcTask(
                    taskDef.label || this.label,
                    isTaskDefault,
                    this,
                    taskDef
                ));
            }
        }
        
        if (this.tasks.length === 0 && this.file) {
            const defaultTask = new FpcTask(
                "[default]",
                isDefault,
                this,
                { 
                    type: 'fpc',
                    label: this.label,
                    file: this.file
                }
            );
            this.tasks.push(defaultTask);
        }
    }
}
