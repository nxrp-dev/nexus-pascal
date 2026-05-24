import * as vscode from 'vscode';
import * as path from 'path';
import { CompileOption } from '../languageServer/options';
import { LanguageServerProjectContext } from '../languageServer/projectContext';
import { LazarusBuildTarget } from '../model/pascalProject';
import { IProjectIntf, IProjectTask } from './projectIntf';
import { DefaultBuildModeStorage } from './defaultBuildModeStorage';
import { PascalTaskFactory } from '../services/pascalTaskFactory';

export class LazarusBuildModeTask implements IProjectTask {
    public id?: string;
    public label: string;
    public project: IProjectIntf;
    public buildMode?: string;
    public isInLpi: boolean;

    public constructor(
        ALabel: string,
        AIsDefault: boolean,
        AIsInLpi: boolean,
        AProject: IProjectIntf,
        private readonly taskFactory: PascalTaskFactory,
        ABuildMode?: string,
        private readonly target?: LazarusBuildTarget
    ) {
        this.label = ALabel;
        this.project = AProject;
        this.buildMode = ABuildMode || ALabel;
        this.isInLpi = AIsInLpi;
        this.id = `${this.project.file}-${this.label}`;

        if (AIsDefault) {
            this.setAsDefault();
        }
    }

    public get isDefault(): boolean {
        return DefaultBuildModeStorage.getInstance().isDefaultBuildMode(this.id || '');
    }

    public set isDefault(AValue: boolean) {
        const lStorage = DefaultBuildModeStorage.getInstance();

        if (AValue) {
            this.setAsDefault();
            return;
        }

        if (lStorage.isDefaultBuildMode(this.id || '')) {
            lStorage.setDefaultBuildMode('');
        }
    }

    public getCompileOption(AWorkspaceRoot: string): CompileOption {
        const lOption = new CompileOption();
        lOption.type = 'lazarus';
        lOption.label = this.label;
        lOption.file = this.project.file;
        lOption.cwd = path.isAbsolute(this.project.file)
            ? path.dirname(this.project.file)
            : AWorkspaceRoot;
        lOption.buildOption = undefined;
        return lOption;
    }

    public getLanguageServerContext(AWorkspaceRoot: string): LanguageServerProjectContext {
        const lOption = this.getCompileOption(AWorkspaceRoot);

        return {
            kind: 'lazarus',
            label: this.label,
            projectFile: lOption.file,
            workingDirectory: lOption.cwd,
            buildMode: this.buildMode,
            fpcOptions: [],
            allowFpcGlobalUnitPaths: false
        };
    }

    public getTreeItem(): vscode.TreeItem {
        const lItem = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
        lItem.contextValue = 'lazarusbuildmode';
        lItem.tooltip = `${this.label} (${this.project.file})`;

        if (this.isDefault) {
            lItem.description = 'default';
        }

        return lItem;
    }

    public getTask(): vscode.Task {
        if (this.target) {
            return this.taskFactory.createTask(this.target);
        }

        return this.taskFactory.createLazarusTask(
            this.label,
            this.project.file,
            path.dirname(this.project.file),
            this.buildMode
        );
    }

    public async setAsDefault(): Promise<void> {
        DefaultBuildModeStorage.getInstance().setDefaultBuildMode(this.id || '');

        const lWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!lWorkspaceRoot) {
            return;
        }

        const lConfig = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(lWorkspaceRoot));
        const lTasks = lConfig.get<any[]>('tasks') || [];
        let lTasksUpdated = false;

        for (const lTask of lTasks) {
            if (lTask.type === 'fpc' && typeof lTask.group === 'object' && lTask.group.isDefault) {
                lTask.group.isDefault = undefined;
                lTasksUpdated = true;
            }
        }

        if (lTasksUpdated) {
            await lConfig.update('tasks', lTasks, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    }
}
