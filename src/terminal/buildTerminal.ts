import * as vscode from 'vscode';
import * as ChildProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { TerminalEscape, TE_Style } from '../common/ansiStyles';
import { buildDiagnostics } from '../services/diagnosticsService';
import { FpcOutputParser } from './fpcOutputParser';

export abstract class BaseBuildTerminal implements vscode.Pseudoterminal, vscode.TerminalExitStatus {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidClose: vscode.Event<number> = this.closeEmitter.event;

    protected process?: ChildProcess.ChildProcess;
    protected buffer: string = "";
    protected errbuf: string = "";
    protected parser?: FpcOutputParser;

    public args: string[] = [];
    reason: vscode.TerminalExitReason = vscode.TerminalExitReason.Unknown;
    code: number | undefined;

    constructor(protected cwd: string, protected fpcpath: string) {
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
        this.parser = new FpcOutputParser(this.cwd, this.args);

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
        buildDiagnostics.clear();
        let has_error: boolean = false;

        for (const iter of this.parser?.diagnostics ?? []) {
            const key = iter[0];
            const item = iter[1];
            buildDiagnostics.set(vscode.Uri.file(key), item);

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

    protected parseFpcStyleError(line: string): boolean {
        const parsedLine = this.parser?.parseLine(line);
        if (!parsedLine?.handled) {
            return false;
        }

        if (parsedLine.severity === vscode.DiagnosticSeverity.Error) {
            this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Red] }));
        } else if (parsedLine.severity !== undefined) {
            this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Cyan] }));
        } else {
            this.emit(line);
        }

        return true;
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
