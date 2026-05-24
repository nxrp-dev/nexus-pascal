import * as vscode from 'vscode';
import type { FpcCommandManager } from '../commands';
import type { JediFormatter } from '../formatter';
import type { TLangClient } from '../languageServer/client';
import type { FpcProjectProvider } from '../providers/project';

let client: TLangClient | undefined;
let formatter: JediFormatter | undefined;
let logger: vscode.OutputChannel | undefined;
let projectProvider: FpcProjectProvider | undefined;
let commandManager: FpcCommandManager | undefined;

export function setLogger(value: vscode.OutputChannel): void {
    logger = value;
}

export function setClient(value: TLangClient | undefined): void {
    client = value;
}

export function setFormatter(value: JediFormatter | undefined): void {
    formatter = value;
}

export function setProjectProvider(value: FpcProjectProvider | undefined): void {
    projectProvider = value;
}

export function setCommandManager(value: FpcCommandManager | undefined): void {
    commandManager = value;
}

export function getLogger(): vscode.OutputChannel {
    if (!logger) {
        throw new Error('Nexus Pascal logger has not been initialized');
    }
    return logger;
}

export function getClient(): TLangClient | undefined {
    return client;
}

export function getFormatter(): JediFormatter | undefined {
    return formatter;
}

export function getProjectProvider(): FpcProjectProvider | undefined {
    return projectProvider;
}

export function getCommandManager(): FpcCommandManager | undefined {
    return commandManager;
}
