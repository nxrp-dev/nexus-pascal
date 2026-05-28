import { FpcTaskDefinition } from '../providers/taskDefinitions';
import { BuildMode } from '../vscode/vscodeTaskTypes';
import { BuildCommand } from './buildCommand';
import { createBuildOptionArguments } from './buildOptionArguments';
import { resolveWorkspacePath } from './taskVariableResolver';

export class FpcCommandBuilder {
    public createCommand(cwd: string, file: string, taskDefinition: FpcTaskDefinition, buildMode: BuildMode): BuildCommand {
        const compilerPath = process.env['PP'] || 'fpc';
        const args = this.createArgs(cwd, file, taskDefinition, buildMode);

        return {
            executable: compilerPath,
            args,
            cwd,
            compilerKind: 'fpc'
        };
    }

    private createArgs(cwd: string, file: string, taskDefinition: FpcTaskDefinition, buildMode: BuildMode): string[] {
        const args: string[] = [];
        const mainFile = resolveWorkspacePath(cwd, taskDefinition.file || file);

        if (mainFile) {
            args.push(mainFile);
        }

        args.push(...createBuildOptionArguments(cwd, taskDefinition.buildOption));
        args.push('-vq');

        if (buildMode === BuildMode.rebuild) {
            args.push('-B');
        }

        return args;
    }
}
