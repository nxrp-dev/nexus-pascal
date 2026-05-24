import * as vscode from 'vscode';
import { PascalLanguageClientService } from '../languageServer/client';

export class LanguageClientHandle {
    private client?: PascalLanguageClientService;

    public get current(): PascalLanguageClientService | undefined {
        return this.client;
    }

    public set(client: PascalLanguageClientService | undefined): void {
        this.client = client;
    }

    public async restart(): Promise<void> {
        await this.client?.restart();
    }

    public async completeCode(editor: vscode.TextEditor): Promise<void> {
        await this.client?.doCodeComplete(editor);
    }
}
