import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionPaths } from '../services/extensionPaths';

export interface ServerExecutableInfo {
    executable: string;
    targetOS: string;
    targetCPU: string;
}

export class ServerExecutableResolver {
    public constructor(private readonly extensionPaths: ExtensionPaths) {
    }

    public resolve(): ServerExecutableInfo {
        let bundledServerRelativePath = 'pasls';
        const configuredPath = vscode.workspace
            .getConfiguration('nexusPascal.languageServer')
            .get<string>('executablePath');
        const configuredExecutable = configuredPath?.trim();

        const platform = process.platform;
        const arch = process.arch;
        let targetCPU: string;
        let targetOS: string;

        if (arch === 'x64') {
            targetCPU = 'x86_64';
            if (platform === 'win32') {
                bundledServerRelativePath = 'pasls-x86_64-win64/pasls.exe';
                targetOS = 'win64';
            } else if (platform === 'linux') {
                bundledServerRelativePath = 'pasls-x86_64-linux/pasls';
                targetOS = 'linux';
            } else if (platform === 'darwin') {
                bundledServerRelativePath = 'pasls-x86_64-darwin/pasls';
                targetOS = 'darwin';
            } else {
                throw new Error('Invalid platform');
            }
        } else if (arch === 'arm64') {
            targetCPU = 'aarch64';
            if (platform === 'linux') {
                bundledServerRelativePath = 'pasls-aarch64-linux/pasls';
                targetOS = 'linux';
            } else if (platform === 'darwin') {
                bundledServerRelativePath = 'pasls-aarch64-darwin/pasls';
                targetOS = 'darwin';
            } else if (platform === 'win32') {
                targetOS = 'win64';
                bundledServerRelativePath = 'pasls-x86_64-win64/pasls.exe';
            } else {
                throw new Error('Invalid platform');
            }
        } else {
            throw new Error('Invalid architecture');
        }

        if (process.env.DEBUG_MODE === 'true') {
            bundledServerRelativePath = platform === 'win32'
                ? 'debug/paslsproxy.exe'
                : 'debug/paslsproxy';
        }

        return {
            executable: configuredExecutable && configuredExecutable.length > 0
                ? configuredExecutable
                : path.resolve(this.extensionPaths.getFilePath('bin'), bundledServerRelativePath),
            targetOS,
            targetCPU
        };
    }
}

export function prepareServerExecutable(executable: string, logger: vscode.OutputChannel): boolean {
    logger.appendLine(`Testing executable at: ${executable}`);

    if (!fs.existsSync(executable)) {
        logger.appendLine(`Error: Language server binary not found at ${executable}`);
        return false;
    }

    if (process.platform !== 'win32') {
        try {
            fs.chmodSync(executable, 0o755);
        } catch (error) {
            logger.appendLine(`Warning: Failed to set permissions on ${executable}: ${error}`);
        }

        if (process.platform === 'darwin') {
            try {
                cp.execSync(`xattr -cr "${executable}"`, { stdio: 'ignore' });
            } catch {
            }
        }
    }

    return true;
}
