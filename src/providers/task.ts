/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CompileOption } from '../languageServer/options';
import * as ChildProcess from "child_process";
import path = require('path');
import { TerminalEscape, TE_Style } from '../common/escape';
import * as fs from 'fs';
import { getClient } from '../services/runtime';
import { DiagnosticSeverity } from 'vscode';
import { LazarusBuildTerminal } from './lazarusBuildTerminal';
import { BaseBuildTerminal } from './baseBuildTerminal';
import { FpcTaskDefinition, LazarusTaskDefinition, isFpcTaskDefinition, isLazarusTaskDefinition } from './taskDefinitions';
export { BuildOption, FpcTaskDefinition, LazarusTaskDefinition, NexusTaskDefinition, isFpcTaskDefinition, isLazarusTaskDefinition } from './taskDefinitions';

export class FpcTaskProvider implements vscode.TaskProvider {
	static FpcTaskType = 'fpc';
	private defineMap: Map<string, FpcTaskDefinition> = new Map<string, FpcTaskDefinition>();
	public taskMap: Map<string, vscode.Task> = new Map<string, vscode.Task>();
	public GetTaskDefinition(name: string): FpcTaskDefinition | undefined {
		return this.defineMap.get(name);
	}
	constructor(private workspaceRoot: string, private cwd: string | undefined = undefined) {
	}

	public async clean() {
		this.defineMap.clear();
		this.taskMap.clear();
	}
	public async provideTasks(): Promise<vscode.Task[]> {
		return this.getTasks();
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		if (!isFpcTaskDefinition(_task.definition)) {
			return undefined;
		}

		const definition = _task.definition;

		if (this.taskMap.has(_task.name)) {
			let task = this.taskMap.get(_task.name);
			task!.definition = definition;
			return task;
		}

		if (definition.cwd) {
			let rawCwd = definition.cwd;
			if (rawCwd.includes('${workspaceFolder}')) {
				this.cwd = rawCwd.replace(/\$\{workspaceFolder\}/g, this.workspaceRoot);
			} else if (path.isAbsolute(rawCwd)) {
				this.cwd = rawCwd;
			} else {
				this.cwd = path.join(this.workspaceRoot, rawCwd);
			}
		}

		let task = this.getTask(_task.name, definition.file, definition);
		this.taskMap.set(_task.name, task);
		return task;
	}

	private async getTasks(): Promise<vscode.Task[]> {
		return [];
	}
	public getTask(name: string, file?: string, definition?: FpcTaskDefinition): vscode.Task {
		this.defineMap.set(name, definition!);
		let task = new FpcTask(this.cwd ? this.cwd : this.workspaceRoot, name, file!, definition!);

		return task;
	}

	public refresh() {
		getClient()?.restart();
	}
}

export class LazarusTaskProvider implements vscode.TaskProvider {
	static LazarusTaskType = 'lazarus';
	public taskMap: Map<string, vscode.Task> = new Map<string, vscode.Task>();

	constructor(private workspaceRoot: string) {
	}

	public async provideTasks(): Promise<vscode.Task[]> {
		return [];
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		if (!isLazarusTaskDefinition(_task.definition)) {
			return undefined;
		}

		const task = this.getTask(_task.name, _task.definition);
		this.taskMap.set(_task.name, task);
		return task;
	}

	public getTask(name: string, definition: LazarusTaskDefinition): vscode.Task {
		const task = new LazarusTask(this.resolveCwd(definition.cwd), name, definition);
		this.taskMap.set(name, task);
		return task;
	}

	private resolveCwd(rawCwd?: string): string {
		if (!rawCwd) {
			return this.workspaceRoot;
		}
		if (rawCwd.includes('${workspaceFolder}')) {
			return rawCwd.replace(/\$\{workspaceFolder\}/g, this.workspaceRoot);
		}
		if (path.isAbsolute(rawCwd)) {
			return rawCwd;
		}
		return path.join(this.workspaceRoot, rawCwd);
	}
}

export enum BuildMode {
	normal,
	rebuild
}
export class FpcTask extends vscode.Task {
	private _BuildMode: BuildMode = BuildMode.normal;
	public get BuildMode(): BuildMode {
		return this._BuildMode;
	}
	public set BuildMode(value: BuildMode) {
		this._BuildMode = value;
	}
	constructor(cwd: string, name: string, file: string, taskDefinition: FpcTaskDefinition) {

		super(
			taskDefinition,
			vscode.TaskScope.Workspace,
			`${name}`,
			FpcTaskProvider.FpcTaskType,
			new FpcCustomExecution(async (): Promise<vscode.Pseudoterminal> => {
				let buildOptionString: string = '';
				let realDefinition=taskProvider.GetTaskDefinition(name);
				if (realDefinition === undefined) {
					realDefinition = taskDefinition;
				}
				if (realDefinition?.buildOption) {
					let opt: CompileOption = new CompileOption(realDefinition);
					buildOptionString = opt.toOptionString();
				}
				if (!buildOptionString) {
					buildOptionString = "";
				}

				if (!realDefinition) {
					realDefinition = {
						type: FpcTaskProvider.FpcTaskType,
						file: file,

					};

				}
				buildOptionString += '-vq '; //show message numbers 

				let fpcpath = process.env['PP'];
				if (fpcpath === '') {
					fpcpath = 'fpc';
				}

				const isLazarusProject = taskDefinition?.isLazarusProject;
				
				let terminal: FpcBuildTaskTerminal | LazarusBuildTerminal;
				
				if (isLazarusProject) {
					const buildMode = taskDefinition.buildMode || name;
					terminal = new LazarusBuildTerminal(cwd, fpcpath!, taskDefinition?.lazarusProjectFile, buildMode);
					(terminal as LazarusBuildTerminal).forceRebuild = this._BuildMode === BuildMode.rebuild;
				} else {
					terminal = new FpcBuildTaskTerminal(cwd, fpcpath!);
				}
				
				const mainFileForCmd = taskDefinition?.file;
				if (terminal instanceof LazarusBuildTerminal) {
					// For Lazarus projects, the terminal handles compilation strategy internally
					terminal.args = `${mainFileForCmd} ${buildOptionString}`.split(' ');
				} else {
					// For FPC projects, use traditional approach
					terminal.args = `${mainFileForCmd} ${buildOptionString}`.split(' ');
					if (this._BuildMode == BuildMode.rebuild) {
						terminal.args.push('-B');
					}
				}
				return terminal;

			})
		);
	}


}

export class LazarusTask extends vscode.Task {
	private _BuildMode: BuildMode = BuildMode.normal;
	public get BuildMode(): BuildMode {
		return this._BuildMode;
	}
	public set BuildMode(value: BuildMode) {
		this._BuildMode = value;
	}

	constructor(cwd: string, name: string, taskDefinition: LazarusTaskDefinition) {
		super(
			taskDefinition,
			vscode.TaskScope.Workspace,
			`${name}`,
			LazarusTaskProvider.LazarusTaskType,
			new FpcCustomExecution(async (): Promise<vscode.Pseudoterminal> => {
				let fpcpath = process.env['PP'];
				if (!fpcpath) {
					fpcpath = 'fpc';
				}

				const buildMode = taskDefinition.buildMode || name;
				const terminal = new LazarusBuildTerminal(cwd, fpcpath, taskDefinition.project, buildMode);
				terminal.forceRebuild = taskDefinition.forceRebuild === true || this._BuildMode === BuildMode.rebuild;
				terminal.args = taskDefinition.project ? [taskDefinition.project] : [];
				return terminal;
			})
		);
	}
}

class FpcCustomExecution extends vscode.CustomExecution {

}
export var diagCollection: vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection('fpc');

class FpcBuildTaskTerminal extends BaseBuildTerminal {
	constructor(cwd: string, fpcpath: string) {
		super(cwd, fpcpath);
	}

	protected async executeBuild(): Promise<number> {
		return new Promise<number>((resolve) => {
			this.emit(TerminalEscape.apply({ msg: `${this.fpcpath} ${this.args.join(' ')}\r\n`, style: [TE_Style.Bold] }));
			this.process = ChildProcess.spawn(this.fpcpath, this.args, { cwd: this.cwd });

			this.process.stdout?.on('data', this.stdout.bind(this));
			this.process.stderr?.on('data', this.stderr.bind(this));
			this.process.on('close', async (code) => {
				await this.handleProcessClose(code);
				resolve(code || 0);
			});
		});
	}

	private stdout(data: any) {
		if (typeof data === "string") {
			this.buffer += data;
		} else {
			this.buffer += data.toString("utf8");
		}
		const end = this.buffer.lastIndexOf('\n');
		if (end !== -1) {
			this.onOutput(this.buffer.substr(0, end));
			this.buffer = this.buffer.substr(end + 1);
		}
	}

	private onOutput(lines: string) {
		const ls = lines.split('\n');
		
		ls.forEach(line => {
			line = line.trim();
			if (!line) { return; }

			if (this.parseFpcStyleError(line)) {
				return;
			}

			if (line.startsWith('Error:') || line.startsWith('Fatal:')) {
				this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Red] }));
			} else if (line.startsWith('Warning:')) {
				this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.BrightYellow] }));
			} else if (line.startsWith('Note:') || line.startsWith('Hint:')) {
				this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Cyan] }));
			} else {
				this.emit(line);
			}
		});
	}
}

export let taskProvider: FpcTaskProvider;
export let lazarusTaskProvider: LazarusTaskProvider;

if (vscode.workspace.workspaceFolders) {
	const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
	taskProvider = new FpcTaskProvider(workspaceRoot);
	lazarusTaskProvider = new LazarusTaskProvider(workspaceRoot);
}

