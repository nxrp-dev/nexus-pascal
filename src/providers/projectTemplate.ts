import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionPaths } from '../services/extensionPaths';

export interface ProjectTemplate {
    name: string;
    sourcePath: string;
}

interface ProjectTemplateNode {
    name: string;
    sourcePath: string;
    isStarter: boolean;
}

export class ProjectTemplateManager {
    private static readonly StarterRoot = 'templates';
    private static readonly ProjectNameToken = '%PROJECT_NAME%';
    private static readonly IgnoredTemplateFiles = new Set(['template.json']);
    private static readonly IgnoredTemplateDirectories = new Set(['.vscode']);
    public static readonly FreePascalCategory = 'FreePascal-Projects';
    public static readonly LazarusCategory = 'Lazarus-Projects';

    constructor(
        private readonly workspaceRoot: string,
        private readonly extensionPaths: ExtensionPaths
    ) {
    }

    public async createNexusProject(AProjectName: string, ATargetDir?: string): Promise<void> {
        const lTargetDir = ATargetDir || this.workspaceRoot;
        const lProjectName = AProjectName || 'newproject';
        const lTargetPath = path.join(lTargetDir, `${lProjectName}.nxp`);

        if (fs.existsSync(lTargetPath)) {
            const lChoice = await vscode.window.showWarningMessage(
                `${path.basename(lTargetPath)} already exists. Overwrite it?`,
                'Overwrite',
                'Cancel'
            );

            if (lChoice !== 'Overwrite') {
                return;
            }
        }

        const lContent = {
            name: lProjectName
        };
        fs.writeFileSync(lTargetPath, JSON.stringify(lContent, null, 4) + '\n', 'utf8');

        const lDocument = await vscode.workspace.openTextDocument(lTargetPath);
        await vscode.window.showTextDocument(lDocument, vscode.ViewColumn.One);
        vscode.window.showInformationMessage(`Nexus project created: ${lProjectName}`);
    }

    public async getAvailableTemplatesFromCategory(ACategoryName: string): Promise<ProjectTemplate[]> {
        const lStarterRoot = this.getStarterRoot();

        if (!lStarterRoot) {
            return [];
        }

        const lCategoryPath = path.join(lStarterRoot, ACategoryName);
        if (!fs.existsSync(lCategoryPath) || !fs.statSync(lCategoryPath).isDirectory()) {
            return [];
        }

        return this.findStarters(lCategoryPath);
    }

    public getPlannedFiles(ATemplate: ProjectTemplate, AProjectName: string): string[] {
        const lFiles: string[] = [];

        this.walkFiles(ATemplate.sourcePath, (_ASourceFile, ARelativePath) => {
            lFiles.push(this.applyProjectName(ARelativePath, AProjectName));
        });

        return lFiles.sort((ALeft, ARight) => ALeft.localeCompare(ARight));
    }

    public getCollisions(ATemplate: ProjectTemplate, ATargetDir: string, AProjectName: string): string[] {
        return this.findCollisions(ATemplate.sourcePath, ATargetDir, AProjectName);
    }

    public async createProjectFromTemplate(ATemplate: ProjectTemplate, AProjectName?: string, ATargetDir?: string): Promise<void> {
        const lTargetDir = ATargetDir || this.workspaceRoot;
        const lProjectName = AProjectName || 'newproject';
        const lCollisions = this.findCollisions(ATemplate.sourcePath, lTargetDir, lProjectName);

        if (lCollisions.length > 0) {
            const lChoice = await vscode.window.showWarningMessage(
                `${lCollisions.length} file(s) already exist. Overwrite them?`,
                'Overwrite',
                'Cancel'
            );

            if (lChoice !== 'Overwrite') {
                return;
            }
        }

        this.copyStarter(ATemplate.sourcePath, lTargetDir, lProjectName);
        await this.openFirstPascalFile(ATemplate.sourcePath, lTargetDir, lProjectName);
        vscode.window.showInformationMessage(`Project created from starter: ${ATemplate.name}`);
    }

    private getStarterRoot(): string | undefined {
        const lStarterRoot = this.extensionPaths.getFilePath(ProjectTemplateManager.StarterRoot);
        return fs.existsSync(lStarterRoot) && fs.statSync(lStarterRoot).isDirectory() ? lStarterRoot : undefined;
    }

    private getChildNodes(ADirectory: string): ProjectTemplateNode[] {
        return fs.readdirSync(ADirectory, { withFileTypes: true })
            .filter((AEntry) => AEntry.isDirectory())
            .map((AEntry) => {
                const lSourcePath = path.join(ADirectory, AEntry.name);

                return {
                    name: this.toFriendlyName(AEntry.name),
                    sourcePath: lSourcePath,
                    isStarter: this.isStarterDirectory(lSourcePath)
                };
            });
    }

    private findStarters(ADirectory: string): ProjectTemplate[] {
        const lStarters: ProjectTemplate[] = [];

        for (const lNode of this.getChildNodes(ADirectory)) {
            if (lNode.isStarter) {
                lStarters.push({
                    name: lNode.name,
                    sourcePath: lNode.sourcePath
                });
            } else {
                lStarters.push(...this.findStarters(lNode.sourcePath));
            }
        }

        return lStarters.sort((ALeft, ARight) => ALeft.name.localeCompare(ARight.name));
    }

    private isStarterDirectory(ADirectory: string): boolean {
        return fs.readdirSync(ADirectory, { withFileTypes: true })
            .some((AEntry) => AEntry.isFile() && !this.isIgnoredTemplateFile(AEntry.name));
    }

    private findCollisions(ASourceDir: string, ATargetDir: string, AProjectName: string): string[] {
        const lCollisions: string[] = [];

        this.walkFiles(ASourceDir, (ASourceFile, ARelativePath) => {
            const lTargetPath = path.join(ATargetDir, this.applyProjectName(ARelativePath, AProjectName));

            if (fs.existsSync(lTargetPath)) {
                lCollisions.push(lTargetPath);
            }
        });

        return lCollisions;
    }

    private copyStarter(ASourceDir: string, ATargetDir: string, AProjectName: string): void {
        this.walkFiles(ASourceDir, (ASourceFile, ARelativePath) => {
            const lTargetPath = path.join(ATargetDir, this.applyProjectName(ARelativePath, AProjectName));
            fs.mkdirSync(path.dirname(lTargetPath), { recursive: true });

            if (this.isTextFile(ASourceFile)) {
                const lContent = fs.readFileSync(ASourceFile, 'utf8');
                fs.writeFileSync(lTargetPath, this.applyProjectName(lContent, AProjectName), 'utf8');
                return;
            }

            fs.copyFileSync(ASourceFile, lTargetPath);
        });
    }

    private walkFiles(ARootDir: string, ACallback: (ASourceFile: string, ARelativePath: string) => void): void {
        this.walkFilesFrom(ARootDir, ARootDir, ACallback);
    }

    private walkFilesFrom(ARootDir: string, ACurrentDir: string, ACallback: (ASourceFile: string, ARelativePath: string) => void): void {
        for (const lEntry of fs.readdirSync(ACurrentDir, { withFileTypes: true })) {
            const lSourcePath = path.join(ACurrentDir, lEntry.name);

            if (lEntry.isDirectory()) {
                if (!this.isIgnoredTemplateDirectory(lEntry.name)) {
                    this.walkFilesFrom(ARootDir, lSourcePath, ACallback);
                }
                continue;
            }

            if (lEntry.isFile() && !this.isIgnoredTemplateFile(lEntry.name)) {
                ACallback(lSourcePath, path.relative(ARootDir, lSourcePath));
            }
        }
    }

    private async openFirstPascalFile(ASourceDir: string, ATargetDir: string, AProjectName: string): Promise<void> {
        const lPascalFiles: string[] = [];

        this.walkFiles(ASourceDir, (ASourceFile, ARelativePath) => {
            if (this.isPascalSourceFile(ASourceFile)) {
                lPascalFiles.push(this.applyProjectName(ARelativePath, AProjectName));
            }
        });

        if (lPascalFiles.length === 0) {
            return;
        }

        lPascalFiles.sort((ALeft, ARight) => this.comparePascalFiles(ALeft, ARight));

        const lDocument = await vscode.workspace.openTextDocument(path.join(ATargetDir, lPascalFiles[0]));
        await vscode.window.showTextDocument(lDocument, vscode.ViewColumn.One);
    }

    private comparePascalFiles(ALeft: string, ARight: string): number {
        const lLeftIsProgram = this.isProgramFile(ALeft);
        const lRightIsProgram = this.isProgramFile(ARight);

        if (lLeftIsProgram !== lRightIsProgram) {
            return lLeftIsProgram ? -1 : 1;
        }

        return ALeft.localeCompare(ARight);
    }

    private isProgramFile(AFilePath: string): boolean {
        const lExtension = path.extname(AFilePath).toLowerCase();
        return lExtension === '.lpr' || lExtension === '.dpr';
    }

    private toFriendlyName(AValue: string): string {
        return AValue
            .split(/[-_\s]+/)
            .filter((APart) => APart.length > 0)
            .map((APart) => APart.charAt(0).toUpperCase() + APart.slice(1))
            .join(' ');
    }

    private applyProjectName(AValue: string, AProjectName: string): string {
        return AValue.split(ProjectTemplateManager.ProjectNameToken).join(AProjectName);
    }

    private isIgnoredTemplateFile(AFileName: string): boolean {
        return ProjectTemplateManager.IgnoredTemplateFiles.has(AFileName.toLowerCase());
    }

    private isIgnoredTemplateDirectory(ADirectoryName: string): boolean {
        return ProjectTemplateManager.IgnoredTemplateDirectories.has(ADirectoryName.toLowerCase());
    }

    private isTextFile(AFilePath: string): boolean {
        const lExtension = path.extname(AFilePath).toLowerCase();

        return [
            '.bat', '.cmd', '.css', '.dpr', '.inc', '.js', '.json', '.lfm', '.lpi', '.lpr',
            '.md', '.pas', '.pp', '.ps1', '.sh', '.sql', '.txt', '.xml', '.yaml', '.yml'
        ].includes(lExtension);
    }

    private isPascalSourceFile(AFilePath: string): boolean {
        const lExtension = path.extname(AFilePath).toLowerCase();
        return ['.lpr', '.dpr', '.pas', '.pp'].includes(lExtension);
    }
}
