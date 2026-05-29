import * as vscode from 'vscode';
import { ProjectCreationService } from './projectCreationService';
import {
    ProjectCreationKind,
    ProjectCreationPlan,
    ProjectCreationRequest,
    ProjectCreationTemplateOption
} from './projectCreationTypes';

interface WizardInitMessage {
    type: 'init';
    initialKind: ProjectCreationKind;
    workspaceRoot: string;
    templates: Record<ProjectCreationKind, ProjectCreationTemplateOption[]>;
}

interface WizardPlanMessage {
    type: 'plan';
    plan: ProjectCreationPlan;
}

interface WizardFolderMessage {
    type: 'folderSelected';
    targetDir: string;
}

interface WizardErrorMessage {
    type: 'error';
    message: string;
}

type OutgoingWizardMessage = WizardInitMessage | WizardPlanMessage | WizardFolderMessage | WizardErrorMessage;

export class ProjectCreationWizardPanel {
    private static currentPanel: ProjectCreationWizardPanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];

    public static async show(
        extensionUri: vscode.Uri,
        creationService: ProjectCreationService,
        initialKind: ProjectCreationKind
    ): Promise<void> {
        if (ProjectCreationWizardPanel.currentPanel) {
            ProjectCreationWizardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
            await ProjectCreationWizardPanel.currentPanel.postInit(initialKind);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'nexusProjectWizard',
            'New Nexus Pascal Project',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        ProjectCreationWizardPanel.currentPanel = new ProjectCreationWizardPanel(panel, creationService, initialKind);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly creationService: ProjectCreationService,
        initialKind: ProjectCreationKind
    ) {
        this.panel.webview.html = this.getHtml(this.panel.webview, initialKind);

        this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
        this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this.disposables);
    }

    private dispose(): void {
        ProjectCreationWizardPanel.currentPanel = undefined;
        this.disposables.splice(0).forEach(disposable => disposable.dispose());
    }

    private async handleMessage(message: any): Promise<void> {
        try {
            switch (message?.type) {
                case 'ready':
                    await this.postInit(message.initialKind || 'lazarus');
                    break;
                case 'plan':
                    await this.postPlan(message.request);
                    break;
                case 'browse':
                    await this.browseForFolder(message.targetDir);
                    break;
                case 'create':
                    await this.createProject(message.request);
                    break;
            }
        } catch (error) {
            await this.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async postInit(initialKind: ProjectCreationKind): Promise<void> {
        await this.postMessage({
            type: 'init',
            initialKind,
            workspaceRoot: this.creationService.getWorkspaceRoot(),
            templates: {
                fpc: await this.creationService.getTemplates('fpc'),
                lazarus: await this.creationService.getTemplates('lazarus'),
                nexus: await this.creationService.getTemplates('nexus')
            }
        });
    }

    private async postPlan(request: ProjectCreationRequest): Promise<void> {
        await this.postMessage({
            type: 'plan',
            plan: await this.creationService.createPlan(request)
        });
    }

    private async browseForFolder(currentFolder?: string): Promise<void> {
        const selectedUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: currentFolder ? vscode.Uri.file(currentFolder) : vscode.Uri.file(this.creationService.getWorkspaceRoot()),
            openLabel: 'Select Project Folder'
        });

        const targetDir = selectedUris?.[0]?.fsPath;
        if (targetDir) {
            await this.postMessage({
                type: 'folderSelected',
                targetDir
            });
        }
    }

    private async createProject(request: ProjectCreationRequest): Promise<void> {
        await this.creationService.execute(request);
        vscode.window.showInformationMessage(`Project created: ${request.projectName}`);
        this.panel.dispose();
    }

    private async postMessage(message: OutgoingWizardMessage): Promise<void> {
        await this.panel.webview.postMessage(message);
    }

    private getHtml(webview: vscode.Webview, initialKind: ProjectCreationKind): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Nexus Pascal Project</title>
    <style>
        body {
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            margin: 0;
            padding: 24px;
        }
        h1 {
            font-size: 22px;
            font-weight: 600;
            margin: 0 0 18px;
        }
        .layout {
            display: grid;
            grid-template-columns: minmax(320px, 420px) minmax(320px, 1fr);
            gap: 24px;
            max-width: 1080px;
        }
        .field {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
        }
        input, select {
            box-sizing: border-box;
            width: 100%;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 8px;
            font-family: var(--vscode-font-family);
        }
        .folder-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px;
        }
        button {
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            border: 0;
            padding: 7px 12px;
            cursor: pointer;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            color: var(--vscode-button-secondaryForeground);
            background: var(--vscode-button-secondaryBackground);
        }
        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        button:disabled {
            opacity: 0.55;
            cursor: default;
        }
        .actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 20px;
        }
        .preview {
            border: 1px solid var(--vscode-panel-border);
            padding: 14px;
            min-height: 320px;
        }
        .preview h2 {
            font-size: 15px;
            margin: 0 0 10px;
        }
        .summary {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
        .message {
            margin: 10px 0;
            color: var(--vscode-editorWarning-foreground);
        }
        .error {
            color: var(--vscode-errorForeground);
        }
        ul {
            padding-left: 18px;
        }
        li {
            margin: 4px 0;
        }
        code {
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    <h1>New Nexus Pascal Project</h1>
    <div class="layout">
        <section>
            <div class="field">
                <label for="projectKind">Project Type</label>
                <select id="projectKind">
                    <option value="fpc">Free Pascal</option>
                    <option value="lazarus">Lazarus</option>
                    <option value="nexus">Nexus Project</option>
                </select>
            </div>
            <div class="field" id="templateField">
                <label for="templateId">Starter</label>
                <select id="templateId"></select>
            </div>
            <div class="field">
                <label for="projectName">Project Name</label>
                <input id="projectName" value="newproject" />
            </div>
            <div class="field">
                <label for="targetDir">Destination Folder</label>
                <div class="folder-row">
                    <input id="targetDir" />
                    <button id="browseButton" class="secondary">Browse</button>
                </div>
            </div>
            <div class="actions">
                <button id="createButton">Create</button>
            </div>
        </section>
        <section class="preview">
            <h2>Plan</h2>
            <div id="summary" class="summary"></div>
            <div id="messages"></div>
            <h2>Files</h2>
            <ul id="fileList"></ul>
        </section>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const initialKind = ${JSON.stringify(initialKind)};
        let templates = { fpc: [], lazarus: [], nexus: [] };
        let pendingPlanTimer;
        let lastPlan;

        const projectKind = document.getElementById('projectKind');
        const templateField = document.getElementById('templateField');
        const templateId = document.getElementById('templateId');
        const projectName = document.getElementById('projectName');
        const targetDir = document.getElementById('targetDir');
        const browseButton = document.getElementById('browseButton');
        const createButton = document.getElementById('createButton');
        const summary = document.getElementById('summary');
        const messages = document.getElementById('messages');
        const fileList = document.getElementById('fileList');

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'init') {
                templates = message.templates;
                projectKind.value = message.initialKind || initialKind;
                targetDir.value = message.workspaceRoot;
                renderTemplates();
                requestPlan();
            } else if (message.type === 'plan') {
                lastPlan = message.plan;
                renderPlan(message.plan);
            } else if (message.type === 'folderSelected') {
                targetDir.value = message.targetDir;
                requestPlan();
            } else if (message.type === 'error') {
                renderError(message.message);
            }
        });

        projectKind.addEventListener('change', () => {
            renderTemplates();
            requestPlan();
        });
        templateId.addEventListener('change', requestPlan);
        projectName.addEventListener('input', requestPlan);
        targetDir.addEventListener('input', requestPlan);
        browseButton.addEventListener('click', () => vscode.postMessage({
            type: 'browse',
            targetDir: targetDir.value
        }));
        createButton.addEventListener('click', () => vscode.postMessage({
            type: 'create',
            request: getRequest()
        }));

        function renderTemplates() {
            const kind = projectKind.value;
            const kindTemplates = templates[kind] || [];
            templateField.style.display = kind === 'nexus' ? 'none' : 'block';
            templateId.innerHTML = '';
            for (const template of kindTemplates) {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = template.name;
                templateId.appendChild(option);
            }
        }

        function requestPlan() {
            clearTimeout(pendingPlanTimer);
            pendingPlanTimer = setTimeout(() => vscode.postMessage({
                type: 'plan',
                request: getRequest()
            }), 120);
        }

        function getRequest() {
            const kind = projectKind.value;
            return {
                kind,
                templateId: kind === 'nexus' ? undefined : templateId.value,
                projectName: projectName.value,
                targetDir: targetDir.value
            };
        }

        function renderPlan(plan) {
            createButton.disabled = !plan.canCreate;
            summary.textContent = plan.templateName
                ? plan.templateName + ' "' + plan.projectName + '" in ' + plan.targetDir
                : 'Choose project options.';

            messages.innerHTML = '';
            for (const warning of plan.warnings) {
                appendMessage(warning, 'error');
            }
            if (plan.collisions.length > 0) {
                appendMessage(plan.collisions.length + ' existing file(s) may be overwritten.', 'message');
            }

            fileList.innerHTML = '';
            for (const file of plan.files) {
                const item = document.createElement('li');
                item.innerHTML = '<code></code>';
                item.firstChild.textContent = file;
                fileList.appendChild(item);
            }
        }

        function renderError(message) {
            messages.innerHTML = '';
            appendMessage(message, 'error');
        }

        function appendMessage(text, className) {
            const node = document.createElement('div');
            node.className = className;
            node.textContent = text;
            messages.appendChild(node);
        }

        vscode.postMessage({ type: 'ready', initialKind });
    </script>
</body>
</html>`;
    }

    private getNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let index = 0; index < 32; index++) {
            nonce += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return nonce;
    }
}
