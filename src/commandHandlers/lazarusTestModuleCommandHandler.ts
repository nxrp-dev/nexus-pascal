import * as vscode from 'vscode';
import {
    LazarusTestModuleRequest,
    LazarusTestModuleService,
    TestModulePlan
} from '../projectCreation/lazarusTestModuleService';
import { WizardPanel } from '../wizard/wizardPanel';
import { WizardDefinition, WizardField } from '../wizard/wizardTypes';

export class LazarusTestModuleCommandHandler {
    private readonly testModuleService: LazarusTestModuleService;
    private extensionUri: vscode.Uri | undefined;

    public constructor(workspaceRoot: string) {
        this.testModuleService = new LazarusTestModuleService(workspaceRoot);
    }

    public register(context: vscode.ExtensionContext): void {
        this.extensionUri = context.extensionUri;
        context.subscriptions.push(vscode.commands.registerCommand(
            'nexusPascal.project.createTestModule',
            (resource?: vscode.Uri) => this.showWizard(resource)
        ));
    }

    private showWizard = async (resource?: vscode.Uri): Promise<void> => {
        try {
            await WizardPanel.show(
                this.extensionUri || vscode.Uri.file(this.testModuleService.getInitialRequest(resource).targetDir),
                this.createDefinition(resource)
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create NexusTest module: ${error}`);
        }
    };

    private createDefinition(resource?: vscode.Uri): WizardDefinition<LazarusTestModuleRequest, TestModulePlan> {
        return {
            id: 'nexusTestModuleWizard',
            title: 'Create NexusTest Module',
            getInitialRequest: async () => this.testModuleService.getInitialRequest(resource),
            getFields: async (request) => this.createFields(request),
            createPlan: async (request) => this.testModuleService.createPlan(request),
            execute: async (_request, plan) => this.testModuleService.execute(plan)
        };
    }

    private createFields(request: LazarusTestModuleRequest): WizardField[] {
        return [
            {
                id: 'projectFile',
                label: 'Source Lazarus Project',
                type: 'file',
                value: request.projectFile,
                required: true,
                browseLabel: 'Select Lazarus Project',
                filters: {
                    'Lazarus project files': ['lpi']
                },
                description: 'The .lpi project this test module will be created beside.'
            },
            {
                id: 'moduleName',
                label: 'Module Name',
                type: 'text',
                value: request.moduleName,
                required: true,
                description: 'Pascal identifier used for the test library project.'
            },
            {
                id: 'targetDir',
                label: 'Destination Folder',
                type: 'folder',
                value: request.targetDir,
                required: true,
                browseLabel: 'Select Destination Folder'
            },
            {
                id: 'testUnitName',
                label: 'Test Unit Name',
                type: 'text',
                value: request.testUnitName,
                required: true
            },
            {
                id: 'outputRoot',
                label: 'Output Folder',
                type: 'folder',
                value: request.outputRoot,
                required: true,
                browseLabel: 'Select Output Folder',
                description: 'The Lazarus project will emit binaries and units under this root by target CPU/OS.'
            },
            {
                id: 'includeSampleTest',
                label: 'Include sample wiring test',
                type: 'checkbox',
                value: request.includeSampleTest,
                description: 'Adds a small passing test so the generated module can be loaded and run immediately.'
            },
            {
                id: 'includeExports',
                label: 'Expose NexusTest DLL boundary',
                type: 'checkbox',
                value: request.includeExports,
                disabled: true,
                description: 'Required for NexusTestUI and host clients to load the module.'
            },
            {
                id: 'enableTcpHost',
                label: 'Add TCP/IP host support',
                type: 'checkbox',
                value: request.enableTcpHost,
                disabled: true,
                description: 'Reserved for the upcoming test-host transport option.'
            }
        ];
    }
}
