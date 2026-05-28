import * as ChildProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readLazarusBuildModes } from '../providers/lazarus';
import { LazarusTaskDefinition } from '../providers/taskDefinitions';
import { BuildMode } from '../vscode/vscodeTaskTypes';
import { BuildCommand } from './buildCommand';
import { resolveWorkspacePath } from './taskVariableResolver';

export class LazarusCommandBuilder {
    private lazbuildPath: string | undefined;
    private lazbuildChecked = false;

    public async createCommand(
        cwd: string,
        name: string,
        taskDefinition: LazarusTaskDefinition,
        buildMode: BuildMode
    ): Promise<BuildCommand> {
        const lazbuildPath = await this.resolveLazbuildPath();
        if (!lazbuildPath) {
            throw new Error('lazbuild not found. Please ensure Lazarus is installed and lazbuild is in your PATH, or set the Lazarus directory in settings.');
        }

        const projectFile = taskDefinition.project
            ? this.resolveProjectFile(cwd, taskDefinition.project)
            : '';
        const selectedBuildMode = this.getValidBuildMode(projectFile, taskDefinition.buildMode || name);
        const forceRebuild = taskDefinition.forceRebuild === true || buildMode === BuildMode.rebuild;
        const args: string[] = [];

        if (selectedBuildMode && selectedBuildMode !== 'Default') {
            args.push(`--build-mode=${selectedBuildMode}`);
        }
        if (forceRebuild) {
            args.push('--build-all');
        }

        args.push('--quiet');

        if (projectFile) {
            args.push(projectFile);
        }

        return {
            executable: lazbuildPath,
            args,
            cwd,
            compilerKind: 'lazbuild'
        };
    }

    private async resolveLazbuildPath(): Promise<string | undefined> {
        if (this.lazbuildChecked) {
            return this.lazbuildPath;
        }

        this.lazbuildPath = this.findLazbuildPath();
        this.lazbuildChecked = true;
        return this.lazbuildPath;
    }

    private findLazbuildPath(): string | undefined {
        if (this.canRunLazbuild('lazbuild')) {
            return 'lazbuild';
        }

        for (const candidate of this.getCandidatePaths()) {
            if (fs.existsSync(candidate) && this.canRunLazbuild(candidate)) {
                return candidate;
            }
        }

        return undefined;
    }

    private canRunLazbuild(executable: string): boolean {
        try {
            ChildProcess.execFileSync(executable, ['--version'], {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'ignore']
            });
            return true;
        } catch {
            return false;
        }
    }

    private getCandidatePaths(): string[] {
        const configuredLazarusDir = vscode.workspace
            .getConfiguration('nexusPascal.toolchain')
            .get<string>('lazarusDirectory');
        const lazarusDir = process.env.LAZARUSDIR || configuredLazarusDir;
        const executableName = process.platform === 'win32' ? 'lazbuild.exe' : 'lazbuild';
        const candidates: string[] = [];

        if (lazarusDir) {
            candidates.push(path.join(lazarusDir, executableName));
        }

        switch (process.platform) {
            case 'win32':
                candidates.push(
                    'C:\\lazarus\\lazbuild.exe',
                    'C:\\Program Files\\Lazarus\\lazbuild.exe',
                    'C:\\Program Files (x86)\\Lazarus\\lazbuild.exe'
                );
                break;
            case 'darwin':
                candidates.push(
                    '/usr/local/bin/lazbuild',
                    '/opt/local/bin/lazbuild',
                    '/Applications/Lazarus/lazbuild',
                    '/Applications/lazarus/lazbuild'
                );
                break;
            case 'linux':
                candidates.push(
                    '/usr/bin/lazbuild',
                    '/usr/local/bin/lazbuild',
                    '/opt/lazarus/lazbuild'
                );
                break;
        }

        return candidates;
    }

    private resolveProjectFile(cwd: string, projectFile: string): string {
        return resolveWorkspacePath(cwd, projectFile) || '';
    }

    private getValidBuildMode(projectFile: string, requestedBuildMode: string | undefined): string | undefined {
        const buildMode = requestedBuildMode?.trim();
        if (!buildMode || buildMode === 'Default' || !projectFile) {
            return buildMode;
        }

        const modes = readLazarusBuildModes(projectFile);
        if (modes.length === 0) {
            return undefined;
        }

        return modes.some(mode => mode.name.toLowerCase() === buildMode.toLowerCase())
            ? buildMode
            : undefined;
    }
}
