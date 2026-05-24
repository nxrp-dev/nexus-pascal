export type CompilerKind = 'fpc' | 'lazbuild';

export interface BuildCommand {
    executable: string;
    args: string[];
    cwd: string;
    compilerKind: CompilerKind;
}

export function formatBuildCommand(command: BuildCommand): string {
    return [command.executable, ...command.args]
        .map(argument => argument.includes(' ') ? `"${argument}"` : argument)
        .join(' ');
}
