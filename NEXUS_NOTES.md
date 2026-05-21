# Nexus Notes

This repository is a Nexus fork of `coolchyni/fpctoolkit`, the FreePascal
Toolkit extension for VS Code.

Current intent:

- Keep the fork close to upstream until Nexus needs a specific fix.
- Use this checkout for reading, debugging, and controlled local changes.
- Make changes one step at a time, with verification before moving on.

Setup steps:

1. Clone the Nexus fork:

   `git clone https://github.com/nxrp-dev/nexus-pascal.git C:\gitdev\tools\nexus-pascal`

2. Install the current Node.js LTS release.

   On Windows, the preferred installer is the official Node.js LTS package.
   From PowerShell:

   ```powershell
   winget install --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
   ```

   Verify after opening a new terminal:

   ```powershell
   node --version
   npm --version
   ```

   If the current terminal has not picked up the updated `PATH`, verify by
   using the install path directly:

   ```powershell
   & "C:\Program Files\nodejs\node.exe" --version
   & "C:\Program Files\nodejs\npm.cmd" --version
   ```

3. Install project dependencies.

   Start in the local toolkit checkout:

   ```powershell
   cd C:\gitdev\tools\nexus-pascal
   npm.cmd ci
   ```

   Verify:

   ```powershell
   Test-Path node_modules
   ```

4. Compile the TypeScript sources.

   Start in the local toolkit checkout:

   ```powershell
   cd C:\gitdev\tools\nexus-pascal
   npm.cmd run compile
   ```

   Verify:

   ```powershell
   Test-Path out\extension.js
   ```

Dependency audit note:

- `npm.cmd audit` currently reports vulnerabilities in the upstream dependency
  tree.
- Do not run `npm.cmd audit fix` as a routine setup step.
- Dependency updates should be handled as intentional source changes with a
  compile check after each step.

Current status:

- No Nexus source patches have been made.
- No extension package is installed from this checkout.
- Build outputs and dependency folders should not be committed.

Generated folders to keep out of source control:

- `node_modules/`
- `out/`
- `dist/`
- `*.vsix`
