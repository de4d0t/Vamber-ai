# Release Workflow & Auto-Update Rules for Vamber AI

Whenever modifying or updating this repository:

1. **Version Alignment**:
   - Check `manifest.json` and bump `"version"`.
   - Ensure `background.js` points to `https://api.github.com/repos/de4d0t/Vamber-ai/releases/latest`.

2. **Automated Packaging**:
   - Run `powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1` to produce `vamber-ai-v<version>.zip`.

3. **Git Tagging & Release**:
   - Commit changes and tag with `v<version>`.
   - Ensure the user or CI creates a GitHub Release with tag `v<version>` and uploads `vamber-ai-v<version>.zip`.
