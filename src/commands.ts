import * as vscode from 'vscode';
import { LanguageServerCommandHandler } from './commandHandlers/languageServerCommandHandler';
import { LazarusTestModuleCommandHandler } from './commandHandlers/lazarusTestModuleCommandHandler';
import { TemplateCommandHandler } from './commandHandlers/templateCommandHandler';
import { LanguageClientHandle } from './services/languageClientHandle';
import { ExtensionPaths } from './services/extensionPaths';

export class FpcCommandManager {
    private readonly templateCommands: TemplateCommandHandler;
    private readonly languageServerCommands: LanguageServerCommandHandler;
    private readonly lazarusTestModuleCommands: LazarusTestModuleCommandHandler;

    public constructor(
        workspaceRoot: string,
        extensionPaths: ExtensionPaths,
        languageClient: LanguageClientHandle
    ) {
        this.templateCommands = new TemplateCommandHandler(workspaceRoot, extensionPaths);
        this.languageServerCommands = new LanguageServerCommandHandler(languageClient);
        this.lazarusTestModuleCommands = new LazarusTestModuleCommandHandler(workspaceRoot);
    }

    public registerAll(context: vscode.ExtensionContext): void {
        this.templateCommands.register(context);
        this.languageServerCommands.register(context);
        this.lazarusTestModuleCommands.register(context);
    }
}
