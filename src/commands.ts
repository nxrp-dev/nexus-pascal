import * as vscode from 'vscode';
import { FpcItem } from './providers/fpcItem';
import { ProjectType } from './providers/projectType';
import * as fs from 'fs';
import path = require('path');
import { BuildMode, FpcTask, taskProvider } from './providers/task';
import { client } from './extension';
import { TextEditor, TextEditorEdit } from 'vscode';
import { ProjectTemplateManager } from './providers/projectTemplate';
import { LazarusBuildModeTask } from './providers/lazarusBuildModeTask';

export class FpcCommandManager {
    // Static variable for storing extension context
    private static _context: vscode.ExtensionContext;
    private templateManager: ProjectTemplateManager;

    constructor(private workspaceRoot: string) {
        this.templateManager = new ProjectTemplateManager(workspaceRoot);
    }

    // Set extension context
    public static setContext(context: vscode.ExtensionContext): void {
        FpcCommandManager._context = context;
    }

    // Getter for context
    public static get context(): vscode.ExtensionContext {
        if (!FpcCommandManager._context) {
            throw new Error('Extension context not initialized');
        }
        return FpcCommandManager._context;
    }
    registerAll(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.build', this.ProjectBuild));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.rebuild', this.ProjectReBuild));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.opensetting', this.ProjectOpen));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.newproject', this.ProjectNew));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.newfromtemplate', this.NewProjectFromTemplate));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.add', this.ProjectAdd));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.setdefault', this.projectSetDefault));
        context.subscriptions.push(vscode.commands.registerCommand('nexusPascal.project.openWithLazarus', this.openWithLazarus));

        context.subscriptions.push(vscode.commands.registerTextEditorCommand('nexusPascal.code.complete', this.CodeComplete));
    }

    ProjectAdd = async (node: FpcItem) => {
        if (node.level === 0) {
            // If it is a Lazarus project, do not allow adding new build configurations, as configurations come from the .lpi file
            if (node.projectType === ProjectType.Lazarus) {
                vscode.window.showInformationMessage('The build configurations of Lazarus projects are managed by the .lpi file and do not need to be added manually.');
                return;
            }

            let config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));

            let inp = await vscode.window.showQuickPick(['debug', 'release', 'Other ...'], { canPickMany: false });
            if (!inp) {
                return;
            }
            let label: string | undefined;
            switch (inp) {
                case 'debug':
                    label = 'debug';
                    break;
                case 'release':
                    label = 'release';
                    break;

                default:
                    label = await vscode.window.showInputBox({ prompt: 'Input build label:' });

                    break;
            }
            if (!label) {
                return;
            }

            let tasks = config.tasks || [];
            
            // Check for duplicate labels and modify if necessary
            let finalLabel = label;
            const currentProjectName = path.basename(node.label, path.extname(node.label));
            
            // Find tasks with the same label
            const duplicateTasks = tasks.filter((task: any) => task.label === label);
            
            if (duplicateTasks.length > 0) {
                // Check if any duplicate task belongs to a different project
                const differentProjectTask = duplicateTasks.find((task: any) => {
                    const taskProjectName = path.basename(task.file, path.extname(task.file));
                    return taskProjectName !== currentProjectName;
                });
                
                if (differentProjectTask) {
                    // If there's a task with same label from different project, add project name suffix
                    finalLabel = `${label}-${currentProjectName}`;
                    
                    // Check if the new label with project name suffix is still duplicate
                    if (tasks.some((task: any) => task.label === finalLabel)) {
                        vscode.window.showWarningMessage(`Task "${finalLabel}" already exists. Skipping task creation.`);
                        return;
                    }
                } else {
                    // If all duplicate tasks are from the same project, don't add the task
                    vscode.window.showWarningMessage(`Task "${label}" already exists for this project. Skipping task creation.`);
                    return;
                }
            }

            let v = {
                "label": finalLabel,
                "file": node.label,
                "type": "fpc",
                "buildOption": {
                    "syntaxMode": "ObjFPC",
                    "unitOutputDir": "./out"
                }
            };

            tasks.push(v);
            config.update(
                "tasks",
                tasks,
                vscode.ConfigurationTarget.WorkspaceFolder
            );
        }
    };

    ProjectBuild = async (node: FpcItem) => {
        // Root node (level 0) does not trigger build
        if (node.level === 0) {
            return;
        }

        // Get the project task from the node
        const projectTask = node.projectTask;
        if (!projectTask) {
            vscode.window.showErrorMessage('Invalid project task');
            return;
        }

        // Get the task from the project task (this will auto-generate config if needed)
        const task = await projectTask.getTask();

        // Execute the task
        vscode.tasks.executeTask(task);
    };

    ProjectReBuild = async (node: FpcItem) => {
        // Only child nodes (build configurations) can perform the ReBuild operation
        if (node.level === 0) {
            // Root node (project level) does not perform any operation
            return;
        }

        // Get the project task from the node
        const projectTask = node.projectTask;
        if (!projectTask) {
            vscode.window.showErrorMessage('Invalid project task');
            return;
        }

        // Handle child nodes of Lazarus projects
        if (node.projectType === ProjectType.Lazarus) {
            // Get the task from the project task
            const task = await projectTask.getTask();
            
            // Get compile options for this task
            const compileOption = projectTask.getCompileOption(this.workspaceRoot);
            if (!compileOption) {
                vscode.window.showErrorMessage('Failed to get compile options');
                return;
            }

            // Ensure build options contain the force rebuild flag
            if (compileOption.buildOption) {
                compileOption.buildOption.forceRebuild = true;
            }

            // Set to rebuild mode
            let newtask = taskProvider.taskMap.get(task.name);
            if (newtask) {
                (newtask as FpcTask).BuildMode = BuildMode.rebuild;
            }

            // Execute the task
            vscode.tasks.executeTask(task);
        } else {
            const task = await projectTask.getTask();
            const newtask = taskProvider.taskMap.get(task.name);
            if (newtask) {
                (newtask as FpcTask).BuildMode = BuildMode.rebuild;
            }
            vscode.tasks.executeTask(task);
        }
    };

    ProjectOpen = async (node?: FpcItem) => {
        // If a node is provided and it is a Lazarus project, open the .lpi file
        if (node && node.projectType === ProjectType.Lazarus) {
            return;
            // var lpiFile = path.join(this.workspaceRoot, node.file);
            // if(!node.projectTask?.isInLpi){
            //     lpiFile = path.join(this.workspaceRoot, node.file.replace(/\.lpi$/, '.lps'));
            // }
            // if (fs.existsSync(lpiFile)) {
            //     const doc = await vscode.workspace.openTextDocument(lpiFile);
            //     const text = doc.getText();
            //     // Find <BuildModes> section (supports tags with attributes)
            //     const buildModesMatch = text.match(/<BuildModes[^>]*>([\s\S]*?)<\/BuildModes>/i);
            //     let offset = 0;
            //     if (buildModesMatch) {
            //         const buildModesContent = buildModesMatch[1];
            //         const fullMatch = buildModesMatch[0];
            //         const buildModesStart = (buildModesMatch.index || 0) + (fullMatch.length - buildModesContent.length - '</BuildModes>'.length);
            //         // Try two formats: <Item Name="..."> and <ItemX Name="...">
            //         let itemMatch: RegExpMatchArray | null = null;
                    
            //         // First try <Item Name="..."> format
            //         const itemRegex1 = new RegExp(`<Item\\s+Name\\s*=\\s*["']${node.label}["']`, 'i');
            //         itemMatch = buildModesContent.match(itemRegex1);
                    
            //         // If not found, try <ItemX Name="..."> format (like <Item1>, <Item2>, etc.)
            //         if (!itemMatch) {
            //             const itemRegex2 = new RegExp(`<Item\\d*\\s+Name\\s*=\\s*["']${node.label}["']`, 'i');
            //             itemMatch = buildModesContent.match(itemRegex2);
            //         }
                    
            //         if (itemMatch && itemMatch.index !== undefined) {
            //             offset = buildModesStart + itemMatch.index;
            //         }
            //     }
            //     const position = doc.positionAt(offset);
            //     await vscode.window.showTextDocument(doc, { selection: new vscode.Selection(position, position) });
            //     return;
            // }
        }

        // By default, open tasks.json
        const file = path.join(this.workspaceRoot, ".vscode", "tasks.json");
        if (fs.existsSync(file)) {
            const doc = await vscode.workspace.openTextDocument(file);
            const offset = doc.getText().indexOf('"label": "' + node?.label + '"');
            const position = doc.positionAt(offset);
            await vscode.window.showTextDocument(doc, { selection: new vscode.Selection(position, position) });
        } else {
            vscode.window.showErrorMessage("Task configuration file not found");
        }
    };

    ProjectNew = async () => {
        try {
            const selectedTemplate = await this.templateManager.selectTemplate();

            if (!selectedTemplate) {
                return;
            }

            const projectName = await vscode.window.showInputBox({
                prompt: 'Enter project name',
                value: 'newproject',
                validateInput: (value: string) => {
                    if (!value || value.trim().length === 0) {
                        return 'Project name cannot be empty';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                        return 'Project name can only contain letters, numbers, underscores and hyphens';
                    }
                    return null;
                }
            });

            if (projectName) {
                await this.templateManager.createProjectFromTemplate(selectedTemplate, projectName.trim());
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create project from starter: ${error}`);
        }
    };

    NewProjectFromTemplate = async () => {
        await this.ProjectNew();
    };

    projectSetDefault = async (node: FpcItem) => {
        // If this is a task node (level 1), use its project task to set as default
        if (node.level === 1 && node.projectTask) {
            await node.projectTask.setAsDefault();

            // Refresh the unified project explorer to update the UI
            const { projectProvider } = require('./extension');
            projectProvider?.refresh();

            // Restart the client to apply changes
            await client.restart();
            return;
        }
    };

    openWithLazarus = async (node: FpcItem) => {
        // Only support Lazarus projects at level 0
        if (node.level !== 0 || node.projectType !== ProjectType.Lazarus) {
            vscode.window.showErrorMessage('This command is only available for Lazarus projects.');
            return;
        }

        // Get the project file path
        const projectFile = path.isAbsolute(node.file) ? node.file : path.join(this.workspaceRoot, node.file);
        if (!fs.existsSync(projectFile)) {
            vscode.window.showErrorMessage(`Project file not found: ${projectFile}`);
            return;
        }

        try {
            // Use vscode.env.openExternal to open the file with the default associated application
            // This simulates the file explorer's "Open with" behavior
            const fileUri = vscode.Uri.file(projectFile);
            await vscode.env.openExternal(fileUri);
            
            //vscode.window.showInformationMessage(`Opening ${path.basename(projectFile)} with default application...`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open with default application: ${error}`);
        }
    };

    CodeComplete = (textEditor: TextEditor, edit: TextEditorEdit) => {
        client.doCodeComplete(textEditor);
    };
}
