import { CompileOption } from '../languageServer/options';
import { LanguageServerProjectContext } from '../languageServer/projectContext';
import { PascalBuildTarget } from '../model/pascalProject';

export class PascalBuildTargetContextFactory {
    public constructor(private readonly workspaceRoot: string) {
    }

    public createCompileOption(target: PascalBuildTarget | undefined): CompileOption {
        if (!target) {
            return new CompileOption();
        }

        if (target.kind === 'lazarus') {
            const option = new CompileOption();
            option.type = 'lazarus';
            option.label = target.label;
            option.file = target.projectFile;
            option.cwd = target.cwd;
            option.buildOption = undefined;
            return option;
        }

        return new CompileOption(target.taskDefinition, this.workspaceRoot);
    }

    public createLanguageServerContext(target: PascalBuildTarget | undefined): LanguageServerProjectContext {
        if (!target) {
            return this.createLanguageServerContextFromCompileOption(new CompileOption());
        }

        if (target.kind === 'lazarus') {
            return {
                kind: 'lazarus',
                label: target.label,
                projectFile: target.projectFile,
                workingDirectory: target.cwd,
                buildMode: target.buildMode,
                fpcOptions: [],
                allowFpcGlobalUnitPaths: false
            };
        }

        return this.createLanguageServerContextFromCompileOption(this.createCompileOption(target));
    }

    private createLanguageServerContextFromCompileOption(option: CompileOption): LanguageServerProjectContext {
        const fpcOptions = option.toOptionArray()
            .filter(value => value.length > 0 && !value.startsWith('-v'));

        return {
            kind: 'fpc',
            label: option.label,
            projectFile: option.file,
            workingDirectory: option.cwd,
            fpcOptions,
            allowFpcGlobalUnitPaths: true
        };
    }
}
