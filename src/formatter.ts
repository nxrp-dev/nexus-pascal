import * as fs from 'fs';
import { env } from 'process';
import * as path from 'path';
import * as vscode from 'vscode';
import { configuration } from './common/configuration';
import { PascalLanguageClientService } from './languageServer/client';
import { ExtensionPaths } from './services/extensionPaths';

export class PascalFormatterService {
    private defaultConfigPath: string;
    private readonly isWindows: boolean;

    public constructor(
        private readonly extensionPaths: ExtensionPaths,
        private readonly getClient: () => PascalLanguageClientService | undefined,
        private readonly logger: vscode.OutputChannel
    ) {
        this.isWindows = process.platform === 'win32';
        this.defaultConfigPath = path.resolve(this.extensionPaths.getFilePath('bin'), 'jcfsettings.cfg');

        const userConfigPath = this.isWindows
            ? `${env.LOCALAPPDATA}/lazarus/jcfsettings.cfg`
            : `${env.HOME}/.lazarus/jcfsettings.cfg`;
        if (fs.existsSync(userConfigPath)) {
            this.defaultConfigPath = userConfigPath;
        }
    }

    public getCfgConfig(): string {
        const configuredPath = configuration.get<string>('format.configPath', '');
        return configuredPath || this.defaultConfigPath;
    }

    public doInit(): void {
        if (!configuration.get<boolean>('format.enabled', true)) {
            return;
        }

        vscode.languages.registerDocumentFormattingEditProvider('objectpascal', {
            provideDocumentFormattingEdits: async (document: vscode.TextDocument): Promise<vscode.TextEdit[]> => {
                try {
                    const client = this.getClient();
                    if (!client) {
                        this.logger.appendLine('Language server client is not available for formatting');
                        return [];
                    }

                    const fileUri = document.uri.toString();
                    const cfgUri = vscode.Uri.file(this.getCfgConfig()).toString();

                    this.logger.appendLine(`Formatting with pasls.formatCode: ${fileUri}`);
                    await client.formatCode(fileUri, cfgUri);
                    return [];
                } catch (error) {
                    this.logger.appendLine(`Format error: ${error}`);
                    return [];
                }
            }
        });
    }
}
