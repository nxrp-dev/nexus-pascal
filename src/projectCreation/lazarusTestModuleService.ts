import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WizardDetail, WizardMessage, WizardOutput, WizardPlan, WizardRequest } from '../wizard/wizardTypes';

export interface LazarusTestModuleRequest extends WizardRequest {
    projectFile: string;
    moduleName: string;
    targetDir: string;
    testUnitName: string;
    outputRoot: string;
    includeSampleTest: boolean;
    includeExports: boolean;
    enableTcpHost: boolean;
}

export interface TestModulePlan extends WizardPlan {
    moduleName: string;
    projectFile: string;
    projectDir: string;
    targetDir: string;
    outputRoot: string;
    lpiFile: string;
    lprFile: string;
    testUnitFile: string;
    testUnitName: string;
    unitPaths: string[];
    missingUnitPaths: string[];
    collisions: string[];
    includeSampleTest: boolean;
    includeExports: boolean;
    enableTcpHost: boolean;
}

export class LazarusTestModuleService {
    public constructor(private readonly workspaceRoot: string) {
    }

    public getInitialRequest(resource?: vscode.Uri): LazarusTestModuleRequest {
        const projectFile = this.resolveInitialProjectFile(resource);
        const projectBaseName = projectFile
            ? path.basename(projectFile, path.extname(projectFile))
            : 'Project';
        const moduleName = this.toPascalIdentifier(`${projectBaseName}TestModule`);
        const projectDir = projectFile ? path.dirname(projectFile) : this.workspaceRoot;
        const targetDir = path.join(projectDir, moduleName);
        const outputRoot = path.join(this.workspaceRoot, 'output', moduleName);

        return {
            projectFile,
            moduleName,
            targetDir,
            testUnitName: this.toPascalIdentifier(`ts${moduleName}Tests`),
            outputRoot,
            includeSampleTest: true,
            includeExports: true,
            enableTcpHost: false
        };
    }

    public createPlan(request: LazarusTestModuleRequest): TestModulePlan {
        const projectFile = (request.projectFile || '').trim();
        const moduleName = (request.moduleName || '').trim();
        const projectDir = projectFile ? path.dirname(projectFile) : this.workspaceRoot;
        const targetDir = (request.targetDir || '').trim();
        const outputRoot = (request.outputRoot || '').trim();
        const testUnitName = (request.testUnitName || '').trim();
        const unitPaths = [
            '.',
            this.toLazarusPath(this.relativePath(targetDir || projectDir, projectDir))
        ];
        const missingUnitPaths: string[] = [];
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!projectFile) {
            errors.push('Select a Lazarus project file.');
        } else if (!fs.existsSync(projectFile)) {
            errors.push('The selected Lazarus project file does not exist.');
        } else if (!this.isLazarusProjectFile(projectFile)) {
            errors.push('The source project must be a Lazarus .lpi file.');
        }

        const moduleNameError = this.validatePascalIdentifier(moduleName, 'Module name');
        if (moduleNameError) {
            errors.push(moduleNameError);
        }

        const testUnitNameError = this.validatePascalIdentifier(testUnitName, 'Test unit name');
        if (testUnitNameError) {
            errors.push(testUnitNameError);
        }

        if (!targetDir) {
            errors.push('Destination folder is required.');
        }

        if (!outputRoot) {
            errors.push('Output folder is required.');
        }

        if (!request.includeExports) {
            errors.push('NexusTest DLL exports are required for a loadable test module.');
        }

        if (request.enableTcpHost) {
            warnings.push('TCP/IP host wiring is not generated yet.');
        }

        const nexusTestSrc = this.findSiblingDirectory(projectDir, path.join('NexusTest', 'src'));
        const nexusLibSrc = this.findSiblingDirectory(projectDir, path.join('NexusLib', 'src'));

        if (nexusTestSrc) {
            unitPaths.push(this.toLazarusPath(this.relativePath(targetDir || projectDir, nexusTestSrc)));
        } else {
            missingUnitPaths.push('NexusTest/src');
        }

        if (nexusLibSrc) {
            unitPaths.push(this.toLazarusPath(this.relativePath(targetDir || projectDir, nexusLibSrc)));
        } else {
            missingUnitPaths.push('NexusLib/src');
        }

        for (const missingUnitPath of missingUnitPaths) {
            warnings.push(`Missing expected unit path: ${missingUnitPath}`);
        }

        const lpiFile = path.join(targetDir || projectDir, `${moduleName || 'TestModule'}.lpi`);
        const lprFile = path.join(targetDir || projectDir, `${moduleName || 'TestModule'}.lpr`);
        const testUnitFile = path.join(targetDir || projectDir, `${testUnitName || 'tsTestModuleTests'}.pas`);
        const collisions = [lpiFile, lprFile, testUnitFile].filter(fileName => fs.existsSync(fileName));

        for (const collision of collisions) {
            warnings.push(`Existing file may be overwritten: ${collision}`);
        }

        const outputs = this.createOutputs(lpiFile, lprFile, testUnitFile);
        const details = this.createDetails(projectFile, targetDir, outputRoot, testUnitName, unitPaths);
        const messages = this.createMessages(errors, warnings);

        return {
            title: 'Create NexusTest Module',
            summary: moduleName
                ? `Create ${moduleName} as a loadable NexusTest module.`
                : 'Choose test module options.',
            canExecute: errors.length === 0,
            messages,
            outputs,
            details,
            moduleName,
            projectFile,
            projectDir,
            targetDir,
            outputRoot,
            lpiFile,
            lprFile,
            testUnitFile,
            testUnitName,
            unitPaths,
            missingUnitPaths,
            collisions,
            includeSampleTest: request.includeSampleTest,
            includeExports: request.includeExports,
            enableTcpHost: request.enableTcpHost
        };
    }

    public async execute(plan: TestModulePlan): Promise<void> {
        if (!plan.canExecute) {
            throw new Error('The test module plan is not ready to create.');
        }

        if (!await this.confirmCollisions(plan)) {
            return;
        }

        this.writePlan(plan);

        const document = await vscode.workspace.openTextDocument(plan.lprFile);
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

        const missingPaths = plan.missingUnitPaths.length > 0
            ? ` Missing expected unit path(s): ${plan.missingUnitPaths.join(', ')}.`
            : '';
        vscode.window.showInformationMessage(`NexusTest module created: ${plan.moduleName}.${missingPaths}`);
    }

    private resolveInitialProjectFile(resource?: vscode.Uri): string {
        if (resource?.fsPath && this.isLazarusProjectFile(resource.fsPath)) {
            return resource.fsPath;
        }

        const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeFile && this.isLazarusProjectFile(activeFile)) {
            return activeFile;
        }

        return '';
    }

    private isLazarusProjectFile(fileName: string): boolean {
        return path.extname(fileName).toLowerCase() === '.lpi';
    }

    private validatePascalIdentifier(value: string, label: string): string | undefined {
        const trimmed = value.trim();
        if (!trimmed) {
            return `${label} is required.`;
        }

        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
            return `${label} must be a Pascal identifier: letters, numbers, and underscores, starting with a letter.`;
        }

        return undefined;
    }

    private async confirmCollisions(plan: TestModulePlan): Promise<boolean> {
        if (plan.collisions.length === 0) {
            return true;
        }

        const choice = await vscode.window.showWarningMessage(
            `${plan.collisions.length} test module file(s) already exist. Overwrite them?`,
            'Overwrite',
            'Cancel'
        );

        return choice === 'Overwrite';
    }

    private writePlan(plan: TestModulePlan): void {
        fs.mkdirSync(plan.targetDir, { recursive: true });
        fs.writeFileSync(plan.lprFile, this.createModuleSource(plan), 'utf8');
        fs.writeFileSync(plan.testUnitFile, this.createTestUnitSource(plan), 'utf8');
        fs.writeFileSync(plan.lpiFile, this.createProjectSource(plan), 'utf8');
    }

    private createModuleSource(plan: TestModulePlan): string {
        return `library ${plan.moduleName};

{$mode objfpc}{$H+}

uses
  SysUtils,
  tpNXTest,
  obNXTestModule,
  ${plan.testUnitName};

var
  gModule: TNXTestModule = nil;

function NXTest_Init: Integer; cdecl;
begin
  if Assigned(gModule) then
    Exit(cNXTestSuccess);

  try
    gModule := TNXTestModule.Create(@Register${plan.moduleName}Tests);
    Result := cNXTestSuccess;
  except
    on E: Exception do
    begin
      FreeAndNil(gModule);
      Result := cNXTestErrorInternal;
    end;
  end;
end;

procedure NXTest_Release; cdecl;
begin
  try
    FreeAndNil(gModule);
  except
    on E: Exception do
    begin
    end;
  end;
end;

function NXTest_ExecuteCommand(ARequest: PAnsiChar; var AResultId: Integer;
  var AResultSize: Integer): Integer; cdecl;
begin
  AResultId := 0;
  AResultSize := 0;

  try
    if not Assigned(gModule) then
      Exit(cNXTestErrorNotInitialized);

    Result := gModule.ExecuteCommand(ARequest, AResultId, AResultSize);
  except
    on E: Exception do
      Result := cNXTestErrorInternal;
  end;
end;

function NXTest_ReadResult(AResultId: Integer; ABuffer: PAnsiChar;
  ABufferSize: Integer; var ABytesWritten: Integer): Integer; cdecl;
begin
  ABytesWritten := 0;

  try
    if not Assigned(gModule) then
      Exit(cNXTestErrorNotInitialized);

    Result := gModule.ReadResult(AResultId, ABuffer, ABufferSize,
      ABytesWritten);
  except
    on E: Exception do
      Result := cNXTestErrorInternal;
  end;
end;

exports
  NXTest_Init,
  NXTest_Release,
  NXTest_ExecuteCommand,
  NXTest_ReadResult;

begin
end.
`;
    }

    private createTestUnitSource(plan: TestModulePlan): string {
        if (!plan.includeSampleTest) {
            return `unit ${plan.testUnitName};

{$mode objfpc}{$H+}

interface

uses
  obNXTestRegistry,
  obNXTestSuite;

procedure Register${plan.moduleName}Tests(ARegistry: TNXTestRegistry);

implementation

procedure Register${plan.moduleName}Tests(ARegistry: TNXTestRegistry);
begin
  ARegistry.AddSuite('${plan.moduleName}');
end;

end.
`;
        }

        return `unit ${plan.testUnitName};

{$mode objfpc}{$H+}

interface

uses
  obNXTestRegistry,
  obNXTestSuite,
  obNXTestContext;

procedure Register${plan.moduleName}Tests(ARegistry: TNXTestRegistry);

implementation

procedure TestModuleLoads(AContext: TNXTestContext);
begin
  AContext.AssertTrue(True, 'Generated test module is wired.');
end;

procedure Register${plan.moduleName}Tests(ARegistry: TNXTestRegistry);
var
  lSuite: TNXTestSuite;
begin
  lSuite := ARegistry.AddSuite('${plan.moduleName}');
  lSuite.AddTest('ModuleLoads', @TestModuleLoads);
end;

end.
`;
    }

    private createProjectSource(plan: TestModulePlan): string {
        const targetFile = this.toLazarusPath(this.relativePath(
            plan.targetDir,
            path.join(plan.outputRoot, '$(TargetCPU)-$(TargetOS)', plan.moduleName)
        ));
        const unitOutputDir = this.toLazarusPath(this.relativePath(
            plan.targetDir,
            path.join(plan.outputRoot, '$(TargetCPU)-$(TargetOS)', 'units')
        ));

        return `<?xml version="1.0" encoding="UTF-8"?>
<CONFIG>
  <ProjectOptions>
    <Version Value="12"/>
    <General>
      <SessionStorage Value="InProjectDir"/>
      <MainUnit Value="0"/>
      <Title Value="${this.escapeXml(plan.moduleName)}"/>
      <UseAppBundle Value="False"/>
      <ResourceType Value="res"/>
    </General>
    <BuildModes Count="1">
      <Item1 Name="Default" Default="True"/>
    </BuildModes>
    <PublishOptions>
      <Version Value="2"/>
    </PublishOptions>
    <RunParams>
      <FormatVersion Value="2"/>
    </RunParams>
    <Units Count="2">
      <Unit0>
        <Filename Value="${this.escapeXml(path.basename(plan.lprFile))}"/>
        <IsPartOfProject Value="True"/>
      </Unit0>
      <Unit1>
        <Filename Value="${this.escapeXml(path.basename(plan.testUnitFile))}"/>
        <IsPartOfProject Value="True"/>
      </Unit1>
    </Units>
  </ProjectOptions>
  <CompilerOptions>
    <Version Value="11"/>
    <Target>
      <Filename Value="${this.escapeXml(targetFile)}"/>
    </Target>
    <SearchPaths>
      <IncludeFiles Value="$(ProjOutDir)"/>
      <OtherUnitFiles Value="${this.escapeXml(plan.unitPaths.join(';'))}"/>
      <UnitOutputDirectory Value="${this.escapeXml(unitOutputDir)}"/>
    </SearchPaths>
    <Parsing>
      <SyntaxOptions>
        <UseAnsiStrings Value="False"/>
      </SyntaxOptions>
    </Parsing>
    <Linking>
      <Options>
        <ExecutableType Value="Library"/>
      </Options>
    </Linking>
  </CompilerOptions>
</CONFIG>
`;
    }

    private findSiblingDirectory(startDirectory: string, relativePath: string): string | undefined {
        let current = startDirectory;

        while (true) {
            const candidate = path.join(current, relativePath);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }

            const parent = path.dirname(current);
            if (parent === current) {
                return undefined;
            }

            current = parent;
        }
    }

    private relativePath(fromDirectory: string, toPath: string): string {
        const relative = path.relative(fromDirectory, toPath);
        return relative || '.';
    }

    private toLazarusPath(filePath: string): string {
        return filePath;
    }

    private toPascalIdentifier(value: string): string {
        const cleaned = value.replace(/[^A-Za-z0-9_]/g, '');
        if (/^[A-Za-z]/.test(cleaned)) {
            return cleaned;
        }

        return `NX${cleaned || 'TestModule'}`;
    }

    private escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private createMessages(errors: string[], warnings: string[]): WizardMessage[] {
        return [
            ...errors.map(text => ({ severity: 'error' as const, text })),
            ...warnings.map(text => ({ severity: 'warning' as const, text }))
        ];
    }

    private createOutputs(lpiFile: string, lprFile: string, testUnitFile: string): WizardOutput[] {
        return [
            { label: 'Project file', path: lpiFile },
            { label: 'Module source', path: lprFile },
            { label: 'Test unit', path: testUnitFile }
        ];
    }

    private createDetails(
        projectFile: string,
        targetDir: string,
        outputRoot: string,
        testUnitName: string,
        unitPaths: string[]
    ): WizardDetail[] {
        return [
            { label: 'Source project', value: projectFile || '(none selected)' },
            { label: 'Destination', value: targetDir || '(none)' },
            { label: 'Output root', value: outputRoot || '(none)' },
            { label: 'Test unit', value: testUnitName || '(none)' },
            { label: 'Unit paths', value: unitPaths.join('; ') }
        ];
    }
}
