import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { env } from 'process';
import { workspace } from 'vscode';

export interface ServerEnvironment {
    [key: string]: string | undefined;
}

export function getServerEnvironment(serverStoragePath?: string): ServerEnvironment {
    const userEnvironmentVariables: ServerEnvironment = {};
    const toolchainConfig = workspace.getConfiguration('nexusPascal.toolchain');
    const compilerPath = toolchainConfig.get<string>('compilerPath');
    const lazarusDirectory = toolchainConfig.get<string>('lazarusDirectory');
    const targetOS = toolchainConfig.get<string>('targetOS');
    const targetCPU = toolchainConfig.get<string>('targetCPU');
    const languageServerConfig = workspace.getConfiguration('nexusPascal.languageServer');
    const fpcSourceDirectory = languageServerConfig.get<string>('fpcSourceDirectory');

    if (compilerPath) {
        userEnvironmentVariables['PP'] = compilerPath;
    }
    if (lazarusDirectory) {
        userEnvironmentVariables['LAZARUSDIR'] = lazarusDirectory;
    }
    if (targetOS) {
        userEnvironmentVariables['FPCTARGET'] = targetOS;
    }
    if (targetCPU) {
        userEnvironmentVariables['FPCTARGETCPU'] = targetCPU;
    }
    if (fpcSourceDirectory) {
        userEnvironmentVariables['FPCDIR'] = fpcSourceDirectory;
    }
    if (serverStoragePath) {
        userEnvironmentVariables['NEXUSLS_CACHE_DIR'] = serverStoragePath;
    }

    if (userEnvironmentVariables['PP']) {
        env['PP'] = userEnvironmentVariables['PP'];
    }
    if (userEnvironmentVariables['LAZARUSDIR']) {
        env['LAZARUSDIR'] = userEnvironmentVariables['LAZARUSDIR'];
    }
    if (userEnvironmentVariables['FPCDIR']) {
        env['FPCDIR'] = userEnvironmentVariables['FPCDIR'];
    }

    return userEnvironmentVariables;
}

export async function getGlobalUnitPaths(ppPath: string, targetOS?: string, targetCPU?: string, cwd?: string): Promise<string[]> {
    return new Promise((resolve) => {
        const dummyFile = 'be19131e-4503-4c54-9549-9f79c6d338e9.pas';
        const args = ['-vt', dummyFile];
        if (targetOS) {
            args.push(`-T${targetOS}`);
        }
        if (targetCPU) {
            args.push(`-P${targetCPU}`);
        }

        cp.exec(`"${ppPath}" ${args.join(' ')}`, { cwd }, (_error, stdout, stderr) => {
            const unitPaths: string[] = [];
            const lines = (stdout + stderr).split('\n');
            const unitPathRegex = /Using unit path:\s*(.*)/;

            for (const line of lines) {
                const match = line.match(unitPathRegex);
                if (match?.[1]) {
                    const unitPath = path.resolve(match[1].trim());
                    if (unitPath && !unitPaths.includes(unitPath)) {
                        unitPaths.push(unitPath);
                    }
                }
            }
            resolve(unitPaths);
        });
    });
}

export function getFpcSourceIncludeOptions(fpcSourceDirectory: string | undefined): string[] {
    if (!fpcSourceDirectory) {
        return [];
    }

    const includeDirectories = [
        path.join(fpcSourceDirectory, 'rtl', 'inc'),
        path.join(fpcSourceDirectory, 'rtl', 'objpas', 'classes'),
        path.join(fpcSourceDirectory, 'rtl', 'objpas', 'sysutils')
    ];

    return includeDirectories
        .filter(directory => fs.existsSync(directory) && fs.lstatSync(directory).isDirectory())
        .map(directory => `-Fi${directory}`);
}
