import * as fs from 'fs';
import * as vscode from 'vscode';
import { LanguageClientHandle } from '../services/languageClientHandle';

export class LanguageServerCommandHandler {
    public constructor(private readonly languageClient: LanguageClientHandle) {
    }

    public register(context: vscode.ExtensionContext): void {
        this.registerCommand(context, 'nexusPascal.languageServer.selectFpcSourceDirectory', this.selectFpcSourceDirectory);

        context.subscriptions.push(
            vscode.commands.registerTextEditorCommand('nexusPascal.code.complete', this.codeComplete)
        );
    }

    private registerCommand(
        context: vscode.ExtensionContext,
        command: string,
        handler: (...args: any[]) => unknown
    ): void {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler));
    }

    private selectFpcSourceDirectory = async (): Promise<void> => {
        const config = vscode.workspace.getConfiguration('nexusPascal.languageServer');
        const currentPath = config.get<string>('fpcSourceDirectory');
        const defaultUri = currentPath && fs.existsSync(currentPath)
            ? vscode.Uri.file(currentPath)
            : undefined;

        const selectedFolders = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
            title: 'Select Free Pascal Source Directory'
        });

        const selectedFolder = selectedFolders?.[0];
        if (!selectedFolder) {
            return;
        }

        await config.update('fpcSourceDirectory', selectedFolder.fsPath, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.openSettings', 'nexusPascal.languageServer.fpcSourceDirectory');
    };

    private codeComplete = (textEditor: vscode.TextEditor): void => {
        this.languageClient.completeCode(textEditor);
    };
}
