import {
    ErrorHandler,
    Executable,
    LanguageClientOptions,
    ServerOptions
} from 'vscode-languageclient/node';
import { InitializationOptions } from './options';
import { ServerEnvironment } from './serverEnvironment';

export function createServerOptions(executable: string, envVars: ServerEnvironment): ServerOptions {
    const run: Executable = {
        command: executable,
        options: {
            env: {
                ...process.env,
                ...envVars
            }
        }
    };

    return {
        run,
        debug: run
    };
}

export function createLanguageClientOptions(
    initializationOptions: InitializationOptions,
    errorHandler: ErrorHandler
): LanguageClientOptions {
    return {
        initializationOptions,
        errorHandler,
        documentSelector: [
            { scheme: 'file', language: 'objectpascal' },
            { scheme: 'untitled', language: 'objectpascal' },
            { scheme: 'file', language: 'pascal' },
            { scheme: 'untitled', language: 'pascal' }
        ]
    };
}
