import * as vscode from 'vscode';
import { FpcBuildTarget, LazarusBuildTarget, PascalBuildTarget } from '../model/pascalProject';
import { FpcTaskProvider, LazarusTaskProvider } from '../providers/task';
import { FpcTaskDefinition, LazarusTaskDefinition } from '../providers/taskDefinitions';

export class PascalTaskFactory {
    public constructor(
        private readonly fpcTaskProvider: FpcTaskProvider,
        private readonly lazarusTaskProvider: LazarusTaskProvider
    ) {
    }

    public createTask(target: PascalBuildTarget): vscode.Task {
        if (target.kind === 'lazarus') {
            return this.createLazarusTargetTask(target);
        }

        return this.createFpcTargetTask(target);
    }

    public createFpcTask(label: string, projectFile: string, taskDefinition: FpcTaskDefinition): vscode.Task {
        return this.fpcTaskProvider.getTask(label, projectFile, taskDefinition);
    }

    public createLazarusTask(
        label: string,
        projectFile: string,
        cwd: string,
        buildMode?: string,
        forceRebuild?: boolean
    ): vscode.Task {
        const definition = new LazarusTaskDefinition();
        definition.project = projectFile;
        definition.cwd = cwd;
        definition.buildMode = buildMode;
        definition.forceRebuild = forceRebuild;

        return this.lazarusTaskProvider.getTask(label, definition);
    }

    private createFpcTargetTask(target: FpcBuildTarget): vscode.Task {
        return this.createFpcTask(target.label, target.projectFile, target.taskDefinition);
    }

    private createLazarusTargetTask(target: LazarusBuildTarget): vscode.Task {
        return this.createLazarusTask(
            target.label,
            target.projectFile,
            target.cwd,
            target.buildMode,
            target.taskDefinition?.forceRebuild
        );
    }
}
