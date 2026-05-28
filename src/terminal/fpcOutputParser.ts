import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ParsedCompilerLine {
    handled: boolean;
    severity?: vscode.DiagnosticSeverity;
}

export class FpcOutputParser {
    private currentFile = '';
    private readonly diagMaps = new Map<string, vscode.Diagnostic[]>();

    public constructor(
        private readonly cwd: string,
        private readonly args: string[]
    ) {
    }

    public get diagnostics(): Map<string, vscode.Diagnostic[]> {
        return this.diagMaps;
    }

    public parseLine(line: string): ParsedCompilerLine {
        const compileMatch = line.match(/^(?:\(?\d+\)?\s+)?Compiling\s+(.*)/);
        if (compileMatch) {
            this.currentFile = compileMatch[1].trim();
            return { handled: true };
        }

        const reg = /^(([-:\w\\\/]+)\.(p|pp|pas|lpr|dpr|inc))\(((\d+)(\,(\d+))?)\)\s(Fatal|Error|Warning|Note|Hint): \((\d+)\) (.*)/;
        const matches = reg.exec(line);

        if (!matches) {
            return { handled: false };
        }

        const lineNumber = Number(matches[5]);
        const column = Number(matches[7]) || 1;
        const file = this.resolveDiagnosticFile(matches[1]);
        const level = matches[8];
        const messageCode = matches[9];
        const message = matches[10];
        const severity = this.getDiagnosticSeverity(level);

        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(
                new vscode.Position(lineNumber - 1, column - 1),
                new vscode.Position(lineNumber - 1, column - 1)
            ),
            message,
            severity
        );
        diagnostic.code = Number.parseInt(messageCode);

        if (this.diagMaps.has(file)) {
            this.diagMaps.get(file)?.push(diagnostic);
        } else {
            this.diagMaps.set(file, [diagnostic]);
        }

        return { handled: true, severity };
    }

    private resolveDiagnosticFile(fileName: string): string {
        if (path.isAbsolute(fileName)) {
            return fileName;
        }

        if (this.currentFile && path.basename(this.currentFile) === path.basename(fileName)) {
            return this.currentFile;
        }

        if (this.currentFile) {
            const suspectedPath = path.join(path.dirname(this.currentFile), fileName);
            if (fs.existsSync(suspectedPath)) {
                return suspectedPath;
            }
        }

        const uri = this.findFile(fileName);
        return uri?.fsPath ?? fileName;
    }

    private findFile(fileName: string): vscode.Uri | undefined {
        const candidates = this.getFileResolutionCandidates(fileName);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return vscode.Uri.file(candidate);
            }
        }

        return undefined;
    }

    private getFileResolutionCandidates(fileName: string): string[] {
        const candidates: string[] = [];
        const addCandidate = (candidate: string) => {
            if (!candidates.includes(candidate)) {
                candidates.push(candidate);
            }
        };

        if (path.isAbsolute(fileName)) {
            addCandidate(fileName);
            return candidates;
        }

        addCandidate(path.join(this.cwd, fileName));

        if (this.currentFile) {
            addCandidate(path.join(path.dirname(this.currentFile), fileName));
        }

        for (const searchRoot of this.getCompilerSearchRoots()) {
            addCandidate(path.join(searchRoot, fileName));
        }

        return candidates;
    }

    private getCompilerSearchRoots(): string[] {
        const roots: string[] = [];
        const addRoot = (root: string) => {
            const resolvedRoot = path.isAbsolute(root) ? root : path.join(this.cwd, root);
            if (!roots.includes(resolvedRoot)) {
                roots.push(resolvedRoot);
            }
        };

        for (const arg of this.args) {
            if (arg.startsWith('-Fu') || arg.startsWith('-Fi')) {
                const rawRoot = arg.substring(3).trim();
                if (rawRoot) {
                    addRoot(rawRoot);
                }
            }
        }

        return roots;
    }

    private getDiagnosticSeverity(level: string): vscode.DiagnosticSeverity {
        switch (level) {
            case 'Fatal':
            case 'Error':
                return vscode.DiagnosticSeverity.Error;
            case 'Warning':
                return vscode.DiagnosticSeverity.Warning;
            case 'Note':
                return vscode.DiagnosticSeverity.Information;
            case 'Hint':
                return vscode.DiagnosticSeverity.Hint;
            default:
                return vscode.DiagnosticSeverity.Information;
        }
    }
}
