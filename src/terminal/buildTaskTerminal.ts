import * as ChildProcess from 'child_process';
import { BuildCommand, formatBuildCommand } from '../build/buildCommand';
import { TerminalEscape, TE_Style } from '../common/escape';
import { BaseBuildTerminal } from './buildTerminal';

export class BuildTaskTerminal extends BaseBuildTerminal {
    public constructor(private readonly command: BuildCommand) {
        super(command.cwd, command.executable);
        this.args = command.args;
    }

    protected async executeBuild(): Promise<number> {
        return new Promise<number>((resolve) => {
            this.emit(TerminalEscape.apply({
                msg: `Using ${this.command.compilerKind} compiler`,
                style: [TE_Style.Bold, TE_Style.Green]
            }));
            this.emit(TerminalEscape.apply({
                msg: formatBuildCommand(this.command),
                style: [TE_Style.Bold]
            }));

            this.process = ChildProcess.spawn(this.command.executable, this.command.args, { cwd: this.command.cwd });
            this.process.stdout?.on('data', data => this.handleOutput(data));
            this.process.stderr?.on('data', data => this.stderr(data));
            this.process.on('close', async code => {
                await this.handleProcessClose(code);
                resolve(code || 0);
            });
        });
    }

    private handleOutput(data: any): void {
        this.buffer += typeof data === 'string' ? data : data.toString('utf8');
        const end = this.buffer.lastIndexOf('\n');
        if (end !== -1) {
            this.processLines(this.buffer.substring(0, end));
            this.buffer = this.buffer.substring(end + 1);
        }
    }

    private processLines(lines: string): void {
        for (let line of lines.split('\n')) {
            line = line.trim();
            if (!line) {
                continue;
            }

            if (this.parseFpcStyleError(line)) {
                continue;
            }

            if (line.includes('Error:') || line.includes('Fatal:')) {
                this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Red] }));
            } else if (line.includes('Warning:')) {
                this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.BrightYellow] }));
            } else if (line.includes('Note:') || line.includes('Hint:')) {
                this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Cyan] }));
            } else {
                this.emit(line);
            }
        }
    }
}
