# Instructions & Release Workflow for Vamber AI

This repository contains **Vamber AI — UI Context**, a Google Chrome extension (Manifest V3).

Whenever you update, modify, or release changes to this project, you **MUST** follow these release and versioning instructions.

---

## ⚠️ Critical Architecture Requirement: GitHub Releases
The background service worker (`background.js`) continuously checks:
`https://api.github.com/repos/de4d0t/Vamber-ai/releases/latest`
- If a newer version exists on GitHub Releases compared to `manifest.json`, the extension notifies the user with a cyan **`NEW`** badge on the browser toolbar.
- Therefore, **every version bump MUST be published as a GitHub Release** with a tag matching `v<version>` (e.g., `v1.6.6`).

---

## Standard Update & Release Checklist

Whenever asked to update the extension or prepare a release:

1. **Update Manifest Version**:
   - Open `manifest.json` and increment `"version": "X.Y.Z"` using Semantic Versioning.

2. **Update Documentation (if applicable)**:
   - If UI, shortcuts, permissions, or behavior change, update `README.md`.

3. **Package the Extension**:
   - Run the automated packaging script from the root directory:
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1
     ```
   - This creates a clean `vamber-ai-v<version>.zip` excluding git and internal developer files.

4. **Git Commit & Tag**:
   - Stage and commit the changes:
     ```bash
     git add .
     git commit -m "Bump version to v<version>: <summary of changes>"
     ```
   - Create an annotated git tag:
     ```bash
     git tag -a v<version> -m "Release v<version>"
     ```

5. **Push & GitHub Release**:
   - Push commits and tags to GitHub:
     ```bash
     git push origin main
     git push origin v<version>
     ```
   - If GitHub CLI (`gh`) or API credentials are available, create the release automatically:
     ```bash
     gh release create v<version> .\vamber-ai-v<version>.zip --title "Vamber AI v<version>" --notes "<release notes>"
     ```
   - If creating via the GitHub Web UI:
     - Navigate to: `https://github.com/de4d0t/Vamber-ai/releases/new`
     - Tag: `v<version>`
     - Title: `Vamber AI v<version>`
     - Attach: `vamber-ai-v<version>.zip`
     - Publish the release.
