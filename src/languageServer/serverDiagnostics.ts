import * as path from 'path';
import * as vscode from 'vscode';

export function isFpcSourceDiagnosticMessage(message: string): boolean {
    const fpcSourceDirectory = vscode.workspace
        .getConfiguration('nexusPascal.languageServer')
        .get<string>('fpcSourceDirectory');
    if (!fpcSourceDirectory) {
        return false;
    }

    const messagePath = getMessagePath(message);
    if (!messagePath) {
        return false;
    }

    const normalizedMessagePath = normalizePathForCompare(messagePath);
    const normalizedFpcSourceDirectory = normalizePathForCompare(fpcSourceDirectory);

    return normalizedMessagePath === normalizedFpcSourceDirectory
        || normalizedMessagePath.startsWith(normalizedFpcSourceDirectory + path.sep);
}

function normalizePathForCompare(value: string): string {
    return path.normalize(value).toLowerCase();
}

function getMessagePath(message: string): string | undefined {
    const locationMatch = message.match(/([A-Za-z]:\\[^()]+)\(\d+,\d+\)/);
    if (locationMatch?.[1]) {
        return locationMatch[1];
    }

    const quotedMessageMatch = message.match(/^([A-Za-z]:\\[^:]+):\s+"/);
    return quotedMessageMatch?.[1];
}
