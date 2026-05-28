import * as path from 'path';

export function resolveWorkspacePath(cwd: string, value: string | undefined): string | undefined {
    if (!value) {
        return value;
    }

    const resolved = value.replace(/\$\{workspaceFolder\}/g, cwd);
    return path.isAbsolute(resolved) ? resolved : path.join(cwd, resolved);
}

export function resolveWorkspaceValue(cwd: string, value: string | undefined): string | undefined {
    return value?.replace(/\$\{workspaceFolder\}/g, cwd);
}
