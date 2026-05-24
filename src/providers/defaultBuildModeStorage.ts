import * as vscode from 'vscode';

export class DefaultBuildModeStorage {
    private static instance?: DefaultBuildModeStorage;
    private defaultBuildModeId: string = '';
    
    private constructor(private readonly context: vscode.ExtensionContext) {
        this.loadFromGlobalState();
    }
    
    public static initialize(context: vscode.ExtensionContext): void {
        DefaultBuildModeStorage.instance = new DefaultBuildModeStorage(context);
    }

    public static getInstance(): DefaultBuildModeStorage {
        if (!DefaultBuildModeStorage.instance) {
            throw new Error('DefaultBuildModeStorage has not been initialized.');
        }
        return DefaultBuildModeStorage.instance;
    }
    
    public setDefaultBuildMode(buildModeId: string): void {
        this.defaultBuildModeId = buildModeId;
        this.saveToGlobalState();
    }

    public getDefaultBuildMode(): string {
        return this.defaultBuildModeId;
    }

    public isDefaultBuildMode(buildModeId: string): boolean {
        return this.defaultBuildModeId === buildModeId;
    }

    private loadFromGlobalState(): void {
        try {
            const data = this.context.globalState.get('lazarusDefaultBuildMode');
            if (data && typeof data === 'string') {
                this.defaultBuildModeId = data;
            }
        } catch (error) {
            console.error('Error loading default build mode from global state:', error);
        }
    }

    private saveToGlobalState(): void {
        try {
            this.context.globalState.update('lazarusDefaultBuildMode', this.defaultBuildModeId);
        } catch (error) {
            console.error('Error saving default build mode to global state:', error);
        }
    }
}
