import * as vscode from 'vscode';
import * as ChildProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { TerminalEscape, TE_Style } from '../common/escape';
import { diagCollection } from './task';

export abstract class BaseBuildTerminal implements vscode.Pseudoterminal, vscode.TerminalExitStatus {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidClose: vscode.Event<number> = this.closeEmitter.event;

    protected process?: ChildProcess.ChildProcess;
    protected buffer: string = "";
    protected errbuf: string = "";
    protected currentFile: string = "";

    protected diagMaps: Map<string, vscode.Diagnostic[]>;
    public args: string[] = [];
    reason: vscode.TerminalExitReason = vscode.TerminalExitReason.Unknown;
    code: number | undefined;

    constructor(protected cwd: string, protected fpcpath: string) {
        this.diagMaps = new Map<string, vscode.Diagnostic[]>();
        this.onDidClose((e) => {});
    }

    clear() {}

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.doBuild();
    }

    close(): void {}

    protected abstract executeBuild(): Promise<number>;

    protected async doBuild(): Promise<number> {
        this.buffer = "";
        this.errbuf = "";
        this.currentFile = "";
        this.diagMaps.clear();

        this.createOutputDirectories();

        const exitCode = await this.executeBuild();

        return exitCode;
    }

    protected createOutputDirectories(args: string[] = this.args) {
        const outputFileArg = args.find(arg => arg.startsWith('-o'));
        if (outputFileArg) {
            let outfile = outputFileArg.substring(2).trim();
            if (!path.isAbsolute(outfile)) {
                outfile = path.join(this.cwd, outfile);
            }
            const dir = path.dirname(outfile);
            if (!fs.existsSync(dir)) {
                try {
                    fs.mkdirSync(dir, { recursive: true });
                } catch (error) {
                    vscode.window.showErrorMessage("Can't create output directory.(" + dir + ")");
                }
            }
        }

        const unitOutputDirArg = args.find(arg => arg.startsWith('-FU'));
        if (unitOutputDirArg) {
            let dir = unitOutputDirArg.substring(3).trim();
            if (!path.isAbsolute(dir)) {
                dir = path.join(this.cwd, dir);
            }
            if (!fs.existsSync(dir)) {
                try {
                    fs.mkdirSync(dir, { recursive: true });
                } catch (error) {
                    vscode.window.showErrorMessage("Can't create unit output directory.(" + dir + ")");
                }
            }
        }
    }

    protected async buildend() {
        diagCollection.clear();
        let has_error: boolean = false;

        for (const iter of this.diagMaps) {
            const key = iter[0];
            const item = iter[1];
            let uri: vscode.Uri | undefined = undefined;

            if (fs.existsSync(key)) {
                uri = vscode.Uri.file(key);
            } else {
                uri = this.findFile(key);
            }

            if (uri) {
                diagCollection.set(uri, item);
            } else {
                diagCollection.set(vscode.Uri.file(key), item);
            }

            if (!has_error) {
                item.forEach((d) => {
                    if (d.severity === vscode.DiagnosticSeverity.Error) {
                        has_error = true;
                    }
                });
            }
        }

        if (has_error) {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        }
    }

    protected findFile(filename: string): vscode.Uri | undefined {
        // First, search in the current working directory
        let f = path.join(this.cwd, filename);
        if (fs.existsSync(f)) {
            return vscode.Uri.file(f);
        }

        // Then search in paths specified by -Fu arguments
        for (const arg of this.args) {
            if (arg.startsWith('-Fu')) {
                let f2 = arg.substring(3);
                if (f2.startsWith('.')) {
                    f = path.join(this.cwd, f2, filename);
                } else {
                    f = path.join(f2, filename);
                }
                if (fs.existsSync(f)) {
                    return vscode.Uri.file(f);
                }
            }
        }

        // Finally, recursively search subdirectories (ignore directories starting with .)
        const searchInDirectory = (dir: string): string | undefined => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    // Skip directories starting with .
                    if (entry.isDirectory() && entry.name.startsWith('.')) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        const fullPath = path.join(dir, entry.name);
                        const result = searchInDirectory(fullPath);
                        if (result) {
                            return result;
                        }
                    } else if (entry.name === filename) {
                        return path.join(dir, entry.name);
                    }
                }
            } catch (error) {
                // Ignore directories without read permission
            }
            return undefined;
        };

        const foundPath = searchInDirectory(this.cwd);
        if (foundPath) {
            return vscode.Uri.file(foundPath);
        }

        return undefined;
    }

    protected parseFpcStyleError(line: string): boolean {
        // Match "Compiling /path/to/file.pas" to establish context
        // Support optional message ID prefix like (3104) Compiling ... or 3104) Compiling ...
        const compileMatch = line.match(/^(?:\(?\d+\)?\s+)?Compiling\s+(.*)/);
        if (compileMatch) {
            this.currentFile = compileMatch[1].trim();
            this.emit(line);
            return true;
        }

        const reg = /^(([-:\w\\\/]+)\.(p|pp|pas|lpr|dpr|inc))\(((\d+)(\,(\d+))?)\)\s(Fatal|Error|Warning|Note|Hint): \((\d+)\) (.*)/;
        const matches = reg.exec(line);

        if (matches) {
            const ln = Number(matches[5]);
            const col = Number(matches[7]) || 1;
            let file = matches[1];
            const level = matches[8];
            const msgcode = matches[9];
            const msg = matches[10];

            // If the file in error is just a filename and matches our current context's basename,
            // or if it's a relative path, try to use the currentFile context.
            if (!path.isAbsolute(file)) {
                if (this.currentFile && path.basename(this.currentFile) === path.basename(file)) {
                    file = this.currentFile;
                } else {
                    // Try to find it relative to the current file being compiled
                    if (this.currentFile) {
                        const dir = path.dirname(this.currentFile);
                        const suspectedPath = path.join(dir, file);
                        if (fs.existsSync(suspectedPath)) {
                            file = suspectedPath;
                        } else {
                            const uri = this.findFile(file);
                            if (uri) {
                                file = uri.fsPath;
                            }
                        }
                    } else {
                        const uri = this.findFile(file);
                        if (uri) {
                            file = uri.fsPath;
                        }
                    }
                }
            }

            const diag = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(ln - 1, col - 1), new vscode.Position(ln - 1, col - 1)),
                msg,
                this.getDiagnosticSeverity(level)
            );
            diag.code = Number.parseInt(msgcode);

            const fileKey = file; // Use the best path we have as the key
            if (this.diagMaps?.has(fileKey)) {
                this.diagMaps.get(fileKey)?.push(diag);
            } else {
                this.diagMaps.set(fileKey, [diag]);
            }

            if (diag.severity === vscode.DiagnosticSeverity.Error) {
                this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Red] }));
            } else {
                this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Cyan] }));
            }

            return true;
        }

        return false;
    }

    protected getDiagnosticSeverity(level: string): vscode.DiagnosticSeverity {
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

    public emit(msg: string) {
        this.writeEmitter.fire(msg + '\r\n');
    }

    protected handleProcessClose(code: number | null): Promise<void> {
        return new Promise((resolve) => {
            this.writeEmitter.fire(`Exited with code ${code}.\r\nBuild complete. \r\n\r\n`);
            
            if (code === 0) {
                this.reason = vscode.TerminalExitReason.User;
            } else {
                this.reason = vscode.TerminalExitReason.Unknown;
            }
            
            this.buildend().then(() => {
                this.closeEmitter.fire(code || 0);
                
                resolve();
            });
        });
    }

    protected stderr(data: any) {
        const output = typeof data === "string" ? data : data.toString("utf8");
        this.emit(TerminalEscape.apply({ msg: output, style: [TE_Style.Yellow] }));
    }
}
