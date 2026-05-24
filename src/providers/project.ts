import * as vscode from 'vscode';
import * as path from 'path';
import { clearTimeout } from 'timers';
import { CompileOption } from '../languageServer/options';
import { PascalBuildTarget, PascalProject } from '../model/pascalProject';
import { LanguageServerProjectContext } from '../languageServer/projectContext';
import { PascalBuildTargetContextFactory } from '../services/pascalBuildTargetContextFactory';
import { PascalProjectModelService } from '../services/pascalProjectModelService';
import { PascalProjectTreeFactory } from '../services/pascalProjectTreeFactory';
import { FpcTaskProvider } from '../vscode/vscodeTaskProvider';
import { FpcItem } from './fpcItem';
import { ProjectType } from './projectType';

export class FpcProjectProvider implements vscode.TreeDataProvider<FpcItem> {

    private readonly _onDidChangeTreeData: vscode.EventEmitter<FpcItem | undefined | void> = new vscode.EventEmitter<FpcItem | undefined | void>();
    public readonly onDidChangeTreeData: vscode.Event<FpcItem | undefined | void> = this._onDidChangeTreeData.event;

    private readonly watch: vscode.FileSystemWatcher;
    private readonly watchSource: vscode.FileSystemWatcher;
    private defaultCompileOption?: CompileOption = undefined;
    private timeout?: NodeJS.Timeout = undefined;
    private _hasSourceFileChanged = false;

    public defaultFpcItem?: FpcItem = undefined;

    public constructor(
        private readonly workspaceRoot: string,
        private readonly taskProvider: FpcTaskProvider,
        private readonly projectModelService: PascalProjectModelService,
        private readonly buildTargetContextFactory: PascalBuildTargetContextFactory,
        private readonly treeFactory: PascalProjectTreeFactory,
        private readonly projectTypeFilter?: ProjectType
    ) {
        this.watch = vscode.workspace.createFileSystemWatcher(path.join(workspaceRoot, '.vscode', 'tasks.json'), false);
        this.watch.onDidChange(() => {
            this.taskProvider.clean();
            if (this.timeout !== undefined) {
                clearTimeout(this.timeout);
            }
            this.timeout = setTimeout(() => {
                this.checkDefaultAndRefresh();
            }, 1000);
        });
        this.watch.onDidDelete(() => {
            this.refresh();
        });

        this.watchSource = vscode.workspace.createFileSystemWatcher('**/*.{pas,pp,lpr,inc,p,dpr,dpk,lfm}', false, false, false);
        this.watchSource.onDidChange(() => this._hasSourceFileChanged = true);
        this.watchSource.onDidCreate(() => this._hasSourceFileChanged = true);
        this.watchSource.onDidDelete(() => this._hasSourceFileChanged = true);
    }

    public hasSourceFileChanged(): boolean {
        return this._hasSourceFileChanged;
    }

    public resetSourceFileChanged(): void {
        this._hasSourceFileChanged = false;
    }

    public async ensureDefaultFpcItem(): Promise<FpcItem | undefined> {
        if (this.defaultFpcItem) {
            return this.defaultFpcItem;
        }

        const projects = this.getFilteredProjects();
        const defaultTarget = await this.ensureDefaultTarget(projects);
        if (!defaultTarget) {
            return undefined;
        }

        const project = projects.find(candidate => candidate.id === defaultTarget.projectId);
        if (!project) {
            return undefined;
        }

        this.defaultFpcItem = this.treeFactory.createTargetItem(project, defaultTarget);
        return this.defaultFpcItem;
    }

    public async ensureDefaultTarget(projects: PascalProject[] = this.getFilteredProjects()): Promise<PascalBuildTarget | undefined> {
        return this.projectModelService.getDefaultTarget(projects);
    }

    public dispose(): void {
        this.watch?.dispose();
        this.watchSource?.dispose();
    }

    public refresh(): void {
        this.defaultFpcItem = undefined;
        this._onDidChangeTreeData.fire();
    }

    public async checkDefaultAndRefresh(): Promise<void> {
        const oldCompileOption = this.defaultCompileOption;
        if (oldCompileOption === undefined) {
            this.taskProvider.notifyTaskConfigurationChanged();
            this.refresh();
            return;
        }

        const newCompileOption = await this.GetDefaultTaskOption();
        if (oldCompileOption.toOptionString() !== newCompileOption.toOptionString()) {
            this.taskProvider.notifyTaskConfigurationChanged();
        }
        this.refresh();
    }

    public getTreeItem(element: FpcItem): vscode.TreeItem {
        return element;
    }

    public async getChildren(element?: FpcItem): Promise<FpcItem[]> {
        if (element) {
            const items = (element.project?.targets || []).map(target => {
                const item = new FpcItem(
                    1,
                    target.label,
                    vscode.TreeItemCollapsibleState.None,
                    element.file,
                    element.fileexist,
                    target.isDefault,
                    element.projectType,
                    element.project,
                    target
                );

                if (item.isDefault) {
                    this.defaultFpcItem = item;
                }

                return item;
            });

            return items;
        }

        this.defaultFpcItem = undefined;
        return this.getFilteredProjects().map(project => this.treeFactory.createProjectItem(project));
    }

    public async GetDefaultTaskOption(): Promise<CompileOption> {
        const target = this.projectModelService.getDefaultTarget(this.getFilteredProjects());
        const option = this.buildTargetContextFactory.createCompileOption(target);

        this.defaultCompileOption = option;
        return option;
    }

    public async getDefaultLanguageServerContext(): Promise<LanguageServerProjectContext> {
        const target = this.projectModelService.getDefaultTarget(this.getFilteredProjects());
        return this.buildTargetContextFactory.createLanguageServerContext(target);
    }

    private getFilteredProjects(): PascalProject[] {
        return this.projectModelService
            .loadProjects()
            .filter(project => this.projectTypeFilter === undefined || this.treeFactory.getProjectType(project) === this.projectTypeFilter);
    }

}
