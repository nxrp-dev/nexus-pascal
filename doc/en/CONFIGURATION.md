# Extension Configuration

The Nexus Pascal extension provides various configuration options that can be set in VS Code settings:

## Environment Settings
Setting | Type | Description |
--------|------|-------------|
`nexusPascal.env.PP` | string | Compiler location (e.g., `/usr/bin/fpc`, `/usr/bin/ppc386`)
`nexusPascal.env.FPCDIR` | string | Free Pascal source code location (e.g., `/usr/local/share/fpcsrc`)
`nexusPascal.env.LAZARUSDIR` | string | Lazarus source code location (e.g., `/usr/local/share/lazsrc`)
`nexusPascal.env.FPCTARGET` | string | Target operating system (e.g., `win32`, `win64`, `linux`, `darwin`)
`nexusPascal.env.FPCTARGETCPU` | string | Target CPU family (e.g., `x86_64`)

## Language Server Settings
Setting | Type | Description |
--------|------|-------------|
`nexusPascal.pasls.path` | string | Pascal Language Server (pasls) file location
`nexusPascal.lsp.trace.server` | string | Trace communication between VS Code and pascal language server
`nexusPascal.lsp.initializationOptions.program` | string | Main program file. If not specified, uses current file
`nexusPascal.lsp.initializationOptions.overloadPolicy` | enum | Specify how duplicate functions or definitions are displayed
`nexusPascal.lsp.initializationOptions.maximumCompletions` | number | Maximum number of auto code suggestions displayed
`nexusPascal.lsp.initializationOptions.insertCompletionsAsSnippets` | boolean | Function or procedure parameters automatically become template insertions
`nexusPascal.lsp.initializationOptions.insertCompletionProcedureBrackets` | boolean | Automatically ignore parameters when inserting procedures or functions with parameters
`nexusPascal.lsp.initializationOptions.includeWorkspaceFoldersAsUnitPaths` | boolean | Add current working directory to unit file search directories (-Fu)
`nexusPascal.lsp.initializationOptions.includeWorkspaceFoldersAsIncludePaths` | boolean | Add current working directory to include directories (-Fi)
`nexusPascal.lsp.initializationOptions.checkSyntax` | boolean | Perform syntax checking when files are opened and saved
`nexusPascal.lsp.initializationOptions.publishDiagnostics` | boolean | Display syntax errors as diagnostic information
`nexusPascal.lsp.initializationOptions.workspaceSymbols` | boolean | Allow displaying classes, functions, procedures from workspace
`nexusPascal.lsp.initializationOptions.documentSymbols` | boolean | Allow displaying classes, functions, procedures from current document
`nexusPascal.lsp.initializationOptions.minimalisticCompletions` | boolean | Auto code suggestions contain minimal information
`nexusPascal.lsp.initializationOptions.showSyntaxErrors` | boolean | Show syntax error prompts in popup

## Formatting Settings
Setting | Type | Description |
--------|------|-------------|
`nexusPascal.format.enabled` | boolean | Enable source code formatting (using JCF)
`nexusPascal.format.tabsize` | number | Number of spaces to convert tab to
`nexusPascal.format.cfgpath` | string | Format configuration file path (jcfsettings.cfg)

## General Settings
Setting | Type | Description |
--------|------|-------------|
`nexusPascal.searchPath` | string[] | Unit file search path (-Fu)
`nexusPascal.libPath` | string[] | Library search path (-Fl)
`nexusPascal.customOptions` | string[] | Custom options
`nexusPascal.debug.autoBuild` | boolean | Automatically compile default project before debugging when files have changes
`nexusPascal.lazarus.enabled` | boolean | Enable Lazarus project support for .lpi files and Lazarus-specific features

## How to Configure

You can configure these settings in several ways:

### VS Code Settings UI
1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Nexus Pascal"
3. Modify the desired settings

### Settings JSON
Add configurations to your `settings.json` file:

```json
{
  "nexusPascal.env.PP": "/usr/bin/fpc",
  "nexusPascal.format.enabled": true,
  "nexusPascal.lsp.initializationOptions.checkSyntax": true
}
```

### Workspace Settings
For project-specific settings, create a `.vscode/settings.json` file in your workspace:

```json
{
  "nexusPascal.searchPath": ["./lib", "./units"],
  "nexusPascal.customOptions": ["-dDEBUG"]
}
```
