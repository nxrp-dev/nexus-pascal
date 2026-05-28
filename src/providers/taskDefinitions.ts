import * as vscode from 'vscode';

export class BuildOption {
	targetOS?: string;
	targetCPU?: string;
	customOptions?: string[];
	libPath?: string[];
	outputFile?: string;
	unitOutputDir?: string;
	optimizationLevel?: number;
	searchPath?: string[];
	syntaxMode?: string;
	forceRebuild?: boolean = false;
	msgIgnore?: Number[];
	cwd?: string;
	objectPath?: string;
	includePath?: string[];
}

export class FpcTaskDefinition implements vscode.TaskDefinition {
	[name: string]: any;
	readonly type: string = 'fpc';
	file?: string;
	cwd?: string;
	buildOption?: BuildOption;

	isLazarusBuildMode?: boolean;
}

export class LazarusTaskDefinition implements vscode.TaskDefinition {
	[name: string]: any;
	readonly type: string = 'lazarus';
	project?: string;
	cwd?: string;
	buildMode?: string;
	forceRebuild?: boolean = false;
}

export type NexusTaskDefinition = FpcTaskDefinition | LazarusTaskDefinition;

export function isFpcTaskDefinition(ADefinition: vscode.TaskDefinition | undefined): ADefinition is FpcTaskDefinition {
	return !!ADefinition
		&& ADefinition.type === 'fpc'
		&& typeof ADefinition.file === 'string'
		&& ADefinition.file.length > 0;
}

export function isLazarusTaskDefinition(ADefinition: vscode.TaskDefinition | undefined): ADefinition is LazarusTaskDefinition {
	return !!ADefinition
		&& ADefinition.type === 'lazarus'
		&& typeof ADefinition.project === 'string'
		&& ADefinition.project.length > 0;
}
