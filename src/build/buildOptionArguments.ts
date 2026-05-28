import { BuildOption } from '../providers/taskDefinitions';
import { resolveWorkspaceValue } from './taskVariableResolver';

export interface BuildOptionArgumentOptions {
    includeCustomOptions?: boolean;
}

export function createBuildOptionArguments(
    cwd: string,
    buildOption: BuildOption | undefined,
    options: BuildOptionArgumentOptions = {}
): string[] {
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
        args.push(`-o${resolveWorkspaceValue(cwd, buildOption.outputFile)}`);
    }

    buildOption.searchPath?.forEach(searchPath => args.push(`-Fu${resolveWorkspaceValue(cwd, searchPath)}`));
    buildOption.includePath?.forEach(includePath => args.push(`-Fi${resolveWorkspaceValue(cwd, includePath)}`));
    buildOption.libPath?.forEach(libPath => args.push(`-Fl${resolveWorkspaceValue(cwd, libPath)}`));

    if (buildOption.unitOutputDir) {
        args.push(`-FU${resolveWorkspaceValue(cwd, resolveUnitOutputDir(buildOption))}`);
    }
    if (buildOption.optimizationLevel) {
        args.push(`-O${buildOption.optimizationLevel}`);
    }
    if (buildOption.syntaxMode) {
        args.push(`-M${buildOption.syntaxMode}`);
    }
    if (options.includeCustomOptions) {
        buildOption.customOptions?.forEach(customOption => args.push(customOption));
    }

    return args;
}

function resolveUnitOutputDir(buildOption: BuildOption): string {
    return buildOption.unitOutputDir!
        .replace(/\$\{targetOS\}/g, buildOption.targetOS || process.platform)
        .replace(/\$\{targetCPU\}/g, buildOption.targetCPU || process.arch);
}
