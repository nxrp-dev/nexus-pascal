import * as fs from 'fs';
import * as path from 'path';
import { readLazarusBuildModes } from '../providers/lazarus';
import {
    FpcBuildTarget,
    FpcProjectModel,
    LazarusBuildTarget,
    LazarusProjectModel,
    PascalBuildTarget,
    PascalProject
} from '../model/pascalProject';
import { FpcTaskDefinition, LazarusTaskDefinition } from '../providers/taskDefinitions';
import { WorkspaceTasksService } from './workspaceTasksService';

export class PascalProjectModelService {
    public constructor(private readonly workspaceTasks: WorkspaceTasksService) {
    }

    public loadProjects(): PascalProject[] {
        const projectsByFile = new Map<string, PascalProject>();
        const tasks = this.workspaceTasks.getTasks();

        for (const taskDefinition of tasks) {
            if (taskDefinition.type === 'fpc') {
                this.collectFpcProject(taskDefinition, projectsByFile);
            } else if (taskDefinition.type === 'lazarus') {
                this.collectLazarusProject(taskDefinition, projectsByFile);
            }
        }

        const projects = Array.from(projectsByFile.values());
        this.applyDefaultTarget(projects);
        return projects;
    }

    public getDefaultTarget(projects: PascalProject[] = this.loadProjects()): PascalBuildTarget | undefined {
        for (const project of projects) {
            const target = project.targets.find(candidate => candidate.isDefault);
            if (target) {
                return target;
            }
        }

        return projects[0]?.targets[0];
    }

    public async setDefaultTarget(target: PascalBuildTarget): Promise<void> {
        await this.workspaceTasks.setDefaultBuildTarget(target);
    }

    private collectFpcProject(taskDefinition: FpcTaskDefinition, projectsByFile: Map<string, PascalProject>): void {
        if (!taskDefinition.file) {
            return;
        }

        const cwd = this.workspaceTasks.resolveWorkspacePath(taskDefinition.cwd);
        const projectFile = this.workspaceTasks.resolveWorkspacePath(taskDefinition.file, cwd);
        const project = this.getOrCreateFpcProject(projectFile, taskDefinition, projectsByFile);
        const label = taskDefinition.label || project.label;

        project.targets.push({
            id: this.createTargetId(projectFile, label),
            kind: 'fpc',
            label,
            projectId: project.id,
            projectFile,
            isDefault: taskDefinition.group?.isDefault === true,
            isInProjectFile: false,
            taskDefinition
        });
    }

    private collectLazarusProject(taskDefinition: LazarusTaskDefinition, projectsByFile: Map<string, PascalProject>): void {
        if (!taskDefinition.project) {
            return;
        }

        const cwd = this.workspaceTasks.resolveWorkspacePath(taskDefinition.cwd);
        const projectFile = this.workspaceTasks.resolveWorkspacePath(taskDefinition.project, cwd);
        const project = this.getOrCreateLazarusProject(projectFile, projectsByFile);
        const buildMode = taskDefinition.buildMode || taskDefinition.label || 'Default';
        const label = taskDefinition.label || buildMode;

        this.addLazarusTarget(project, {
            id: this.createTargetId(projectFile, label, buildMode),
            kind: 'lazarus',
            label,
            projectId: project.id,
            projectFile,
            cwd: path.dirname(projectFile),
            buildMode,
            isDefault: taskDefinition.group?.isDefault === true,
            isInProjectFile: false,
            taskDefinition
        });

        for (const mode of readLazarusBuildModes(projectFile)) {
            this.addLazarusTarget(project, {
                id: this.createTargetId(projectFile, mode.name, mode.name),
                kind: 'lazarus',
                label: mode.name,
                projectId: project.id,
                projectFile,
                cwd: path.dirname(projectFile),
                buildMode: mode.name,
                isDefault: this.isDefaultLazarusTarget(projectFile, mode.name),
                isInProjectFile: true
            });
        }
    }

    private getOrCreateFpcProject(
        projectFile: string,
        taskDefinition: FpcTaskDefinition,
        projectsByFile: Map<string, PascalProject>
    ): FpcProjectModel {
        const existing = projectsByFile.get(projectFile);
        if (existing?.kind === 'fpc') {
            return existing;
        }

        const project: FpcProjectModel = {
            id: projectFile,
            kind: 'fpc',
            label: path.basename(taskDefinition.file || projectFile),
            file: projectFile,
            fileExists: fs.existsSync(projectFile),
            isDefault: false,
            targets: []
        };
        projectsByFile.set(projectFile, project);
        return project;
    }

    private getOrCreateLazarusProject(projectFile: string, projectsByFile: Map<string, PascalProject>): LazarusProjectModel {
        const existing = projectsByFile.get(projectFile);
        if (existing?.kind === 'lazarus') {
            return existing;
        }

        const project: LazarusProjectModel = {
            id: projectFile,
            kind: 'lazarus',
            label: path.basename(projectFile),
            file: projectFile,
            fileExists: fs.existsSync(projectFile),
            isDefault: false,
            targets: []
        };
        projectsByFile.set(projectFile, project);
        return project;
    }

    private addLazarusTarget(project: LazarusProjectModel, target: LazarusBuildTarget): void {
        const key = this.getLazarusTargetKey(target);
        if (project.targets.some(candidate => this.getLazarusTargetKey(candidate) === key)) {
            return;
        }

        project.targets.push(target);
    }

    private applyDefaultTarget(projects: PascalProject[]): void {
        let defaultTarget = this.getExplicitDefaultTarget(projects);

        if (!defaultTarget) {
            defaultTarget = projects[0]?.targets[0];
        }

        for (const project of projects) {
            project.isDefault = false;
            for (const target of project.targets) {
                target.isDefault = target === defaultTarget;
                if (target.isDefault) {
                    project.isDefault = true;
                }
            }
        }
    }

    private getExplicitDefaultTarget(projects: PascalProject[]): PascalBuildTarget | undefined {
        for (const project of projects) {
            const target = project.targets.find(candidate => candidate.isDefault);
            if (target) {
                return target;
            }
        }

        return undefined;
    }

    private getLazarusTargetKey(target: LazarusBuildTarget): string {
        return (target.buildMode || target.label).toLowerCase();
    }

    private isDefaultLazarusTarget(projectFile: string, label: string): boolean {
        return this.workspaceTasks.isDefaultLazarusBuildMode(projectFile, label);
    }

    private createTargetId(projectFile: string, label: string, buildMode?: string): string {
        return `${projectFile}::${buildMode || label}`;
    }

}
