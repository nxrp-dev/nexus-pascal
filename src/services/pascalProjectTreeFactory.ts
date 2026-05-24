import * as vscode from 'vscode';
import { FpcBuildTarget, LazarusBuildTarget, PascalBuildTarget, PascalProject } from '../model/pascalProject';
import { FpcItem } from '../providers/fpcItem';
import { FpcTask } from '../providers/fpcTaskProject';
import { LazarusProject } from '../providers/lazarus';
import { LazarusBuildModeTask } from '../providers/lazarusBuildModeTask';
import { IProjectIntf, IProjectTask } from '../providers/projectIntf';
import { ProjectType } from '../providers/projectType';
import { PascalTaskFactory } from './pascalTaskFactory';

export class PascalProjectTreeFactory {
    public constructor(private readonly taskFactory: PascalTaskFactory) {
    }

    public createProjectItem(project: PascalProject): FpcItem {
        return new FpcItem(
            0,
            project.label,
            vscode.TreeItemCollapsibleState.Expanded,
            project.file,
            project.fileExists,
            project.isDefault,
            this.getProjectType(project),
            this.createProjectAdapter(project)
        );
    }

    public createTargetItem(project: PascalProject, target: PascalBuildTarget): FpcItem {
        return new FpcItem(
            1,
            target.label,
            vscode.TreeItemCollapsibleState.None,
            project.file,
            project.fileExists,
            target.isDefault,
            this.getProjectType(project),
            this.createTargetAdapter(project, target)
        );
    }

    public getProjectType(project: PascalProject): ProjectType {
        return project.kind === 'lazarus' ? ProjectType.Lazarus : ProjectType.FPC;
    }

    private createProjectAdapter(project: PascalProject): IProjectIntf {
        if (project.kind === 'lazarus') {
            const lazarusProject = new LazarusProject(project.label, project.file);
            lazarusProject.tasks = project.targets.map(target => this.createLazarusTargetAdapter(lazarusProject, target));
            return lazarusProject;
        }

        const fpcProject: IProjectIntf = {
            label: project.label,
            file: project.file,
            tasks: []
        };
        fpcProject.tasks = project.targets.map(target => this.createFpcTargetAdapter(fpcProject, target));
        return fpcProject;
    }

    private createTargetAdapter(project: PascalProject, target: PascalBuildTarget): IProjectTask {
        const projectAdapter = this.createProjectAdapter(project);
        const task = projectAdapter.tasks?.find(candidate => candidate.label === target.label);
        if (!task) {
            throw new Error(`Unable to create task adapter for ${target.label}`);
        }

        return task;
    }

    private createFpcTargetAdapter(project: IProjectIntf, target: FpcBuildTarget): IProjectTask {
        return new FpcTask(target.label, target.isDefault, project, target, this.taskFactory);
    }

    private createLazarusTargetAdapter(project: LazarusProject, target: LazarusBuildTarget): IProjectTask {
        return new LazarusBuildModeTask(
            target.label,
            target.isDefault,
            target.isInProjectFile,
            project,
            this.taskFactory,
            target.buildMode,
            target
        );
    }
}
