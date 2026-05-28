import * as vscode from 'vscode';
import { LanguageServerCommandHandler } from './commandHandlers/languageServerCommandHandler';
import { ProjectCommandHandler } from './commandHandlers/projectCommandHandler';
import { TemplateCommandHandler } from './commandHandlers/templateCommandHandler';
import { PascalProjectModelService } from './services/pascalProjectModelService';
import { PascalTaskFactory } from './services/pascalTaskFactory';
import { LanguageClientHandle } from './services/languageClientHandle';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { FpcTaskProvider, LazarusTaskProvider } from './vscode/vscodeTaskProvider';
import { ExtensionPaths } from './services/extensionPaths';

export class FpcCommandManager {
    private readonly projectCommands: ProjectCommandHandler;
    private readonly templateCommands: TemplateCommandHandler;
    private readonly languageServerCommands: LanguageServerCommandHandler;

    public constructor(
        workspaceRoot: string,
        taskProvider: FpcTaskProvider,
        lazarusTaskProvider: LazarusTaskProvider,
        extensionPaths: ExtensionPaths,
        projectModelService: PascalProjectModelService,
        taskFactory: PascalTaskFactory,
        workspaceTasks: WorkspaceTasksService,
        refreshProjects: () => void,
        languageClient: LanguageClientHandle
    ) {
        this.projectCommands = new ProjectCommandHandler(
            workspaceRoot,
            taskProvider,
            lazarusTaskProvider,
            projectModelService,
            taskFactory,
            workspaceTasks,
            refreshProjects,
            languageClient
        );
        this.templateCommands = new TemplateCommandHandler(workspaceRoot, extensionPaths, workspaceTasks);
        this.languageServerCommands = new LanguageServerCommandHandler(languageClient);
    }

    public registerAll(context: vscode.ExtensionContext): void {
        this.projectCommands.register(context);
        this.templateCommands.register(context);
        this.languageServerCommands.register(context);
    }
}
