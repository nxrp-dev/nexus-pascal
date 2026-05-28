import * as vscode from 'vscode';
import { FpcCommandBuilder } from '../build/fpcCommandBuilder';
import { LazarusCommandBuilder } from '../build/lazarusCommandBuilder';
import { FpcTaskDefinition, LazarusTaskDefinition } from '../providers/taskDefinitions';
import { BuildTaskTerminal } from '../terminal/buildTaskTerminal';
import { BuildMode, FPC_TASK_TYPE, LAZARUS_TASK_TYPE } from './vscodeTaskTypes';

export { BuildMode } from './vscodeTaskTypes';

export class FpcTask extends vscode.Task {
    private buildMode: BuildMode = BuildMode.normal;
    private readonly fpcCommandBuilder = new FpcCommandBuilder();

    public get BuildMode(): BuildMode {
        return this.buildMode;
    }

    public set BuildMode(value: BuildMode) {
        this.buildMode = value;
    }

    public constructor(cwd: string, name: string, file: string, taskDefinition: FpcTaskDefinition) {
        super(
            taskDefinition,
            vscode.TaskScope.Workspace,
            `${name}`,
            FPC_TASK_TYPE,
            new FpcCustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                const command = this.fpcCommandBuilder.createCommand(cwd, file, taskDefinition, this.buildMode);
                return new BuildTaskTerminal(command);
            })
        );
    }
}

export class LazarusTask extends vscode.Task {
    private buildMode: BuildMode = BuildMode.normal;
    private readonly commandBuilder = new LazarusCommandBuilder();

    public get BuildMode(): BuildMode {
        return this.buildMode;
    }

    public set BuildMode(value: BuildMode) {
        this.buildMode = value;
    }

    public constructor(cwd: string, name: string, taskDefinition: LazarusTaskDefinition) {
        super(
            taskDefinition,
            vscode.TaskScope.Workspace,
            `${name}`,
            LAZARUS_TASK_TYPE,
            new FpcCustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                const command = await this.commandBuilder.createCommand(cwd, name, taskDefinition, this.buildMode);
                return new BuildTaskTerminal(command);
            })
        );
    }
}

class FpcCustomExecution extends vscode.CustomExecution {
}
