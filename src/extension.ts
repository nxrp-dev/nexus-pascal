import * as vscode from 'vscode';
import { NexusPascalExtension } from './services/nexusPascalExtension';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const app = await NexusPascalExtension.create(context);
    if (app) {
        context.subscriptions.push(app);
    }
}

export async function deactivate(): Promise<void> {
}
