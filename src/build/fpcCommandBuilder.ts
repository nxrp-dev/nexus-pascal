import { BuildOption, FpcTaskDefinition } from '../providers/taskDefinitions';
import { BuildMode } from '../vscode/vscodeTaskTypes';
import { BuildCommand } from './buildCommand';

export class FpcCommandBuilder {
    public createCommand(cwd: string, file: string, taskDefinition: FpcTaskDefinition, buildMode: BuildMode): BuildCommand {
        const compilerPath = process.env['PP'] || 'fpc';
        const args = this.createArgs(file, taskDefinition, buildMode);

        return {
            executable: compilerPath,
            args,
            cwd,
            compilerKind: 'fpc'
        };
    }

    private createArgs(file: string, taskDefinition: FpcTaskDefinition, buildMode: BuildMode): string[] {
        const args: string[] = [];
        const mainFile = taskDefinition.file || file;

        if (mainFile) {
            args.push(mainFile);
        }

        args.push(...this.createBuildOptionArgs(taskDefinition.buildOption));
        args.push('-vq');

        if (!taskDefinition.isLazarusProject && buildMode === BuildMode.rebuild) {
            args.push('-B');
        }

        return args;
    }

    private createBuildOptionArgs(buildOption: BuildOption | undefined): string[] {
        if (!buildOption) {
            return [];
        }

        const args: string[] = [];

        if (buildOption.targetOS) {
            args.push(`-T${buildOption.targetOS}`);
        }
        if (buildOption.targetCPU) {
            args.push(`-P${buildOption.targetCPU}`);
        }
        if (buildOption.forceRebuild) {
            args.push('-B');
        }
        if (buildOption.msgIgnore && buildOption.msgIgnore.length > 0) {
            args.push(`-vm${buildOption.msgIgnore.join(',')}`);
        }
        if (buildOption.outputFile) {
            args.push(`-o${buildOption.outputFile}`);
        }

        buildOption.searchPath?.forEach(searchPath => args.push(`-Fu${searchPath}`));
        buildOption.includePath?.forEach(includePath => args.push(`-Fi${includePath}`));
        buildOption.libPath?.forEach(libPath => args.push(`-Fl${libPath}`));

        if (buildOption.unitOutputDir) {
            args.push(`-FU${this.resolveUnitOutputDir(buildOption)}`);
        }
        if (buildOption.optimizationLevel) {
            args.push(`-O${buildOption.optimizationLevel}`);
        }
        if (buildOption.syntaxMode) {
            args.push(`-M${buildOption.syntaxMode}`);
        }

        return args;
    }

    private resolveUnitOutputDir(buildOption: BuildOption): string {
        return buildOption.unitOutputDir!
            .replace(/\$\{targetOS\}/g, buildOption.targetOS || process.platform)
            .replace(/\$\{targetCPU\}/g, buildOption.targetCPU || process.arch);
    }
}
