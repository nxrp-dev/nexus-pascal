import * as vscode from 'vscode';
import {
    CloseAction,
    CloseHandlerResult,
    ErrorAction,
    ErrorHandler,
    ErrorHandlerResult,
    LanguageClient,
    Message,
    ExecuteCommandParams,
    ExecuteCommandRequest,
    State
} from 'vscode-languageclient/node';

import * as fs from 'fs';
import { FpcProjectProvider } from '../providers/project';
import { ExtensionPaths } from '../services/extensionPaths';
import { ClientLifecycleLock } from './clientLifecycle';
import { InactiveRegions } from './inactiveRegions';
import { InitializationOptions } from './options';
import { getFpcSourceIncludeOptions, getGlobalUnitPaths, getServerEnvironment } from './serverEnvironment';
import { prepareServerExecutable, ServerExecutableResolver } from './serverExecutable';
import { ServerNotifications } from './serverNotifications';
import { createLanguageClientOptions, createServerOptions } from './serverOptions';

export class PascalLanguageClientService implements ErrorHandler {
    private client: LanguageClient | undefined;
    private targetOS?: string;
    private targetCPU?: string;
    private readonly inactiveRegions = new InactiveRegions();
    private notifications?: ServerNotifications;
    private readonly lifecycle = new ClientLifecycleLock();
    private readonly executableResolver: ServerExecutableResolver;

    public constructor(
        public projProvider: FpcProjectProvider,
        private readonly extensionPaths: ExtensionPaths,
        private readonly logger: vscode.OutputChannel
    ) {
        this.executableResolver = new ServerExecutableResolver(this.extensionPaths);
    }

    public error(error: Error, message: Message | undefined, count: number | undefined): ErrorHandlerResult {
        this.logger.appendLine(error.name + ' ' + error.message);
        return { action: ErrorAction.Continue } as ErrorHandlerResult;
    }

    public closed(): CloseHandlerResult {
        this.logger.appendLine('Server closed.');
        return { action: CloseAction.Restart } as CloseHandlerResult;
    }

    public async doOnReady(): Promise<void> {
        if (!this.client) {
            return;
        }

        this.notifications = new ServerNotifications(this.client, this.inactiveRegions, this.logger);
        this.notifications.register();
    }

    public async doInit(): Promise<void> {
        await this.lifecycle.run(() => this.doInitInternal());
    }

    private async doInitInternal(): Promise<void> {
        if (this.client) {
            await this.stopInternal();
        }

        console.log('Greetings from pascal-language-server');
        const executableInfo = this.executableResolver.resolve();
        const executable = executableInfo.executable;
        this.targetOS = executableInfo.targetOS;
        this.targetCPU = executableInfo.targetCPU;

        if (!prepareServerExecutable(executable, this.logger)) {
            return;
        }

        console.log('executable: ' + executable);

        const envVars = getServerEnvironment();
        this.logger.appendLine(`Environment PP: ${envVars['PP']}`);
        this.logger.appendLine(`Environment FPCDIR: ${envVars['FPCDIR']}`);
        this.logger.appendLine(`Environment LAZARUSDIR: ${envVars['LAZARUSDIR']}`);

        const fpcDir = envVars['FPCDIR'];
        this.logger.appendLine('fpcDir: ' + fpcDir);
        if (!fpcDir || !fs.existsSync(fpcDir) || !fs.lstatSync(fpcDir).isDirectory()) {
            const selectFolder = vscode.l10n.t('Select Folder');
            const openSettings = vscode.l10n.t('Open Settings');
            vscode.window.showErrorMessage(
                vscode.l10n.t('FPC source directory is not set or invalid. Please set the Free Pascal source directory used by the language server.'),
                selectFolder,
                openSettings
            ).then(selection => {
                if (selection === selectFolder) {
                    vscode.commands.executeCommand('nexusPascal.languageServer.selectFpcSourceDirectory');
                } else if (selection === openSettings) {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'nexusPascal.languageServer.fpcSourceDirectory');
                }
            });
            return;
        }

        const serverOptions = createServerOptions(executable, envVars);

        const initializationOptions = new InitializationOptions();

        const projectContext = await this.projProvider.getDefaultLanguageServerContext();
        initializationOptions.updateByProjectContext(projectContext);
        this.logger.appendLine(`Language server project context: ${projectContext.kind} ${projectContext.projectFile}`);

        const fpcSourceIncludeOptions = getFpcSourceIncludeOptions(envVars['FPCDIR']);
        for (const includeOption of fpcSourceIncludeOptions) {
            if (!initializationOptions.fpcOptions.includes(includeOption)) {
                initializationOptions.fpcOptions.push(includeOption);
            }
        }
        this.logger.appendLine(`Added ${fpcSourceIncludeOptions.length} FPC source include paths to language server context`);

        if (projectContext.allowFpcGlobalUnitPaths) {
            const globalUnitPaths = await getGlobalUnitPaths(
                envVars['PP'] || 'fpc',
                this.targetOS,
                this.targetCPU,
                projectContext.workingDirectory
            );
            globalUnitPaths.forEach(unitPath => {
                const option = `-Fu${unitPath}`;
                if (!initializationOptions.fpcOptions.includes(option)) {
                    initializationOptions.fpcOptions.push(option);
                }
            });
            this.logger.appendLine(`Added ${globalUnitPaths.length} FPC global unit paths to language server context`);
        } else {
            this.logger.appendLine('Skipped FPC global unit paths for Lazarus language server context');
        }

        const clientOptions = createLanguageClientOptions(initializationOptions, this);

        this.logger.appendLine('Language server document selector: objectpascal, pascal');
        this.client = new LanguageClient('nexusPascal.languageServer', 'Free Pascal Language Server', serverOptions, clientOptions);
    }

    private async stopInternal(): Promise<void> {
        if (!this.client) {
            return;
        }

        try {
            if (this.client.state === State.Starting) {
                this.logger.appendLine('Client is starting, waiting for it to become running before stopping...');
                let count = 0;
                while (this.client.state === State.Starting && count < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    count++;
                }
            }

            if (this.client.state === State.Running) {
                this.logger.appendLine('Stopping language server...');
                await this.client.stop(10000);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.appendLine(`Failed to stop language client: ${message}`);
        } finally {
            try {
                this.client?.dispose();
                this.logger.appendLine('Language client disposed.');
            } catch (error) {
                this.logger.appendLine(`Error disposing client: ${error}`);
            }
            this.client = undefined;
            this.notifications = undefined;
            this.inactiveRegions.clear();
        }
    }

    public onDidChangeVisibleTextEditor(editor: vscode.TextEditor): void {
        this.inactiveRegions.applyToEditor(editor);
    }

    public async start(): Promise<void> {
        await this.lifecycle.run(() => this.startInternal());
    }

    private async startInternal(): Promise<void> {
        if (!this.client) {
            this.logger.appendLine('Cannot start: client is undefined. Call doInit first.');
            return;
        }
        try {
            if (this.client.state === State.Running) {
                return;
            }
            this.logger.appendLine('Starting language client...');
            await this.client.start();
            this.logger.appendLine('Language client started successfully.');
            await this.doOnReady();
        } catch (error) {
            this.logger.appendLine(`Critical: Failed to start language client: ${error}`);
            throw error;
        }
    }

    public async stop(): Promise<void> {
        await this.lifecycle.run(() => this.stopInternal());
    }

    public async restart(): Promise<void> {
        await this.lifecycle.run(async () => {
            await this.stopInternal();
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.doInitInternal();
            await this.startInternal();
        });
    }

    public async doCodeComplete(editor: vscode.TextEditor): Promise<void> {
        if (!this.notifications && this.client) {
            this.notifications = new ServerNotifications(this.client, this.inactiveRegions, this.logger);
        }

        await this.notifications?.completeCode(editor);
    }

    public async formatCode(fileUri: string, configUri: string): Promise<void> {
        if (!this.client) {
            this.logger.appendLine('Language server client is not available for formatting');
            return;
        }

        const request: ExecuteCommandParams = {
            command: 'pasls.formatCode',
            arguments: [fileUri, configUri]
        };
        await this.client.sendRequest(ExecuteCommandRequest.type, request);
    }
}
