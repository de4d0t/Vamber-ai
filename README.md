# Vamber AI — UI Context

Pick an element on a live webpage and copy focused, AI-ready UI context to your clipboard. Use it to tell a coding assistant exactly which part of the interface you want to change—without relying on a screenshot alone.

![Vamber AI icon](icons/icon128.png)

## Features

- **Alt + Left Click** selects an element and copies a structured, AI-ready prompt with a unique CSS selector and a task placeholder.
- A nearby section or modal label, key accessibility attributes, and the React component name are included when available. Optional details are omitted when the page does not expose them.
- Hold **Alt** to preview the element with a cyan outline. Press **Esc** to clear the preview.
- A short green flash and confirmation toast indicate a successful copy.
- **Compact** mode keeps prompts short. It includes a unique CSS selector, the element tag and label, up to 500 characters of classes, and short text.
- **Detailed** mode includes up to 1,200 characters of classes, useful attributes, layout and state details, and a shortened HTML snippet.
- The toolbar icon shows a **NEW** badge when a newer GitHub Release is available. The update icon in the popup opens that release.
- The popup offers links to the developer's website and social profiles.

## Install in Chrome

Vamber AI is a plain Manifest V3 extension and does not need a build step.

1. Download or clone this repository and extract it if needed.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder containing `manifest.json`.
5. Pin Vamber AI from Chrome's Extensions menu for quick access.

To load a newer downloaded version, replace the extension files and select **Reload** on `chrome://extensions`.

## Use it

1. Open a regular website using `http://` or `https://`.
2. Hold **Alt** and move the pointer over the target to preview it.
3. Keep holding **Alt** and left-click to copy the context. Replace `Task: [Describe_the_change]` with the requested change before sending it to your coding assistant.
4. Choose **Compact** or **Detailed** in the popup to control how much context is copied.

The copied context may include the element's text, classes, accessibility labels, link address, data attributes, and—when Detailed mode is selected—a shortened HTML snippet. Review it before sharing, especially when selecting elements near private or account data.

## GitHub release checks

The extension checks the public `de4d0t/Vamber-ai` Releases endpoint on install, browser startup, when the cached check is older than six hours, and every six hours in the background. It compares the latest stable release tag with `version` in `manifest.json`.

To publish a release:

1. Update `version` in `manifest.json` using a higher semantic version, such as `1.6.6`.
2. Commit and push the changes to GitHub.
3. Create and publish a GitHub Release with a matching tag, such as `v1.6.6`.

The update indicator opens the GitHub release page; it does not install files into an unpacked extension. Download the release source, replace the local files, and reload the extension in `chrome://extensions`. Chrome Web Store distribution is required for Chrome-managed automatic updates.

## Permissions and privacy

- **Host access (`http://*/*`, `https://*/*`)** lets the content script work on websites the user chooses to inspect. Chrome's internal pages and other restricted browser pages are not accessible to extensions.
- **`clipboardWrite`** is used to copy the selected element context.
- **`storage`** saves the Compact/Detailed preference and caches public release-check results in local storage.
- **`alarms`** schedules the periodic GitHub release check.

Page content is read locally to build the selected element's context and is written to the clipboard after the user selects an element. Vamber AI does not upload the page URL, DOM, or copied context. The background checker makes an HTTPS request to GitHub for public release metadata; it does not include page data in that request.

## Limitations

- Browser-internal pages, the Chrome Web Store, and other restricted pages cannot be inspected.
- WebGL, Canvas, and Three.js objects are drawn inside a canvas and are not separate DOM elements. Vamber AI can identify the canvas or a detectable HTML overlay above it, but cannot identify an individual 3D mesh as a DOM node.
- Selectors are generated from the current DOM and may change when the page structure changes. Shadow DOM selectors are scoped to their shadow root.
- The content script runs in each matching frame; cross-origin frame content is captured only when the selected element is inside a frame where Chrome allows the script to run.

## Project files

```text
manifest.json       Extension metadata, permissions, and content script registration
content.js          Alt-click selection, hover preview, and context extraction
background.js       GitHub release checks and toolbar badge
popup.html          Extension popup
popup.css           Popup and status styling
popup.js            Popup settings and update indicator
icons/              Toolbar icons and icon generator
```

## Credits

Designed and developed by **Ahmed Al-jaberi**.

- [CYBORG website](https://iq-cyborg.vercel.app/)
- [Telegram](https://t.me/YYxYY)
- [Instagram](https://instagram.com/3BF)
- [GitHub](https://github.com/De4d0t)

## License

No license file is included yet. Choose and add a license before inviting others to reuse or redistribute the code.
