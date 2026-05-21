import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CompileOption } from '../languageServer/options';
import { FpcTaskDefinition, FpcTaskProvider, taskProvider } from './task';
import { clearTimeout } from 'timers';
import { LazarusProjectParser, LazarusProject } from './lazarus';
import { IProjectIntf, IProjectTask } from './projectIntf';
import { FpcTask, FpcTaskProject } from './fpcTaskProject';
import { FpcItem } from './fpcItem';
import { ProjectType } from './projectType';
import { LazarusBuildModeTask } from './lazarusBuildModeTask';
import { DefaultBuildModeStorage } from './defaultBuildModeStorage';

export class FpcProjectProvider implements vscode.TreeDataProvider<FpcItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<FpcItem | undefined | void> = new vscode.EventEmitter<FpcItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<FpcItem | undefined | void> = this._onDidChangeTreeData.event;
	private watch!: vscode.FileSystemWatcher;
	private watchSource!: vscode.FileSystemWatcher; // Monitor source file changes
	public defaultFpcItem?: FpcItem = undefined;
	private config!: vscode.WorkspaceConfiguration;
	private defaultCompileOption?: CompileOption = undefined;
	private timeout?: NodeJS.Timeout = undefined;
	private _hasSourceFileChanged: boolean = false; // Flag indicating whether source files have changed
	public _projectInfosMap: Map<string, IProjectIntf> = new Map(); // Store parsed project interfaces
	constructor(private workspaceRoot: string, context: vscode.ExtensionContext, private projectTypeFilter?: ProjectType) {
		const subscriptions = context.subscriptions;
		const name = 'FpcProjectExplorer';

		this.watch = vscode.workspace.createFileSystemWatcher(path.join(workspaceRoot, ".vscode", "tasks.json"), false);
		this.watch.onDidChange(async (url) => {
			taskProvider.clean();
			if (this.timeout != undefined) {
				clearTimeout(this.timeout);
			}
			this.timeout = setTimeout(() => {
				this.checkDefaultAndRefresh();
			}, 1000);
		});
		this.watch.onDidDelete(() => {
			this.refresh();
		});

		// Monitor all Pascal source file changes
		this.watchSource = vscode.workspace.createFileSystemWatcher("**/*.{pas,pp,lpr,inc,p,dpr,dpk,lfm}", false, false, false);
		this.watchSource.onDidChange(() => {
			this._hasSourceFileChanged = true;
		});
		this.watchSource.onDidCreate(() => {
			this._hasSourceFileChanged = true;
		});
		this.watchSource.onDidDelete(() => {
			this._hasSourceFileChanged = true;
		});

	}

	/**
	 * Get cached project info for a LPI file
	 * @param lpiPath Path to the LPI file
	 * @returns Cached project interface or undefined if not cached
	 */
	private getCachedProjectInfos(lpiPath: string): IProjectIntf | undefined {
		return this._projectInfosMap.get(lpiPath);
	}

	/**
	 * Parse and cache project info for a LPI file
	 * @param lpiPath Path to the LPI file
	 * @returns Parsed project interface
	 */
	private parseAndCacheProjectInfos(projectPath: string): IProjectIntf {
		try {
			let projectIntf: IProjectIntf | undefined;
			if (projectPath.toLowerCase().endsWith('.lpi')) {
				projectIntf = LazarusProjectParser.parseLpiFile(projectPath);
			} else if (projectPath.toLowerCase().endsWith('.lpk')) {
				projectIntf = LazarusProjectParser.parseLpkFile(projectPath);
			}

			if (projectIntf) {
				this._projectInfosMap.set(projectPath, projectIntf);
				return projectIntf;
			}
		} catch (error) {
			console.error(`Error parsing project file ${projectPath}:`, error);
		}
		// Create a default project info if parsing fails
		const defaultProjectInfo = LazarusProjectParser.createDefaultProjectInfo(projectPath);
		this._projectInfosMap.set(projectPath, defaultProjectInfo);
		return defaultProjectInfo;
	}

	/**
	 * Get project info for a LPI file (cached or parsed)
	 * @param lpiPath Path to the LPI file
	 * @returns Project interface
	 */
	public getProjectInfos(lpiPath: string): IProjectIntf {
		// Check cache first
		let projectIntf = this.getCachedProjectInfos(lpiPath);
		if (!projectIntf) {
			// Parse and cache if not found
			projectIntf = this.parseAndCacheProjectInfos(lpiPath);
		}
		return projectIntf;
	}

	/**
	 * Check if source files have changed
	 */
	public hasSourceFileChanged(): boolean {
		return this._hasSourceFileChanged;
	}

	/**
	 * Reset the source file change flag
	 */
	public resetSourceFileChanged(): void {
		this._hasSourceFileChanged = false;
	}

	/**
	 * Ensure we have a default FPC project
	 */
	public async ensureDefaultFpcItem(): Promise<FpcItem | undefined> {
		return this.defaultFpcItem;
	}


	private resolveWorkspacePath(value: string | undefined, basePath: string = this.workspaceRoot): string {
		if (!value) {
			return basePath;
		}

		const resolved = value.replace(/\$\{workspaceFolder\}/g, this.workspaceRoot);

		if (path.isAbsolute(resolved)) {
			return resolved;
		}

		return path.resolve(basePath, resolved);
	}

	private collectTaskProjects(itemMaps: Map<string, FpcItem>): void {
		this.config?.tasks?.forEach((taskDefinition: any) => {
			if (taskDefinition.type === 'fpc') {
				this.collectFpcTaskProject(taskDefinition, itemMaps);
			} else if (taskDefinition.type === 'lazarus') {
				this.collectLazarusTaskProject(taskDefinition, itemMaps);
			}
		});
	}

	private collectFpcTaskProject(taskDefinition: any, itemMaps: Map<string, FpcItem>): void {
		if (this.projectTypeFilter !== undefined && this.projectTypeFilter !== ProjectType.FPC) {
			return;
		}

		if (!taskDefinition.file) {
			return;
		}

		const cwd = this.resolveWorkspacePath(taskDefinition.cwd);
		const absolutePath = this.resolveWorkspacePath(taskDefinition.file, cwd);
		const displayName = path.basename(taskDefinition.file);
		const isDefault = taskDefinition.group?.isDefault || false;
		const existingItem = itemMaps.get(absolutePath);

		if (existingItem?.project) {
			const projectIntf = existingItem.project as FpcTaskProject;
			const task = new FpcTask(taskDefinition.label || displayName, isDefault, projectIntf, taskDefinition);
			(task as any).isInLpi = false;
			projectIntf.tasks.push(task);
			if (isDefault) {
				existingItem.isDefault = true;
			}
			return;
		}

		const projectIntf = new FpcTaskProject(displayName, absolutePath, isDefault, taskDefinition);

		itemMaps.set(
			absolutePath,
			new FpcItem(
				0,
				displayName,
				vscode.TreeItemCollapsibleState.Expanded,
				absolutePath,
				fs.existsSync(absolutePath),
				isDefault,
				ProjectType.FPC,
				projectIntf
			)
		);
	}

	private collectLazarusTaskProject(taskDefinition: any, itemMaps: Map<string, FpcItem>): void {
		if (this.projectTypeFilter !== undefined && this.projectTypeFilter !== ProjectType.Lazarus) {
			return;
		}

		if (!taskDefinition.project) {
			return;
		}

		const cwd = this.resolveWorkspacePath(taskDefinition.cwd);
		const absolutePath = this.resolveWorkspacePath(taskDefinition.project, cwd);
		const displayName = path.basename(taskDefinition.project);
		const buildMode = taskDefinition.buildMode || taskDefinition.label || 'Default';
		const isDefault = taskDefinition.group?.isDefault || false;
		let item = itemMaps.get(absolutePath);
		let projectIntf = item?.project as LazarusProject | undefined;

		if (!projectIntf) {
			projectIntf = new LazarusProject(
				path.basename(absolutePath, path.extname(absolutePath)),
				'',
				absolutePath,
				isDefault
			);

			item = new FpcItem(
				0,
				displayName,
				vscode.TreeItemCollapsibleState.Expanded,
				absolutePath,
				fs.existsSync(absolutePath),
				isDefault,
				ProjectType.Lazarus,
				projectIntf
			);

			itemMaps.set(absolutePath, item);
		}

		const task = new LazarusBuildModeTask(
			taskDefinition.label || buildMode,
			isDefault,
			false,
			projectIntf,
			buildMode
		);

		projectIntf.tasks.push(task);

		if (isDefault && item) {
			item.isDefault = true;
		}
	}

	/**
	 * Apply default project logic
	 * @param itemMaps Project mapping
	 */
	private applyDefaultProjectLogic(itemMaps: Map<string, FpcItem>): void {
		if (itemMaps.size < 1) {
			return;
		}

		let defaultTask: IProjectTask | undefined;

		// 1. Find default task in current items
		for (const item of itemMaps.values()) {
			if (item.project?.tasks) {
				for (const task of item.project.tasks) {
					if (task.isDefault) {
						defaultTask = task;
						break;
					}
				}
				if (defaultTask) break;
			}
		}

		// 2. If no default task found in current items, check if a default exists in OTHER types
		if (!defaultTask) {
			// 2.1 Check if any Lazarus project is default globally
			const storage = DefaultBuildModeStorage.getInstance();
			if (storage.getDefaultBuildMode()) {
				return;
			}

			// 2.2 Check if any FPC project is default in tasks.json
			if (this.config?.tasks) {
				const hasFpcDefault = this.config.tasks.some((t: any) => t.type === 'fpc' && t.group?.isDefault);
				if (hasFpcDefault) {
					return;
				}
			}

			// 3. Fallback: Only if no default exists anywhere, use the first task as default
			for (const item of itemMaps.values()) {
				if (item.project?.tasks && item.project.tasks.length > 0) {
					defaultTask = item.project.tasks[0];
					break;
				}
			}
		}

		// Apply default status
		if (defaultTask) {
			// Clear default status for all current projects
			for (const item of itemMaps.values()) {
				if (item.project?.tasks) {
					for (const task of item.project.tasks) {
						task.isDefault = false;
					}
				}
			}

			// Set default project and task
			defaultTask.isDefault = true;
		}
	}

	dispose() {
		this.watch?.dispose();
		this.watchSource?.dispose();
	}


	/*TreeDataProvider*/
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	async checkDefaultAndRefresh(): Promise<void> {
		let oldCompileOption = this.defaultCompileOption;
		if (oldCompileOption == undefined) {
			taskProvider.refresh();
			this.refresh();
			return;
		}

		//default task setting changed 
		let newCompileOption = await this.GetDefaultTaskOption();
		if (oldCompileOption.toOptionString() != newCompileOption.toOptionString()) {
			taskProvider.refresh();
		}
		this.refresh();
	}

	getTreeItem(element: FpcItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: FpcItem | undefined): Promise<FpcItem[]> {

		if (element) {
		// Handle child nodes (project build configurations)
			let items: FpcItem[] = [];

			if (element.project && element.project.tasks) {
				// Directly use already stored tasks
				for (const task of element.project.tasks) {
					// Create tree item
					let item = new FpcItem(
						1,
						task.label,
						vscode.TreeItemCollapsibleState.None,
						element.file,
						element.fileexist,
						task.isDefault,
						element.projectType,
						task
					);
					items.push(item);

					// If default task, update global default project
					if (item.isDefault) {
						this.defaultFpcItem = item;
					}
				}
			}

			return items;

		} else {
		// Handle root node

		// Create a mapping to store all projects
			var itemMaps: Map<string, FpcItem> = new Map();

		// 1. Collect all project info

		// 1.1 Collect explicit FPC/Lazarus projects from tasks.json
			this.config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));
			this.collectTaskProjects(itemMaps);

		// Apply default project logic
			this.applyDefaultProjectLogic(itemMaps);

			let items: FpcItem[] = [];

		// Add all projects in mapping to project list
			for (const item of itemMaps.values()) {
				items.push(item);
			}

			return items;
		}
	}

	private createCompileOptionFromTaskDefinition(taskDefinition: any): CompileOption | undefined {
		if (!taskDefinition) {
			return undefined;
		}

		if (taskDefinition.type === 'fpc') {
			if (!taskDefinition.file) {
				return undefined;
			}

			const cwd = this.resolveWorkspacePath(taskDefinition.cwd);
			const compileDefinition = Object.assign(new FpcTaskDefinition(), taskDefinition);
			compileDefinition.cwd = cwd;
			compileDefinition.file = this.resolveWorkspacePath(taskDefinition.file, cwd);
			return new CompileOption(compileDefinition, this.workspaceRoot);
		}

		if (taskDefinition.type === 'lazarus') {
			if (!taskDefinition.project) {
				return undefined;
			}

			const cwd = this.resolveWorkspacePath(taskDefinition.cwd);
			const compileDefinition = new FpcTaskDefinition();
			compileDefinition.cwd = cwd;
			compileDefinition.file = this.resolveWorkspacePath(taskDefinition.project, cwd);
			return new CompileOption(compileDefinition, this.workspaceRoot);
		}

		return undefined;
	}

	async GetDefaultTaskOption(): Promise<CompileOption> {
		const cfg = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));
		const tasks = cfg?.tasks || [];

		for (const taskDefinition of tasks) {
			if ((taskDefinition.type === 'fpc' || taskDefinition.type === 'lazarus') && taskDefinition.group?.isDefault) {
				const opt = this.createCompileOptionFromTaskDefinition(taskDefinition);
				if (opt) {
					this.defaultCompileOption = opt;
					return opt;
				}
			}
		}

		for (const taskDefinition of tasks) {
			if (taskDefinition.type === 'fpc' || taskDefinition.type === 'lazarus') {
				const opt = this.createCompileOptionFromTaskDefinition(taskDefinition);
				if (opt) {
					this.defaultCompileOption = opt;
					return opt;
				}
			}
		}

		const opt = new CompileOption();
		this.defaultCompileOption = opt;
		return opt;
	}

}
