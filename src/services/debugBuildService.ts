import * as vscode from 'vscode';
import { FpcProjectProvider } from '../providers/project';
import { FpcTaskProvider, LazarusTaskProvider } from '../providers/task';

export class DebugBuildService implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly projectProvider: FpcProjectProvider,
        private readonly logger: vscode.OutputChannel
    ) {}

    public register(): void {
        this.disposables.push(
            vscode.debug.registerDebugConfigurationProvider('cppdbg', {
                resolveDebugConfiguration: (folder, config) => config,
                resolveDebugConfigurationWithSubstitutedVariables: async (folder, config) => {
                    if (!this.isNexusPascalDebugConfiguration(folder, config)) {
                        return config;
                    }

                    try {
                        await this.checkAndBuildBeforeDebug();
                        return config;
                    } catch (error) {
                        this.logger.appendLine(`Debug session cancelled: ${error}`);
                        return undefined;
                    }
                }
            }),
            vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
                console.log('Custom event received:', event);
            }),
            vscode.debug.onDidStartDebugSession(async (session) => {
                console.log('Debug session started:', session.name);
            })
        );
    }

    public dispose(): void {
        this.disposables.splice(0).forEach(disposable => disposable.dispose());
    }

    private isNexusPascalDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration
    ): boolean {
        if (String(config.type ?? '').toLowerCase() !== 'cppdbg') {
            return false;
        }

        const preLaunchTask = this.getPreLaunchTaskLabel(config);
        if (!preLaunchTask) {
            return false;
        }

        const tasks = this.getConfiguredTasks(folder);
        const resolvedTaskLabel = preLaunchTask === '${defaultBuildTask}'
            ? this.getDefaultBuildTaskLabel(tasks)
            : preLaunchTask;

        if (!resolvedTaskLabel) {
            return false;
        }

        return tasks.some(task => this.isNexusPascalTask(task) && this.getTaskLabel(task) === resolvedTaskLabel);
    }

    private getPreLaunchTaskLabel(config: vscode.DebugConfiguration): string | undefined {
        const preLaunchTask = config.preLaunchTask;

        if (typeof preLaunchTask !== 'string') {
            return undefined;
        }

        const label = preLaunchTask.trim();
        return label.length > 0 ? label : undefined;
    }

    private getConfiguredTasks(folder: vscode.WorkspaceFolder | undefined): any[] {
        const workspaceFolder = folder ?? vscode.workspace.workspaceFolders?.[0];
        const resource = workspaceFolder?.uri;
        const config = vscode.workspace.getConfiguration('tasks', resource);

        return config.get<any[]>('tasks') ?? [];
    }

    private isNexusPascalTask(task: any): boolean {
        const taskType = String(task?.type ?? '').toLowerCase();
        return taskType === FpcTaskProvider.FpcTaskType || taskType === LazarusTaskProvider.LazarusTaskType;
    }

    private getTaskLabel(task: any): string | undefined {
        const label = task?.label ?? task?.taskName;
        return typeof label === 'string' ? label : undefined;
    }

    private getDefaultBuildTaskLabel(tasks: any[]): string | undefined {
        const defaultTask = tasks.find(task => {
            const group = task?.group;
            return typeof group === 'object' && group?.kind === 'build' && group?.isDefault === true;
        });

        return defaultTask ? this.getTaskLabel(defaultTask) : undefined;
    }

    private async checkAndBuildBeforeDebug(): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            this.logger.appendLine('Debug pre-check: No workspace folder found');
            return;
        }

        const config = vscode.workspace.getConfiguration('nexusPascal.debug');
        const autoBuildEnabled = config.get<boolean>('autoBuildBeforeLaunch', true);

        if (!autoBuildEnabled) {
            this.logger.appendLine('Debug pre-check: Auto-build feature is disabled');
            return;
        }

        if (!this.projectProvider.hasSourceFileChanged()) {
            return;
        }

        this.logger.appendLine('Debug pre-check: Source file changes detected, compilation needed');

        let defaultFpcItem = await this.projectProvider.ensureDefaultFpcItem();

        if (!defaultFpcItem) {
            await new Promise<void>((resolve) => {
                const disposable = this.projectProvider.onDidChangeTreeData(() => {
                    disposable.dispose();
                    resolve();
                });
                this.projectProvider.refresh();
            });

            defaultFpcItem = await this.projectProvider.ensureDefaultFpcItem();
            if (!defaultFpcItem) {
                this.logger.appendLine('Debug pre-check: No default project found');
                return;
            }
        }

        const defaultTask = await defaultFpcItem.projectTask?.getTask();

        if (!defaultTask) {
            this.logger.appendLine('Debug pre-check: No suitable task found for compilation');
            return;
        }

        this.logger.appendLine('Debug auto-compilation: File changes detected, starting compilation');
        const execution = await vscode.tasks.executeTask(defaultTask);
        await this.waitForTask(execution);
    }

    private async waitForTask(execution: vscode.TaskExecution): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            let taskCompleted = false;

            const processDisposable = vscode.tasks.onDidEndTaskProcess(async (e) => {
                if (e.execution !== execution || taskCompleted) {
                    return;
                }

                taskCompleted = true;
                processDisposable.dispose();
                taskDisposable.dispose();

                if (e.exitCode === 0) {
                    this.projectProvider.resetSourceFileChanged();
                    this.logger.appendLine('Debug auto-compilation: Compilation completed successfully');
                    resolve();
                    return;
                }

                this.logger.appendLine(`Debug auto-compilation: Compilation failed with exit code ${e.exitCode}`);
                const choice = await vscode.window.showWarningMessage(
                    `Compilation failed with exit code ${e.exitCode}. Do you want to continue debugging anyway?`,
                    'Continue',
                    'Cancel'
                );

                if (choice === 'Continue') {
                    this.logger.appendLine('Debug auto-compilation: User chose to continue debugging despite compilation failure');
                    resolve();
                } else {
                    this.logger.appendLine('Debug auto-compilation: User cancelled debugging due to compilation failure');
                    reject(new Error(`Compilation failed with exit code ${e.exitCode}`));
                }
            });

            const taskDisposable = vscode.tasks.onDidEndTask((e) => {
                if (e.execution !== execution || taskCompleted) {
                    return;
                }

                taskCompleted = true;
                processDisposable.dispose();
                taskDisposable.dispose();
                this.projectProvider.resetSourceFileChanged();
                this.logger.appendLine('Debug auto-compilation: Compilation completed (exit code unknown)');
                resolve();
            });
        });
    }
}
