import * as vscode from 'vscode';
import {
    ExecuteCommandParams,
    ExecuteCommandRequest,
    LanguageClient,
    MessageType,
    NotificationType,
    ShowMessageNotification,
    ShowMessageParams
} from 'vscode-languageclient/node';
import { getLogger } from '../services/runtime';
import { InactiveRegionNotification, InactiveRegions } from './inactiveRegions';
import { isFpcSourceDiagnosticMessage } from './serverDiagnostics';

interface SetSelectionParams {
    uri: string;
    anchor: vscode.Position;
    active: vscode.Position;
}

const SetSelectionNotification: NotificationType<SetSelectionParams> =
    new NotificationType<SetSelectionParams>('pasls/setSelection');

export class ServerNotifications {
    public constructor(
        private readonly client: LanguageClient,
        private readonly inactiveRegions: InactiveRegions
    ) {
    }

    public register(): void {
        this.client.onNotification(ShowMessageNotification.type, this.handleShowMessage);
        this.client.onNotification(InactiveRegionNotification, params => this.inactiveRegions.update(params));
        this.client.onNotification(SetSelectionNotification, this.handleSetSelection);
    }

    public async completeCode(editor: vscode.TextEditor): Promise<void> {
        const req: ExecuteCommandParams = {
            command: 'pasls.completeCode',
            arguments: [
                editor.document.uri.toString(),
                editor.selection.start
            ]
        };
        await this.client.sendRequest(ExecuteCommandRequest.type, req);
    }

    private handleShowMessage = (event: ShowMessageParams): void => {
        switch (event.type) {
            case MessageType.Info:
                vscode.window.showInformationMessage(event.message);
                break;
            case MessageType.Warning:
                vscode.window.showWarningMessage(event.message);
                break;
            case MessageType.Error:
                this.handleErrorMessage(event.message);
                break;
            default:
                break;
        }
    };

    private handleErrorMessage(message: string): void {
        const msg = message.replace(/^\u26a0\ufe0f\s*/u, '');

        if (isFpcSourceDiagnosticMessage(msg)) {
            getLogger().appendLine(`Suppressed FPC source diagnostic: ${msg}`);
            return;
        }

        if (msg.includes('@') && msg.includes(':')) {
            const parts = msg.split('@');
            const contentPart = parts[0].trim();
            const posPart = parts[1].trim().replace(';', '');
            const file = contentPart.split(':')[0].trim();
            const pos = posPart.split(':');
            const position = new vscode.Position(Number.parseInt(pos[0]) - 1, Number.parseInt(pos[1]) - 1);
            const diag = new vscode.Diagnostic(new vscode.Range(position, position), msg);
            this.client.diagnostics?.set(vscode.Uri.file(file), [diag]);

            vscode.window.showErrorMessage(msg, 'View Error').then(item => {
                if (item === 'View Error') {
                    vscode.workspace.openTextDocument(file).then(doc => {
                        vscode.window.showTextDocument(doc, { selection: new vscode.Selection(position, position) });
                    });
                }
            });
            return;
        }

        getLogger().appendLine(message);
        vscode.window.showErrorMessage(message);
    }

    private handleSetSelection = (params: SetSelectionParams): void => {
        const uri = vscode.Uri.parse(params.uri);
        vscode.workspace.openTextDocument(uri).then(doc => {
            setTimeout(() => {
                vscode.window.showTextDocument(doc, { selection: new vscode.Selection(params.anchor, params.active) });
            }, 500);
        });
    };
}
