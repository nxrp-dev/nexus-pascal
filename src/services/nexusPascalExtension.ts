import * as vscode from 'vscode';
import { FpcCommandManager } from '../commands';
import { PascalFormatterService } from '../formatter';
import * as MyCodeAction from '../languageServer/codeaction';
import { PascalLanguageClientService } from '../languageServer/client';
import { FpcProjectProvider } from '../providers/project';
import { DefaultBuildModeStorage } from '../providers/defaultBuildModeStorage';
import { FpcTaskProvider, LazarusTaskProvider } from '../vscode/vscodeTaskProvider';
import { DebugBuildService } from './debugBuildService';
import { EditorIntegrationService } from './editorIntegrationService';
import { ExtensionPaths } from './extensionPaths';
import { LanguageClientHandle } from './languageClientHandle';
import { PascalBuildTargetContextFactory } from './pascalBuildTargetContextFactory';
import { PascalProjectModelService } from './pascalProjectModelService';
import { PascalProjectTreeFactory } from './pascalProjectTreeFactory';
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
        private readonly projectProvider: FpcProjectProvider,
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

        DefaultBuildModeStorage.initialize(context);

        const extensionPaths = new ExtensionPaths(context);
        const languageClient = new LanguageClientHandle();
        const workspaceTasks = new WorkspaceTasksService(workspaceRoot);
        const taskProvider = new FpcTaskProvider(workspaceRoot, () => languageClient.restart());
        const lazarusTaskProvider = new LazarusTaskProvider(workspaceRoot);
        const projectModelService = new PascalProjectModelService(workspaceTasks);
        const buildTargetContextFactory = new PascalBuildTargetContextFactory(workspaceRoot);
        const taskFactory = new PascalTaskFactory(taskProvider, lazarusTaskProvider);
        const treeFactory = new PascalProjectTreeFactory();
        const projectProvider = new FpcProjectProvider(
            workspaceRoot,
            taskProvider,
            projectModelService,
            buildTargetContextFactory,
            treeFactory
        );
        const commandManager = new FpcCommandManager(
            workspaceRoot,
            taskProvider,
            lazarusTaskProvider,
            extensionPaths,
            projectModelService,
            taskFactory,
            workspaceTasks,
            () => projectProvider.refresh(),
            languageClient
        );
        const editorIntegrationService = new EditorIntegrationService(() => languageClient.current, logger);
        const debugBuildService = new DebugBuildService(projectProvider, logger, taskFactory, workspaceTasks);

        const app = new NexusPascalExtension(
            context,
            workspaceRoot,
            logger,
            languageClient,
            projectProvider,
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
        this.projectProvider.dispose();
        this.logger.dispose();
    }

    private async activate(): Promise<void> {
        this.commandManager.registerAll(this.context);

        this.disposables.push(
            vscode.window.registerTreeDataProvider('FpcProjectExplorer', this.projectProvider),
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
                this.projectProvider,
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
