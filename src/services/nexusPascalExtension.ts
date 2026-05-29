import * as vscode from 'vscode';
import { FpcCommandManager } from '../commands';
import { PascalFormatterService } from '../formatter';
import * as MyCodeAction from '../languageServer/codeaction';
import { PascalLanguageClientService } from '../languageServer/client';
import { PascalBuildTarget, PascalProject, PascalProjectKind } from '../model/pascalProject';
import { createPascalProjectAdapterRegistry } from '../projectTypes/createPascalProjectAdapterRegistry';
import { BuildMode } from '../vscode/vscodeTask';
import { FpcTaskProvider, LazarusTaskProvider } from '../vscode/vscodeTaskProvider';
import { DebugBuildService } from './debugBuildService';
import { EditorIntegrationService } from './editorIntegrationService';
import { ExtensionPaths } from './extensionPaths';
import { LanguageClientHandle } from './languageClientHandle';
import { PascalBuildTargetContextFactory } from './pascalBuildTargetContextFactory';
import { PascalProjectModelService } from './pascalProjectModelService';
import { PascalProjectWorkspaceService } from './pascalProjectWorkspaceService';
import { PascalTaskFactory } from './pascalTaskFactory';
import { WorkspaceTasksService } from './workspaceTasksService';

export class NexusPascalExtension implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private client?: PascalLanguageClientService;
    private formatter?: PascalFormatterService;

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly workspaceRoot: string,
        private readonly logger: vscode.OutputChannel,
        private readonly languageClient: LanguageClientHandle,
        private readonly projectWorkspace: PascalProjectWorkspaceService,
        private readonly commandManager: FpcCommandManager,
        private readonly taskProvider: FpcTaskProvider,
        private readonly lazarusTaskProvider: LazarusTaskProvider,
        private readonly extensionPaths: ExtensionPaths,
        private readonly editorIntegrationService: EditorIntegrationService,
        private readonly debugBuildService: DebugBuildService
    ) {}

    public static async create(context: vscode.ExtensionContext): Promise<NexusPascalExtension | undefined> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return undefined;
        }

        const logger = vscode.window.createOutputChannel('Nexus Pascal');
        logger.appendLine('Nexus Pascal extension activating...');

        const extensionPaths = new ExtensionPaths(context);
        const languageClient = new LanguageClientHandle();
        const workspaceTasks = new WorkspaceTasksService(workspaceRoot);
        const taskProvider = new FpcTaskProvider(workspaceRoot, () => languageClient.restart());
        const lazarusTaskProvider = new LazarusTaskProvider(workspaceRoot);
        const projectAdapters = createPascalProjectAdapterRegistry(
            workspaceRoot,
            workspaceTasks,
            taskProvider,
            lazarusTaskProvider
        );
        const projectModelService = new PascalProjectModelService(projectAdapters);
        const buildTargetContextFactory = new PascalBuildTargetContextFactory(projectAdapters);
        const taskFactory = new PascalTaskFactory(projectAdapters);
        taskProvider.setTaskSource(() => createProvidedTasks(projectModelService, taskFactory, 'fpc'));
        lazarusTaskProvider.setTaskSource(() => createProvidedTasks(projectModelService, taskFactory, 'lazarus'));
        const projectWorkspace = new PascalProjectWorkspaceService(
            workspaceRoot,
            taskProvider,
            projectModelService,
            buildTargetContextFactory
        );
        const commandManager = new FpcCommandManager(
            workspaceRoot,
            extensionPaths,
            languageClient
        );
        const editorIntegrationService = new EditorIntegrationService(() => languageClient.current, logger);
        const debugBuildService = new DebugBuildService(projectWorkspace, logger, taskFactory, workspaceTasks);

        const app = new NexusPascalExtension(
            context,
            workspaceRoot,
            logger,
            languageClient,
            projectWorkspace,
            commandManager,
            taskProvider,
            lazarusTaskProvider,
            extensionPaths,
            editorIntegrationService,
            debugBuildService
        );

        await app.activate();
        return app;
    }

    public dispose(): void {
        this.disposables.splice(0).forEach(disposable => disposable.dispose());
        this.client?.stop();
        this.languageClient.set(undefined);
        this.projectWorkspace.dispose();
        this.logger.dispose();
    }

    private async activate(): Promise<void> {
        this.commandManager.registerAll(this.context);

        this.disposables.push(
            vscode.tasks.registerTaskProvider(FpcTaskProvider.FpcTaskType, this.taskProvider),
            vscode.tasks.registerTaskProvider(LazarusTaskProvider.LazarusTaskType, this.lazarusTaskProvider),
            this.editorIntegrationService,
            this.debugBuildService
        );

        this.editorIntegrationService.register();
        this.debugBuildService.register();

        this.logger.appendLine('Core components initialized, extension activated');

        await this.initializeLanguageServices();
    }

    private async initializeLanguageServices(): Promise<void> {
        try {
            const serverStoragePath = this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath;
            this.client = new PascalLanguageClientService(
                this.projectWorkspace,
                this.extensionPaths,
                this.logger,
                serverStoragePath
            );
            this.languageClient.set(this.client);
            await this.client.doInit();
            await this.client.start();
            this.logger.appendLine('Language server initialized successfully');
        } catch (error) {
            this.logger.appendLine(`Language server initialization failed: ${error}`);
            console.error('Language server error:', error);
        }

        try {
            this.formatter = new PascalFormatterService(this.extensionPaths, () => this.languageClient.current, this.logger);
            this.formatter.doInit();
            this.logger.appendLine('Formatter initialized successfully');
        } catch (error) {
            this.logger.appendLine(`Formatter initialization failed: ${error}`);
            console.error('Formatter error:', error);
        }

        try {
            MyCodeAction.activate(this.context);
            this.logger.appendLine('CodeAction provider registered successfully');
        } catch (error) {
            this.logger.appendLine(`CodeAction registration failed: ${error}`);
            console.error('CodeAction error:', error);
        }
    }
}

function createProvidedTasks(
    projectModelService: PascalProjectModelService,
    taskFactory: PascalTaskFactory,
    kind: PascalProjectKind
): vscode.Task[] {
    const tasks: vscode.Task[] = [];

    for (const project of projectModelService.loadProjects()) {
        for (const target of project.targets) {
            if (target.kind !== kind || !target.canBuild || !target.isInProjectFile) {
                continue;
            }

            const buildTask = taskFactory.createTask(
                target,
                createTaskName(project, target, 'Build'),
                BuildMode.normal
            );
            if (buildTask) {
                tasks.push(buildTask);
            }

            const rebuildTask = taskFactory.createTask(
                target,
                createTaskName(project, target, 'Rebuild'),
                BuildMode.rebuild
            );
            if (rebuildTask) {
                tasks.push(rebuildTask);
            }
        }
    }

    return tasks;
}

function createTaskName(project: PascalProject, target: PascalBuildTarget, verb: 'Build' | 'Rebuild'): string {
    const kindName = project.kind === 'lazarus'
        ? 'Lazarus'
        : project.kind === 'fpc'
            ? 'Free Pascal'
            : 'Nexus';
    const targetPart = target.label && target.label !== project.label
        ? ` ${target.label}`
        : '';

    return `${verb} ${project.label} (${kindName}${targetPart})`;
}
