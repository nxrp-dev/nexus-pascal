import * as vscode from 'vscode';
import { configuration } from '../common/configuration';
import type { TLangClient } from '../languageServer/client';

export class EditorIntegrationService implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly getClient: () => TLangClient | undefined,
        private readonly logger: vscode.OutputChannel
    ) {}

    public register(): void {
        this.disposables.push(
            vscode.window.onDidChangeVisibleTextEditors(editors => this.onDidChangeVisibleTextEditors(editors))
        );
    }

    public dispose(): void {
        this.disposables.splice(0).forEach(disposable => disposable.dispose());
    }

    private onDidChangeVisibleTextEditors(editors: readonly vscode.TextEditor[]): void {
        for (const editor of editors) {
            if (!this.isPascalEditor(editor)) {
                continue;
            }

            this.logger.appendLine(`Visible Pascal editor: ${editor.document.languageId} ${editor.document.uri.fsPath}`);
            editor.options.tabSize = configuration.get<number>('format.tabSize', 2);
            this.getClient()?.onDidChangeVisibleTextEditor(editor);
        }
    }

    private isPascalEditor(editor: vscode.TextEditor): boolean {
        return editor.document.uri.scheme === 'file'
            && (editor.document.languageId === 'objectpascal' || editor.document.languageId === 'pascal');
    }
}
