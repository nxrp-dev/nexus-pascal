import * as vscode from 'vscode';
import {
    WizardDefinition,
    WizardField,
    WizardFieldType,
    WizardPlan,
    WizardRequest
} from './wizardTypes';

interface WizardInitMessage {
    type: 'init';
    title: string;
    fields: WizardField[];
    request: WizardRequest;
}

interface WizardPlanMessage {
    type: 'plan';
    plan: WizardPlan;
    fields: WizardField[];
}

interface WizardValueMessage {
    type: 'valueSelected';
    fieldId: string;
    value: string;
}

interface WizardErrorMessage {
    type: 'error';
    message: string;
}

type OutgoingWizardMessage = WizardInitMessage | WizardPlanMessage | WizardValueMessage | WizardErrorMessage;

export class WizardPanel<TRequest extends WizardRequest, TPlan extends WizardPlan> {
    private static readonly currentPanels = new Map<string, WizardPanel<WizardRequest, WizardPlan>>();

    private readonly disposables: vscode.Disposable[] = [];
    private fields: WizardField[] = [];
    private lastRequest: TRequest | undefined;
    private lastPlan: TPlan | undefined;

    public static async show<TRequest extends WizardRequest, TPlan extends WizardPlan>(
        extensionUri: vscode.Uri,
        definition: WizardDefinition<TRequest, TPlan>
    ): Promise<void> {
        const existingPanel = WizardPanel.currentPanels.get(definition.id);
        if (existingPanel) {
            existingPanel.definition = definition as unknown as WizardDefinition<WizardRequest, WizardPlan>;
            existingPanel.panel.title = definition.title;
            existingPanel.panel.reveal(vscode.ViewColumn.One);
            await existingPanel.postInit();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            definition.id,
            definition.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        const wizardPanel = new WizardPanel(panel, definition);
        WizardPanel.currentPanels.set(definition.id, wizardPanel as unknown as WizardPanel<WizardRequest, WizardPlan>);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private definition: WizardDefinition<TRequest, TPlan>
    ) {
        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
        this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this.disposables);
    }

    private dispose(): void {
        WizardPanel.currentPanels.delete(this.definition.id);
        this.disposables.splice(0).forEach(disposable => disposable.dispose());
    }

    private async handleMessage(message: any): Promise<void> {
        try {
            switch (message?.type) {
                case 'ready':
                    await this.postInit();
                    break;
                case 'plan':
                    await this.postPlan(message.request as TRequest);
                    break;
                case 'browse':
                    await this.browseField(message.fieldId, message.currentValue);
                    break;
                case 'execute':
                    await this.execute(message.request as TRequest);
                    break;
            }
        } catch (error) {
            await this.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async postInit(): Promise<void> {
        const request = await this.definition.getInitialRequest();
        this.lastRequest = request;
        this.fields = await this.definition.getFields(request);

        await this.postMessage({
            type: 'init',
            title: this.definition.title,
            fields: this.fields,
            request
        });
        await this.postPlan(request);
    }

    private async postPlan(request: TRequest): Promise<void> {
        this.lastRequest = request;
        this.lastPlan = await this.definition.createPlan(request);
        this.fields = await this.definition.getFields(request);
        await this.postMessage({
            type: 'plan',
            plan: this.lastPlan,
            fields: this.fields
        });
    }

    private async execute(request: TRequest): Promise<void> {
        const plan = this.lastRequest === request && this.lastPlan
            ? this.lastPlan
            : await this.definition.createPlan(request);

        if (!plan.canExecute) {
            await this.postMessage({
                type: 'error',
                message: 'The wizard plan is not ready to execute.'
            });
            return;
        }

        await this.definition.execute(request, plan);
        this.panel.dispose();
    }

    private async browseField(fieldId: string, currentValue?: string): Promise<void> {
        const field = this.fields.find(item => item.id === fieldId);
        if (!field) {
            return;
        }

        const defaultUri = currentValue
            ? vscode.Uri.file(currentValue)
            : undefined;

        const selectedUris = await vscode.window.showOpenDialog({
            canSelectFiles: field.type === 'file',
            canSelectFolders: field.type === 'folder',
            canSelectMany: false,
            defaultUri,
            filters: field.filters,
            openLabel: field.browseLabel || 'Select'
        });

        const selectedValue = selectedUris?.[0]?.fsPath;
        if (selectedValue) {
            await this.postMessage({
                type: 'valueSelected',
                fieldId,
                value: selectedValue
            });
        }
    }

    private async postMessage(message: OutgoingWizardMessage): Promise<void> {
        await this.panel.webview.postMessage(message);
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(this.definition.title)}</title>
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
            grid-template-columns: minmax(340px, 440px) minmax(340px, 1fr);
            gap: 24px;
            max-width: 1120px;
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
        input[readonly] {
            color: var(--vscode-descriptionForeground);
        }
        input[type="checkbox"] {
            width: auto;
            margin-right: 8px;
        }
        .check-row {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .browse-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px;
        }
        .description {
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
            line-height: 1.35;
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
            min-height: 360px;
        }
        .preview h2 {
            font-size: 15px;
            margin: 0 0 10px;
        }
        .section {
            margin-bottom: 18px;
        }
        .summary {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            line-height: 1.35;
        }
        .message {
            margin: 8px 0;
        }
        .info {
            color: var(--vscode-descriptionForeground);
        }
        .warning {
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
            overflow-wrap: anywhere;
            white-space: normal;
        }
        .details {
            display: grid;
            grid-template-columns: minmax(120px, auto) 1fr;
            gap: 6px 12px;
        }
        .detail-label {
            color: var(--vscode-descriptionForeground);
        }
        .detail-value {
            word-break: break-word;
        }
    </style>
</head>
<body>
    <h1 id="wizardTitle"></h1>
    <div class="layout">
        <section id="fields"></section>
        <section class="preview">
            <div class="section">
                <h2>Plan</h2>
                <div id="summary" class="summary"></div>
                <div id="messages"></div>
            </div>
            <div class="section">
                <h2>Details</h2>
                <div id="details" class="details"></div>
            </div>
            <div class="section">
                <h2>Outputs</h2>
                <ul id="outputList"></ul>
            </div>
        </section>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let fields = [];
        let planTimer;
        let fieldSignature = '';

        const titleNode = document.getElementById('wizardTitle');
        const fieldsNode = document.getElementById('fields');
        const summaryNode = document.getElementById('summary');
        const messagesNode = document.getElementById('messages');
        const detailsNode = document.getElementById('details');
        const outputListNode = document.getElementById('outputList');

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'init') {
                titleNode.textContent = message.title;
                fields = message.fields || [];
                fieldSignature = createFieldSignature(fields);
                renderFields(message.request || {});
                requestPlan();
            } else if (message.type === 'plan') {
                updateFields(message.fields || []);
                renderPlan(message.plan);
            } else if (message.type === 'valueSelected') {
                const input = document.querySelector('[data-field-id="' + cssEscape(message.fieldId) + '"]');
                if (input) {
                    input.value = message.value;
                    requestPlan();
                }
            } else if (message.type === 'error') {
                renderError(message.message);
            }
        });

        function renderFields(request) {
            fieldsNode.innerHTML = '';
            for (const field of fields) {
                if (field.hidden) {
                    continue;
                }
                fieldsNode.appendChild(renderField(field, request[field.id]));
            }

            const actions = document.createElement('div');
            actions.className = 'actions';
            const createButton = document.createElement('button');
            createButton.id = 'executeButton';
            createButton.textContent = 'Create';
            createButton.addEventListener('click', () => vscode.postMessage({
                type: 'execute',
                request: getRequest()
            }));
            actions.appendChild(createButton);
            fieldsNode.appendChild(actions);
        }

        function updateFields(nextFields) {
            const nextSignature = createFieldSignature(nextFields);
            if (nextSignature === fieldSignature) {
                fields = nextFields;
                return;
            }

            const request = getRequest();
            fields = nextFields;
            fieldSignature = nextSignature;
            renderFields(request);
            requestPlan();
        }

        function renderField(field, requestValue) {
            const container = document.createElement('div');
            container.className = 'field';

            if (field.type === 'checkbox') {
                const row = document.createElement('div');
                row.className = 'check-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(requestValue ?? field.value);
                input.disabled = Boolean(field.disabled);
                input.dataset.fieldId = field.id;
                input.addEventListener('change', requestPlan);
                const label = document.createElement('label');
                label.textContent = field.label;
                label.style.marginBottom = '0';
                row.appendChild(input);
                row.appendChild(label);
                container.appendChild(row);
            } else {
                const label = document.createElement('label');
                label.textContent = field.label;
                container.appendChild(label);

                if (field.type === 'select') {
                    const select = document.createElement('select');
                    select.dataset.fieldId = field.id;
                    select.disabled = Boolean(field.disabled);
                    for (const option of field.options || []) {
                        const optionNode = document.createElement('option');
                        optionNode.value = option.value;
                        optionNode.textContent = option.label;
                        select.appendChild(optionNode);
                    }
                    const requestedValue = String(requestValue ?? field.value ?? '');
                    const fallbackValue = String(field.value ?? (field.options?.[0]?.value ?? ''));
                    const optionValues = (field.options || []).map(option => option.value);
                    select.value = optionValues.includes(requestedValue) ? requestedValue : fallbackValue;
                    select.addEventListener('change', requestPlan);
                    container.appendChild(select);
                } else if (field.type === 'file' || field.type === 'folder') {
                    const row = document.createElement('div');
                    row.className = 'browse-row';
                    const input = createTextInput(field, requestValue);
                    const button = document.createElement('button');
                    button.className = 'secondary';
                    button.textContent = 'Browse';
                    button.disabled = Boolean(field.disabled);
                    button.addEventListener('click', () => vscode.postMessage({
                        type: 'browse',
                        fieldId: field.id,
                        currentValue: input.value
                    }));
                    row.appendChild(input);
                    row.appendChild(button);
                    container.appendChild(row);
                } else {
                    container.appendChild(createTextInput(field, requestValue));
                }
            }

            if (field.description) {
                const description = document.createElement('div');
                description.className = 'description';
                description.textContent = field.description;
                container.appendChild(description);
            }

            return container;
        }

        function createTextInput(field, requestValue) {
            const input = document.createElement('input');
            input.dataset.fieldId = field.id;
            input.value = String(requestValue ?? field.value ?? '');
            input.placeholder = field.placeholder || '';
            input.disabled = Boolean(field.disabled);
            input.readOnly = field.type === 'readonly';
            input.addEventListener('input', requestPlan);
            return input;
        }

        function requestPlan() {
            clearTimeout(planTimer);
            planTimer = setTimeout(() => vscode.postMessage({
                type: 'plan',
                request: getRequest()
            }), 120);
        }

        function getRequest() {
            const request = {};
            for (const field of fields) {
                if (field.hidden) {
                    continue;
                }
                const input = document.querySelector('[data-field-id="' + cssEscape(field.id) + '"]');
                if (!input) {
                    continue;
                }

                if (field.type === 'checkbox') {
                    request[field.id] = input.checked;
                } else {
                    request[field.id] = input.value;
                }
            }
            return request;
        }

        function renderPlan(plan) {
            const createButton = document.getElementById('executeButton');
            if (createButton) {
                createButton.disabled = !plan.canExecute;
            }

            summaryNode.textContent = plan.summary || '';

            messagesNode.innerHTML = '';
            for (const message of plan.messages || []) {
                const node = document.createElement('div');
                node.className = 'message ' + message.severity;
                node.textContent = message.text;
                messagesNode.appendChild(node);
            }

            detailsNode.innerHTML = '';
            for (const detail of plan.details || []) {
                const label = document.createElement('div');
                label.className = 'detail-label';
                label.textContent = detail.label;
                const value = document.createElement('div');
                value.className = 'detail-value';
                value.textContent = detail.value;
                detailsNode.appendChild(label);
                detailsNode.appendChild(value);
            }

            outputListNode.innerHTML = '';
            for (const output of plan.outputs || []) {
                const item = document.createElement('li');
                const code = document.createElement('code');
                code.textContent = output.path;
                item.appendChild(code);
                outputListNode.appendChild(item);
            }
        }

        function renderError(message) {
            messagesNode.innerHTML = '';
            const node = document.createElement('div');
            node.className = 'message error';
            node.textContent = message;
            messagesNode.appendChild(node);
        }

        function cssEscape(value) {
            return value.replace(/["\\\\]/g, '\\\\$&');
        }

        function createFieldSignature(fieldList) {
            return JSON.stringify(fieldList.map(field => ({
                ...field,
                value: undefined
            })));
        }

        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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
