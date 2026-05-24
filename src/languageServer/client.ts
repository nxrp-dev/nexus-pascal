/**
 * @File   : client.ts
 * @Author :  (coolchyni)
 * @Link   : 
 * @Date   : 2/16/2022, 11:26:06 PM
 */
import path = require('path');
import * as vscode from 'vscode';
import { workspace } from 'vscode';
import {
    State,
    NotificationType,
    LanguageClient,
    ServerOptions,
    Executable,
    LanguageClientOptions,
    ShowMessageNotification,
    ShowMessageParams,
    MessageType,
    ExecuteCommandRequest,
    ExecuteCommandParams,
    ErrorHandler,
    Message,
    ErrorHandlerResult,
    ErrorAction,
    CloseHandlerResult,
    CloseAction,
    StreamInfo} from 'vscode-languageclient/node';
import * as net from 'net';

import { FpcProjectProvider } from '../providers/project';
import * as util from '../common/util';
import { InitializationOptions } from "./options";
import { env } from 'process';
import { getLogger } from '../services/runtime';
import * as cp from 'child_process';
import * as fs from 'fs';

interface InputRegion {
    startLine: number;
    startCol:number;
    endLine: number;
    endCol:number;
}

interface DecorationRangesPair {
    decoration: vscode.TextEditorDecorationType;
    ranges: vscode.Range[];
}

interface InactiveRegionParams {
    uri: string;
    fileVersion: number;
    regions: InputRegion[];
}

// Notifications from the server
const InactiveRegionNotification: NotificationType<InactiveRegionParams> = new NotificationType<InactiveRegionParams>('pasls.inactiveRegions');

//set cursor pos
interface SetSelectionParams {
    uri: string;
    /**
    * The position at which the selection starts.
    * This position might be before or after {@link Selection.active active}.
    */
    anchor: vscode.Position;

    /**
     * The position of the cursor.
     * This position might be before or after {@link Selection.anchor anchor}.
     */
    active: vscode.Position;
}
const SetSelectionNotification: NotificationType<SetSelectionParams> = new NotificationType<SetSelectionParams>('pasls/setSelection');

function GetEnvironmentVariables(): { [key: string]: string | undefined } {
    let userEnvironmentVariables: { [key: string]: string | undefined } = {};
    const toolchainConfig = workspace.getConfiguration('nexusPascal.toolchain');
    const compilerPath = toolchainConfig.get<string>('compilerPath');
    const lazarusDirectory = toolchainConfig.get<string>('lazarusDirectory');
    const targetOS = toolchainConfig.get<string>('targetOS');
    const targetCPU = toolchainConfig.get<string>('targetCPU');
    const languageServerConfig = workspace.getConfiguration('nexusPascal.languageServer');
    const fpcSourceDirectory = languageServerConfig.get<string>('fpcSourceDirectory');

    if (compilerPath) {
        userEnvironmentVariables['PP'] = compilerPath;
    }
    if (lazarusDirectory) {
        userEnvironmentVariables['LAZARUSDIR'] = lazarusDirectory;
    }
    if (targetOS) {
        userEnvironmentVariables['FPCTARGET'] = targetOS;
    }
    if (targetCPU) {
        userEnvironmentVariables['FPCTARGETCPU'] = targetCPU;
    }
    if (fpcSourceDirectory) {
        userEnvironmentVariables['FPCDIR'] = fpcSourceDirectory;
    }

    if (userEnvironmentVariables['PP']) env['PP'] = userEnvironmentVariables['PP'];
    if (userEnvironmentVariables['LAZARUSDIR']) env['LAZARUSDIR'] = userEnvironmentVariables['LAZARUSDIR'];
    if (userEnvironmentVariables['FPCDIR']) env['FPCDIR'] = userEnvironmentVariables['FPCDIR'];

    return userEnvironmentVariables;
}

async function getGlobalUnitPaths(ppPath: string, targetOS?: string, targetCPU?: string, cwd?: string): Promise<string[]> {
    return new Promise((resolve) => {
        const dummyFile = 'be19131e-4503-4c54-9549-9f79c6d338e9.pas';
        let args = ['-vt', dummyFile];
        if (targetOS) args.push(`-T${targetOS}`);
        if (targetCPU) args.push(`-P${targetCPU}`);

        cp.exec(`"${ppPath}" ${args.join(' ')}`, { cwd: cwd }, (error, stdout, stderr) => {
            const unitPaths: string[] = [];
            const lines = (stdout + stderr).split('\n');
            const unitPathRegex = /Using unit path:\s*(.*)/;
            
            for (const line of lines) {
                const match = line.match(unitPathRegex);
                if (match && match[1]) {
                    const p = path.resolve(match[1].trim());
                    if (p && !unitPaths.includes(p)) {
                        unitPaths.push(p);
                    }
                }
            }
            resolve(unitPaths);
        });
    });
}

function getFpcSourceIncludeOptions(fpcSourceDirectory: string | undefined): string[] {
    if (!fpcSourceDirectory) {
        return [];
    }

    const includeDirectories = [
        path.join(fpcSourceDirectory, 'rtl', 'inc'),
        path.join(fpcSourceDirectory, 'rtl', 'objpas', 'classes'),
        path.join(fpcSourceDirectory, 'rtl', 'objpas', 'sysutils')
    ];

    return includeDirectories
        .filter(directory => fs.existsSync(directory) && fs.lstatSync(directory).isDirectory())
        .map(directory => `-Fi${directory}`);
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

function isFpcSourceDiagnosticMessage(message: string): boolean {
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

export class TLangClient implements ErrorHandler  {
    private client: LanguageClient | undefined;
    private targetOS?: string;
    private targetCPU?: string;
    private inactiveRegionsDecorations = new Map<string, DecorationRangesPair>();
    private initLock: Promise<void> = Promise.resolve();

    constructor(
        public projProvider: FpcProjectProvider
    ) {
        this.client = undefined;
    };

      /**
     * An error has occurred while writing or reading from the connection.
     *
     * @param error - the error received
     * @param message - the message to be delivered to the server if know.
     * @param count - a count indicating how often an error is received. Will
     *  be reset if a message got successfully send or received.
     */
    error(error: Error, message: Message | undefined, count: number | undefined): ErrorHandlerResult{
        getLogger().appendLine(error.name+' '+error.message);
        return  {action:ErrorAction.Continue} as ErrorHandlerResult;
    }
    /**
    * The connection to the server got closed.
    */
    closed(): CloseHandlerResult{
        getLogger().appendLine("Server closed.");
        return  {action:CloseAction.Restart} as CloseHandlerResult;
    }

    private getLanguageServerFileName(): string {
        let extensionProcessName: string = 'pasls';
        let paslspath = vscode.workspace.getConfiguration('nexusPascal.languageServer').get<string>('executablePath');
      

        const plat: NodeJS.Platform = process.platform;
        const arch = process.arch;
     
        if (arch === 'x64') {
            this.targetCPU = 'x86_64';
            if (plat === 'win32') {            
                extensionProcessName = 'pasls-x86_64-win64/pasls.exe';
                this.targetOS = 'win64';
            } else if (plat === 'linux') {
                extensionProcessName = 'pasls-x86_64-linux/pasls';
                this.targetOS = 'linux';
            } else if (plat == 'darwin') {
                extensionProcessName = 'pasls-x86_64-darwin/pasls';
                this.targetOS = 'darwin';
            }
            else {
                throw "Invalid Platform";
            }
        } else if (arch === 'arm64') {
            this.targetCPU = 'aarch64';
            if (plat === 'linux') {
                extensionProcessName = 'pasls-aarch64-linux/pasls';
                this.targetOS = 'linux';
            } else if (plat == 'darwin') {
                extensionProcessName = 'pasls-aarch64-darwin/pasls';
                this.targetOS = 'darwin';
            }
            else if (plat == 'win32') {
                this.targetOS = 'win64';
                extensionProcessName = 'pasls-x86_64-win64/pasls.exe';
            } else {
                throw "Invalid Platform";
            }
        } else {
            throw "Invalid arch";
        }
        if(process.env.DEBUG_MODE==='true'){
            if(plat==='win32')  {
                extensionProcessName = 'debug/paslsproxy.exe';
            }else{
                extensionProcessName = 'debug/paslsproxy';
            }
        }
        
        if(paslspath && paslspath.length>0){
            return paslspath;
        }
        return path.resolve(util.getExtensionFilePath("bin"), extensionProcessName);
    };
    async doOnReady() {
        this.client?.onNotification(ShowMessageNotification.type, (e: ShowMessageParams) => {
            //vscode.window.showErrorMessage(e.message);

            switch (e.type) {
                case MessageType.Info:
                    vscode.window.showInformationMessage(e.message);
                    break;
                case MessageType.Warning:
                    vscode.window.showWarningMessage(e.message);
                    break;
                case MessageType.Error:
                    let msg = e.message;
                    if(msg.startsWith('⚠️')){
                        msg=msg.substring(2).trim();
                    }
                    if (isFpcSourceDiagnosticMessage(msg)) {
                        getLogger().appendLine(`Suppressed FPC source diagnostic: ${msg}`);
                        return;
                    }
                    if (msg.includes('@') && msg.includes(':')) {
                        // Format: '... file: "..." @ line:col;'
                        let parts = msg.split('@');
                        let contentPart = parts[0].trim();
                        let posPart = parts[1].trim().replace(';', '');

                        let file = contentPart.split(':')[0].trim();
                        
                        let pos = posPart.split(':');
                        let position: vscode.Position = new vscode.Position(Number.parseInt(pos[0]) - 1, Number.parseInt(pos[1]) - 1);

                        let diag = new vscode.Diagnostic(new vscode.Range(position, position), msg);
                        this.client?.diagnostics?.set(vscode.Uri.file(file), [diag]);

                        vscode.window.showErrorMessage(msg, 'View Error').then(item => {
                            if (item === 'View Error') {
                                vscode.workspace.openTextDocument(file).then(doc => {
                                    vscode.window.showTextDocument(doc, { selection: new vscode.Selection(position, position) });
                                });
                            }
                        });
                    } else {
                        getLogger().appendLine(e.message);
                        vscode.window.showErrorMessage(e.message);
                    }


                    break;

                default:
                    break;
            }


        });
        this.client?.onNotification(InactiveRegionNotification, (params: InactiveRegionParams) => {
            //const settings: CppSettings = new CppSettings(this.RootUri);
            const opacity: number | undefined = 0.3;//settings.inactiveRegionOpacity;
            if (opacity !== null && opacity !== undefined) {
                let backgroundColor: string | undefined = "";//settings.inactiveRegionBackgroundColor;
                if (backgroundColor === "") {
                    backgroundColor = undefined;
                }
                let color: string | undefined = "";//settings.inactiveRegionForegroundColor;
                if (color === "") {
                    color = undefined;
                }
                const decoration: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
                    opacity: opacity.toString(),
                    backgroundColor: backgroundColor,
                    color: color,
                    rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
                });
                // We must convert to vscode.Ranges in order to make use of the API's
                const ranges: vscode.Range[] = [];
                params.regions.forEach(element => {
                    const newRange: vscode.Range = new vscode.Range(element.startLine-1, element.startCol-1, element.endLine-1, element.endCol-1);
                    ranges.push(newRange);
                });
                // Find entry for cached file and act accordingly
                const valuePair: DecorationRangesPair | undefined = this.inactiveRegionsDecorations.get(params.uri);
                if (valuePair) {
                    // Disposing of and resetting the decoration will undo previously applied text decorations
                    valuePair.decoration.dispose();
                    valuePair.decoration = decoration;
                    // As vscode.TextEditor.setDecorations only applies to visible editors, we must cache the range for when another editor becomes visible
                    valuePair.ranges = ranges;
                } else { // The entry does not exist. Make a new one
                    const toInsert: DecorationRangesPair = {
                        decoration: decoration,
                        ranges: ranges
                    };
                    this.inactiveRegionsDecorations.set(params.uri, toInsert);
                }
                //if (settings.dimInactiveRegions && params.fileVersion === openFileVersions.get(params.uri)) {
                // Apply the decorations to all *visible* text editors
                const editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === params.uri);
                for (const e of editors) {
                    e.setDecorations(decoration, ranges);
                }
                //}
            }

        });

        this.client?.onNotification(SetSelectionNotification, (params: SetSelectionParams) => {
            let uri=vscode.Uri.parse(params.uri);
            vscode.workspace.openTextDocument(uri).then(doc => {
                setTimeout(() => {
                    vscode.window.showTextDocument(doc,  { selection: new vscode.Selection(params.anchor, params.active) });
                }, 500);
            });
        });

    }
    async doInit() {
        const currentLock = this.initLock;
        let resolveLock: () => void;
        this.initLock = new Promise(resolve => resolveLock = resolve);
        await currentLock;
        try {
            await this._doInit();
        } finally {
            resolveLock!();
        }
    }

    private async _doInit() {
        if (this.client) {
            await this.stopInternal();
        }

        console.log("Greetings from pascal-language-server 🙏");
        let executable: string = this.getLanguageServerFileName();
        getLogger().appendLine(`Testing executable at: ${executable}`);

        if (!fs.existsSync(executable)) {
            getLogger().appendLine(`Error: Language server binary not found at ${executable}`);
            return;
        }

        if(process.platform!='win32'){
            try {
                fs.chmodSync(executable, 0o755);
            } catch (e) {
                getLogger().appendLine(`Warning: Failed to set permissions on ${executable}: ${e}`);
            }

            // On macOS, remove quarantine attribute to bypass Gatekeeper
            if (process.platform === 'darwin') {
                try {
                    cp.execSync(`xattr -cr "${executable}"`, { stdio: 'ignore' });
                } catch (e) {
                    // Ignore errors - xattr may fail if no quarantine attribute exists
                }
            }
        }
        // TODO: download the executable for the active platform
        // https://github.com/genericptr/pascal-language-server/releases/download/x86_64-darwin/pasls
        // if (!executable) {
        // 	let target = 'x86_64-darwin';
        // 	executable = context.asAbsolutePath(path.join('bin', target, 'pasls'));
        // }

        console.log("executable: " + executable);

        const envVars = GetEnvironmentVariables();
        getLogger().appendLine(`Environment PP: ${envVars['PP']}`);
        getLogger().appendLine(`Environment FPCDIR: ${envVars['FPCDIR']}`);
        getLogger().appendLine(`Environment LAZARUSDIR: ${envVars['LAZARUSDIR']}`);

        const fpcDir = envVars['FPCDIR'];
        getLogger().appendLine("fpcDir: " + fpcDir);
        if (!fpcDir || !fs.existsSync(fpcDir) || !fs.lstatSync(fpcDir).isDirectory()) {
            const selectFolder = vscode.l10n.t("Select Folder");
            const openSettings = vscode.l10n.t("Open Settings");
            vscode.window.showErrorMessage(
                vscode.l10n.t("FPC source directory is not set or invalid. Please set the Free Pascal source directory used by the language server."),
                selectFolder,
                openSettings
            ).then(selection => {
                if (selection === selectFolder) {
                    vscode.commands.executeCommand('nexusPascal.languageServer.selectFpcSourceDirectory');
                } else if (selection === openSettings) {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'nexusPascal.languageServer.fpcSourceDirectory');
                }
            });
            return;
        }

        let serverOptions: ServerOptions;
        // if (process.env.DEBUG_MODE === 'true') {
        //     const port = 9898;
        //     getLogger().appendLine(`Debug mode detected, connecting to language server on port ${port}`);
        //     serverOptions = () => {
        //         let socket = net.connect({ port });
        //         let result: StreamInfo = {
        //             writer: socket,
        //             reader: socket
        //         };
        //         return Promise.resolve(result);
        //     };
        // } else {
            let run: Executable = {
                command: executable,
                //args: ["-l","log.txt"],
                options: {
                    env: {
                        ...process.env,
                        ...envVars
                    }
                }
            };
            serverOptions = {
                run,
                debug: run
            };
        //}

        var initializationOptions = new InitializationOptions();

        const projectContext = await this.projProvider.getDefaultLanguageServerContext();
        initializationOptions.updateByProjectContext(projectContext);
        getLogger().appendLine(`Language server project context: ${projectContext.kind} ${projectContext.projectFile}`);

        const fpcSourceIncludeOptions = getFpcSourceIncludeOptions(envVars['FPCDIR']);
        for (const includeOption of fpcSourceIncludeOptions) {
            if (!initializationOptions.fpcOptions.includes(includeOption)) {
                initializationOptions.fpcOptions.push(includeOption);
            }
        }
        getLogger().appendLine(`Added ${fpcSourceIncludeOptions.length} FPC source include paths to language server context`);

        if (projectContext.allowFpcGlobalUnitPaths) {
            const globalUnitPaths = await getGlobalUnitPaths(
                envVars['PP'] || 'fpc',
                this.targetOS,
                this.targetCPU,
                projectContext.workingDirectory
            );
            globalUnitPaths.forEach(p => {
                const fu = `-Fu${p}`;
                if (!initializationOptions.fpcOptions.includes(fu)) {
                    initializationOptions.fpcOptions.push(fu);
                }
            });
            getLogger().appendLine(`Added ${globalUnitPaths.length} FPC global unit paths to language server context`);
        } else {
            getLogger().appendLine('Skipped FPC global unit paths for Lazarus language server context');
        }

        // client extensions configure their server
        let clientOptions: LanguageClientOptions = {
            initializationOptions: initializationOptions,
            errorHandler: this,
            // workspaceFolder: folder,
            documentSelector: [
                { scheme: 'file', language: 'objectpascal' },
                { scheme: 'untitled', language: 'objectpascal' },
                { scheme: 'file', language: 'pascal' },
                { scheme: 'untitled', language: 'pascal' }
            ]
        }

        getLogger().appendLine('Language server document selector: objectpascal, pascal');
        this.client = new LanguageClient('nexusPascal.languageServer', 'Free Pascal Language Server', serverOptions, clientOptions);
    };

    /**
     * Stop the client if it exists. (Internal use)
     */
    private async stopInternal(): Promise<void> {
        if (!this.client) {
            return;
        }

        try {
            // Cannot stop if it's currently starting. Wait for it to become Running.
            if (this.client.state === State.Starting) {
                getLogger().appendLine("Client is starting, waiting for it to become running before stopping...");
                let count = 0;
                while (this.client.state === State.Starting && count < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // Wait up to 5 seconds
                    count++;
                }
            }

            if (this.client.state === State.Running) {
                getLogger().appendLine("Stopping language server...");
                await this.client.stop(10000);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            getLogger().appendLine(`Failed to stop language client: ${message}`);
        } finally {
            try {
                this.client?.dispose();
                getLogger().appendLine("Language client disposed.");
            } catch (e) {
                getLogger().appendLine(`Error disposing client: ${e}`);
            }
            this.client = undefined;
            // Clear decorations
            this.inactiveRegionsDecorations.forEach(value => value.decoration.dispose());
            this.inactiveRegionsDecorations.clear();
        }
    }
    public onDidChangeVisibleTextEditor(editor: vscode.TextEditor): void {

        // Apply text decorations to inactive regions
        const valuePair: DecorationRangesPair | undefined = this.inactiveRegionsDecorations.get(editor.document.uri.toString());
        if (valuePair) {
            editor.setDecorations(valuePair.decoration, valuePair.ranges); // VSCode clears the decorations when the text editor becomes invisible
        }

    }

    async start(): Promise<void> {
        const currentLock = this.initLock;
        let resolveLock: () => void;
        this.initLock = new Promise(resolve => resolveLock = resolve);
        await currentLock;
        try {
            await this._startInternal();
        } finally {
            resolveLock!();
        }
    };

    private async _startInternal(): Promise<void> {
        if (!this.client) {
            getLogger().appendLine("Cannot start: client is undefined. Call doInit first.");
            return;
        }
        try {
            if (this.client.state === State.Running) {
                return;
            }
            getLogger().appendLine("Starting language client...");
            await this.client.start();
            getLogger().appendLine("Language client started successfully.");
            await this.doOnReady();
        } catch (e) {
            getLogger().appendLine(`Critical: Failed to start language client: ${e}`);
            throw e;
        }
    }

    async stop(): Promise<void> {
        const currentLock = this.initLock;
        let resolveLock: () => void;
        this.initLock = new Promise(resolve => resolveLock = resolve);
        await currentLock;
        try {
            await this.stopInternal();
        } finally {
            resolveLock!();
        }
    };

    async restart(): Promise<void> {
        const currentLock = this.initLock;
        let resolveLock: () => void;
        this.initLock = new Promise(resolve => resolveLock = resolve);
        await currentLock;
        try {
            await this.stopInternal();
            // Give the OS some time to release the files/ports
            await new Promise(resolve => setTimeout(resolve, 500));
            await this._doInit();
            await this._startInternal();
        } finally {
            resolveLock!();
        }
    };

    async doCodeComplete(editor:vscode.TextEditor): Promise<void> {
        var req:ExecuteCommandParams={
            command:"pasls.completeCode",
            arguments:[
                editor.document.uri.toString(),
                editor.selection.start            ]
        };
        await this.client?.sendRequest(ExecuteCommandRequest.type,req);       

    }
}
