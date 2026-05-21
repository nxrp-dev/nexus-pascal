import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectTemplate {
    name: string;
    description: string;
    sourcePath: string;
}

interface ProjectTemplateNode {
    name: string;
    description: string;
    sourcePath: string;
    isTemplate: boolean;
}

interface ProjectTemplatePickItem extends vscode.QuickPickItem {
    node?: ProjectTemplateNode;
    isBack?: boolean;
}

export class ProjectTemplateManager {
    private static readonly TEMPLATE_ROOT = 'templates';

    constructor(private readonly workspaceRoot: string) {
    }

    public async selectTemplate(): Promise<ProjectTemplate | undefined> {
        const templateRoot = this.getTemplateRoot();

        if (!templateRoot || !fs.existsSync(templateRoot)) {
            return undefined;
        }

        let currentDir = templateRoot;

        while (true) {
            const nodes = this.getChildNodes(templateRoot, currentDir);
            const items: ProjectTemplatePickItem[] = nodes.map(node => ({
                label: node.name,
                description: node.isTemplate ? 'Starter' : 'Category',
                detail: node.description,
                node: node
            }));

            if (currentDir !== templateRoot) {
                items.unshift({
                    label: '$(arrow-left) Back',
                    isBack: true
                });
            }

            if (items.length === 0) {
                return undefined;
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: this.getPlaceHolder(templateRoot, currentDir)
            });

            if (!selected) {
                return undefined;
            }

            if (selected.isBack) {
                currentDir = path.dirname(currentDir);
                continue;
            }

            if (!selected.node) {
                return undefined;
            }

            if (selected.node.isTemplate) {
                return {
                    name: selected.node.name,
                    description: selected.node.description,
                    sourcePath: selected.node.sourcePath
                };
            }

            currentDir = selected.node.sourcePath;
        }
    }

    public async getAvailableTemplates(): Promise<ProjectTemplate[]> {
        const templateRoot = this.getTemplateRoot();

        if (!templateRoot || !fs.existsSync(templateRoot)) {
            return [];
        }

        return this.findTemplates(templateRoot, templateRoot);
    }

    public async createProjectFromTemplate(template: ProjectTemplate, projectName?: string, targetDir?: string): Promise<void> {
        const projectDir = targetDir || this.workspaceRoot;
        const replacementValues = {
            PROJECT_NAME: projectName || 'newproject'
        };

        const collisions = this.findCollisions(template.sourcePath, projectDir, replacementValues);
        if (collisions.length > 0) {
            const choice = await vscode.window.showWarningMessage(
                `${collisions.length} file(s) already exist. Overwrite them?`,
                'Overwrite',
                'Cancel'
            );

            if (choice !== 'Overwrite') {
                return;
            }
        }

        this.copyTemplateDirectory(template.sourcePath, projectDir, replacementValues);
        await this.openFirstSourceFile(template.sourcePath, projectDir, replacementValues);

        vscode.window.showInformationMessage(`Project created from starter: ${template.name}`);
    }

    private getTemplateRoot(): string | undefined {
        const extensionPath = vscode.extensions.getExtension('nxrp-dev.nexus-pascal')?.extensionPath;

        if (!extensionPath) {
            return undefined;
        }

        return path.join(extensionPath, ProjectTemplateManager.TEMPLATE_ROOT);
    }

    private getChildNodes(templateRoot: string, currentDir: string): ProjectTemplateNode[] {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        const directories = entries.filter(entry => entry.isDirectory());
        const nodes = directories.map(directory => {
            const sourcePath = path.join(currentDir, directory.name);
            const relativePath = path.relative(templateRoot, sourcePath);

            return {
                name: this.toFriendlyName(directory.name),
                description: relativePath.split(path.sep).map(part => this.toFriendlyName(part)).join(' / '),
                sourcePath: sourcePath,
                isTemplate: this.hasDirectTemplateFiles(sourcePath)
            };
        });

        nodes.sort((left, right) => {
            if (left.isTemplate !== right.isTemplate) {
                return left.isTemplate ? 1 : -1;
            }

            return left.name.localeCompare(right.name);
        });

        return nodes;
    }

    private findTemplates(templateRoot: string, currentDir: string): ProjectTemplate[] {
        const templates: ProjectTemplate[] = [];
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        const directories = entries.filter(entry => entry.isDirectory());

        for (const directory of directories) {
            const sourcePath = path.join(currentDir, directory.name);

            if (this.hasDirectTemplateFiles(sourcePath)) {
                const relativePath = path.relative(templateRoot, sourcePath);
                const pathParts = relativePath.split(path.sep).filter(part => part.length > 0);
                const templateFolderName = pathParts[pathParts.length - 1] || path.basename(sourcePath);
                const categoryParts = pathParts.slice(0, -1).map(part => this.toFriendlyName(part));

                templates.push({
                    name: this.toFriendlyName(templateFolderName),
                    description: categoryParts.join(' / '),
                    sourcePath: sourcePath
                });
            } else {
                templates.push(...this.findTemplates(templateRoot, sourcePath));
            }
        }

        templates.sort((left, right) => {
            const leftName = `${left.description}/${left.name}`;
            const rightName = `${right.description}/${right.name}`;
            return leftName.localeCompare(rightName);
        });

        return templates;
    }

    private hasDirectTemplateFiles(directoryPath: string): boolean {
        const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        return entries.some(entry => entry.isFile() && entry.name.toLowerCase() !== 'template.json');
    }

    private findCollisions(sourceDir: string, targetDir: string, replacementValues: Record<string, string>): string[] {
        const collisions: string[] = [];
        this.walkTemplateFiles(sourceDir, sourceDir, (sourceFile, relativePath) => {
            const targetPath = path.join(targetDir, this.applyTemplateValues(relativePath, replacementValues));
            if (fs.existsSync(targetPath)) {
                collisions.push(targetPath);
            }
        });
        return collisions;
    }

    private copyTemplateDirectory(sourceDir: string, targetDir: string, replacementValues: Record<string, string>): void {
        this.walkTemplateFiles(sourceDir, sourceDir, (sourceFile, relativePath) => {
            const targetPath = path.join(targetDir, this.applyTemplateValues(relativePath, replacementValues));
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });

            if (this.isTextFile(sourceFile)) {
                const content = fs.readFileSync(sourceFile, 'utf8');
                fs.writeFileSync(targetPath, this.applyTemplateValues(content, replacementValues), 'utf8');
            } else {
                fs.copyFileSync(sourceFile, targetPath);
            }
        });
    }

    private walkTemplateFiles(rootDir: string, currentDir: string, callback: (sourceFile: string, relativePath: string) => void): void {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const sourcePath = path.join(currentDir, entry.name);
            const relativePath = path.relative(rootDir, sourcePath);

            if (entry.isDirectory()) {
                this.walkTemplateFiles(rootDir, sourcePath, callback);
            } else if (entry.isFile() && entry.name.toLowerCase() !== 'template.json') {
                callback(sourcePath, relativePath);
            }
        }
    }

    private async openFirstSourceFile(sourceDir: string, targetDir: string, replacementValues: Record<string, string>): Promise<void> {
        const sourceFiles: string[] = [];

        this.walkTemplateFiles(sourceDir, sourceDir, (sourceFile, relativePath) => {
            if (this.isPascalSourceFile(sourceFile)) {
                sourceFiles.push(this.applyTemplateValues(relativePath, replacementValues));
            }
        });

        if (sourceFiles.length === 0) {
            return;
        }

        sourceFiles.sort((left, right) => {
            if (left.toLowerCase().endsWith('.lpr')) {
                return -1;
            }
            if (right.toLowerCase().endsWith('.lpr')) {
                return 1;
            }
            return left.localeCompare(right);
        });

        const document = await vscode.workspace.openTextDocument(path.join(targetDir, sourceFiles[0]));
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    }

    private applyTemplateValues(value: string, replacementValues: Record<string, string>): string {
        let result = value;

        for (const [name, replacement] of Object.entries(replacementValues)) {
            result = result.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), replacement);
        }

        return result;
    }

    private getPlaceHolder(templateRoot: string, currentDir: string): string {
        const relativePath = path.relative(templateRoot, currentDir);

        if (!relativePath) {
            return 'Select a project starter category';
        }

        return `Select from ${relativePath.split(path.sep).map(part => this.toFriendlyName(part)).join(' / ')}`;
    }

    private toFriendlyName(value: string): string {
        return value
            .split(/[-_\s]+/)
            .filter(part => part.length > 0)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    private isTextFile(filePath: string): boolean {
        const extension = path.extname(filePath).toLowerCase();
        return [
            '.bat', '.cmd', '.css', '.dpr', '.inc', '.js', '.json', '.lfm', '.lpi', '.lpr',
            '.md', '.pas', '.pp', '.ps1', '.sh', '.sql', '.txt', '.xml', '.yaml', '.yml'
        ].includes(extension);
    }

    private isPascalSourceFile(filePath: string): boolean {
        const extension = path.extname(filePath).toLowerCase();
        return ['.lpr', '.dpr', '.pas', '.pp'].includes(extension);
    }
}
