(() => {
  "use strict";

  const DEFAULTS = { detail: "compact" };
  const FLASH_MS = 500;
  let settings = { ...DEFAULTS };
  let hoveredElement = null;
  let hoverOverlay = null;
  let pointer = { x: 0, y: 0 };
  let lastCandidateRefresh = 0;
  let transparentCandidates = [];

  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get(DEFAULTS, (saved) => { settings = { ...DEFAULTS, ...saved }; });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes.detail) settings.detail = changes.detail.newValue || DEFAULTS.detail;
    });
  }

  function shorten(value, limit) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
  }

  function pathSegment(element) {
    let segment = element.tagName.toLowerCase();
    if (element.id) return `${segment}#${element.id}`;
    const firstClass = element.classList.item(0);
    if (firstClass) segment += `.${firstClass}`;
    const sameTag = element.parentElement
      ? Array.from(element.parentElement.children).filter((child) => child.tagName === element.tagName)
      : [];
    if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(element) + 1})`;
    return segment;
  }

  function isLandmark(element) {
    if (!element || element.tagName === "BODY" || element.tagName === "HTML") return false;
    if (element.id) return true;
    const tag = element.tagName.toLowerCase();
    return ["header", "nav", "main", "aside", "section", "footer", "form", "dialog"].includes(tag);
  }

  function getDomPath(element) {
    const rawParts = [];
    for (let current = element; current?.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      const seg = pathSegment(current);
      rawParts.unshift({ seg, current });
      if (current.id && current !== element && current.tagName !== "BODY" && current.tagName !== "HTML") {
        break;
      }
      if (current.tagName === "BODY" || current.tagName === "HTML") break;
    }

    const segments = rawParts.map((p) => p.seg);
    if (segments.length <= 6) {
      return segments.join(" > ");
    }

    const landmarkIdx = rawParts.findIndex(
      (p, idx) => idx > 0 && idx < rawParts.length - 3 && isLandmark(p.current)
    );
    if (landmarkIdx !== -1) {
      return [segments[0], "…", segments[landmarkIdx], "…", ...segments.slice(-3)].join(" > ");
    }

    return [segments[0], "…", ...segments.slice(-4)].join(" > ");
  }

  function findTooltipText(element) {
    const withTitle = element.closest("[title]");
    if (withTitle?.getAttribute("title")?.trim()) {
      return withTitle.getAttribute("title").trim();
    }

    const withAria = element.closest("[aria-label]");
    if (withAria?.getAttribute("aria-label")?.trim()) {
      return withAria.getAttribute("aria-label").trim();
    }

    const svgEl = element.tagName === "SVG" ? element : element.closest("svg");
    if (svgEl) {
      const svgTitle = svgEl.querySelector("title");
      if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim();
    }

    const imgEl = element.tagName === "IMG" ? element : element.querySelector("img");
    if (imgEl?.alt?.trim()) return imgEl.alt.trim();

    if (element.id && typeof CSS !== "undefined" && CSS.escape) {
      try {
        const labelFor = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (labelFor?.innerText?.trim()) return labelFor.innerText.trim();
      } catch {}
    }

    const interactive = element.closest("button, a, [role='button'], label, summary");
    if (interactive && interactive !== element) {
      const t = (interactive.innerText || "").trim();
      if (t && t.length < 80) return t;
    }

    const groupContainer = element.closest(".group, [data-tooltip], [role='tooltip']");
    if (groupContainer) {
      const tip = groupContainer.querySelector(
        "[role='tooltip'], [data-tooltip-content], .tooltip, [class*='group-hover:opacity-100']"
      );
      if (tip) {
        const tipText = (tip.innerText || tip.textContent || "").trim();
        if (tipText && tipText.length < 100) return tipText;
      }
    }

    return "";
  }

  function getUniqueSelector(element) {
    const esc = (value) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
    const cssString = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\a ").replace(/\r/g, "\\d ")}"`;
    const root = element.getRootNode();
    const queryRoot = typeof root.querySelectorAll === "function" ? root : document;
    const isUnique = (selector) => {
      try { return queryRoot.querySelectorAll(selector).length === 1 && queryRoot.querySelector(selector) === element; }
      catch { return false; }
    };

    for (const attribute of ["data-testid", "data-test", "data-cy"] ) {
      const value = element.getAttribute(attribute);
      if (value) {
        const selector = `${element.tagName.toLowerCase()}[${attribute}="${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"]`;
        if (isUnique(selector)) return selector;
      }
    }
    if (element.id) {
      const selector = `#${esc(element.id)}`;
      if (isUnique(selector)) return selector;
    }

    for (const attribute of ["aria-label", "title", "name"]) {
      const value = element.getAttribute(attribute);
      if (!value?.trim()) continue;
      const selector = `${element.tagName.toLowerCase()}[${attribute}=${cssString(value)}]`;
      if (isUnique(selector)) return selector;
    }

    const parts = [];
    for (let current = element; current && current.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment += `#${esc(current.id)}`;
      } else {
        const stableClasses = Array.from(current.classList).filter((name) => !/^(_|css-|jsx-|sc-|\w{16,})/.test(name)).slice(0, 2);
        if (stableClasses.length) segment += stableClasses.map((name) => `.${esc(name)}`).join("");
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
          : [];
        if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(segment);
      const selector = parts.join(" > ");
      if (isUnique(selector)) return selector;
      if (current.tagName === "BODY" || current.tagName === "HTML") break;
    }
    return parts.join(" > ");
  }

  function getReactMetadata(element) {
    const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
    if (!fiberKey) return null;
    let fiber = element[fiberKey];
    if (!fiber) return null;

    const names = [];
    const seen = new Set();
    for (let current = fiber; current && names.length < 8; current = current._debugOwner) {
      const type = current.type;
      const name = typeof type === "function" ? (type.displayName || type.name) : (type?.displayName || type?.name);
      if (name && name !== "Fragment" && !seen.has(name)) {
        names.push(name);
        seen.add(name);
      }
    }
    names.reverse();
    return names.length ? { component: names.join(" > ") } : null;
  }

  function getSectionContext(element) {
    const getRegionLabel = (region) => {
      const root = region.getRootNode();
      const findById = (id) => root.getElementById?.(id) || document.getElementById(id);
      const labelledBy = (region.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .map((id) => findById(id)?.innerText || findById(id)?.textContent || "")
        .filter(Boolean)
        .join(" ");
      const heading = region.querySelector("h1, h2, h3, h4, [role='heading']");
      return shorten(
        region.getAttribute("aria-label") || region.getAttribute("title") || labelledBy || heading?.innerText || heading?.textContent || "",
        60
      );
    };

    const modal = element.closest("dialog, [role='dialog'], [aria-modal='true']");
    if (modal) {
      const label = getRegionLabel(modal);
      return label ? `Modal: "${label}"` : "Modal";
    }

    const regions = [];
    for (let current = element.parentElement; current && regions.length < 3; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute("role");
      const label = getRegionLabel(current);
      let name = "";
      if (tag === "header" || role === "banner") name = "Header";
      else if (tag === "nav" || role === "navigation") name = "Navbar";
      else if (tag === "main" || role === "main") name = "Main";
      else if (tag === "aside" || role === "complementary") name = "Sidebar";
      else if (tag === "footer" || role === "contentinfo") name = "Footer";
      else if (tag === "form") name = "Form";
      else if ((tag === "section" || tag === "article" || role === "region") && label) name = `${tag === "article" ? "Card" : "Section"} "${label}"`;
      if (name) regions.unshift(name);
    }
    return regions.join(" > ");
  }

  function getElementContext(element) {
    const classes = Array.from(element.classList);
    const isDetailed = settings.detail === "detailed";
    const classText = classes.join(" ") || "(none)";

    let directText = "";
    if (element.tagName !== "SVG" && element.namespaceURI !== "http://www.w3.org/2000/svg") {
      directText = shorten(element.innerText || element.textContent, isDetailed ? 120 : 60);
    }

    const labelOrTooltip = findTooltipText(element);
    const interactive = element.closest("button, a, [role='button'], input, select, textarea, label, summary");
    const isInsideInteractive = interactive && interactive !== element;

    const attributes = [];
    for (const name of ["id", "aria-label", "title", "name", "type", "role", "data-testid", "data-test", "data-cy", "aria-pressed", "aria-expanded", "aria-current"]) {
      const value = element.getAttribute(name);
      if (value !== null && value !== "") attributes.push(`${name}="${shorten(value, 60)}"`);
    }
    if (element instanceof HTMLAnchorElement && element.href) {
      try {
        attributes.push(`href="${shorten(new URL(element.href).pathname, 100)}"`);
      } catch {}
    }
    if (element.disabled) attributes.push("disabled");

    const label = labelOrTooltip || directText || element.getAttribute("placeholder") || element.getAttribute("alt") || "";
    const react = getReactMetadata(element);
    const section = getSectionContext(element);
    const lines = [
      `## 1. Element: ${element.tagName.toLowerCase()}${label ? ` "${shorten(label, 70)}"` : element.id ? `#${element.id}` : ""}`,
      "Task: [Describe_the_change]",
      `- Selector: \`${getUniqueSelector(element)}\``
    ];

    const componentNames = react?.component?.split(" > ").filter(Boolean).slice(-4);
    const componentName = componentNames?.join(" > ");
    if (componentName && section) lines.push(`- Component / Section: ${componentName} (${section})`);
    else if (componentName) lines.push(`- React component: ${componentName}`);
    else if (section) lines.push(`- Section: ${section}`);
    if (typeof ShadowRoot !== "undefined" && element.getRootNode() instanceof ShadowRoot) {
      lines.push("- Scope: selector is relative to this shadow root");
    }
    lines.push(`- Classes: \`${shorten(classText, isDetailed ? 1200 : 500)}\``);

    if (isInsideInteractive) {
      const parentTag = interactive.tagName.toLowerCase();
      const parentId = interactive.id ? `#${interactive.id}` : "";
      const parentClass = interactive.classList.item(0) ? `.${interactive.classList.item(0)}` : "";
      const parentLabel = interactive.getAttribute("aria-label") || interactive.getAttribute("title");
      lines.push(`- Parent: <${parentTag}${parentId}${parentClass}>${parentLabel ? ` "${shorten(parentLabel, 60)}"` : ""}`);
    }

    if (directText) {
      lines.push(`- Text: "${directText}"`);
    }

    if (attributes.length) {
      lines.push(`- Attributes: ${attributes.join(" | ")}`);
    }

    if (isDetailed) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const metrics = [
        `${Math.round(rect.width)}×${Math.round(rect.height)}px`,
        style.display,
        style.position !== "static" ? `${style.position}${style.zIndex && style.zIndex !== "auto" ? ` z=${style.zIndex}` : ""}` : null,
        Number(style.opacity) < 1 ? `opacity=${style.opacity}` : null,
      ].filter(Boolean);
      lines.push(`- Layout: ${metrics.join(" | ")}`);

      const states = [];
      if (element.disabled || (isInsideInteractive && interactive?.disabled)) states.push("disabled");
      if (element.checked) states.push("checked");
      if (element.readOnly) states.push("readonly");
      if (states.length) {
        lines.push(`- State: ${states.join(", ")}`);
      }

      const htmlTarget = (isInsideInteractive && interactive) ? interactive : element;
      const htmlPrefix = (isInsideInteractive && interactive) ? "Parent HTML" : "HTML";
      const htmlClone = htmlTarget.cloneNode(true);
      if (htmlTarget === element) htmlClone.removeAttribute("class");
      const cleanHtml = (htmlClone.outerHTML || "").replace(/\s+/g, " ").trim();
      lines.push(`- ${htmlPrefix}: \`${shorten(cleanHtml, 600)}\``);
    }

    return lines.join("\n");
  }

  function getEventElement(event) {
    const path = event.composedPath?.() || [];
    return path.find((node) => node instanceof Element)
      || (event.target instanceof Element ? event.target : event.target?.parentElement);
  }

  // Some canvas-based editors put instruction chips over the canvas with
  // pointer-events:none. The browser then reports only the canvas underneath.
  function findTransparentOverlay(x, y, underlying) {
    if (!underlying) return null;
    const base = underlying.getBoundingClientRect();
    const baseArea = base.width * base.height;
    if (underlying.namespaceURI === "http://www.w3.org/2000/svg") return null;
    if (underlying.tagName !== "CANVAS" && baseArea < 120000) return null;

    const now = performance.now();
    if (!lastCandidateRefresh || now - lastCandidateRefresh > 500) {
      transparentCandidates = [];
      for (const element of document.querySelectorAll("*")) {
        if (element.tagName.startsWith("VAMBER-AI-")) continue;
        const style = getComputedStyle(element);
        if (style.pointerEvents !== "none" || style.display === "none" || style.visibility === "hidden") continue;
        const z = Number.parseInt(style.zIndex, 10);
        transparentCandidates.push({ element, zIndex: Number.isFinite(z) ? z : 0 });
      }
      lastCandidateRefresh = now;
    }

    // A small hit slop keeps a transparent HTML overlay stable at rounded edges.
    if (hoveredElement && transparentCandidates.some(({ element }) => element === hoveredElement)) {
      const rect = hoveredElement.getBoundingClientRect();
      const slop = 6;
      if (x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop) {
        return hoveredElement;
      }
    }

    let best = null;
    let bestZ = -Infinity;
    let bestArea = 0;
    const maxOverlayArea = window.innerWidth * window.innerHeight * 0.4;
    for (const { element: candidate, zIndex } of transparentCandidates) {
      if (!candidate.isConnected) continue;
      if (candidate === underlying || candidate.contains(underlying)) continue;
      const rect = candidate.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const area = rect.width * rect.height;
      if (area < 500 || area > maxOverlayArea) continue;

      const style = getComputedStyle(candidate);
      if (style.pointerEvents !== "none" || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;

      if (zIndex > bestZ || (zIndex === bestZ && area > bestArea)) {
        best = candidate;
        bestZ = zIndex;
        bestArea = area;
      }
    }

    return best;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard copy command was rejected");
  }

  function placeIndicator(indicator, element) {
    const rect = element.getBoundingClientRect();
    const padding = indicator._vamberPadding || 0;
    const width = Math.max(rect.width + padding * 2, 6);
    const height = Math.max(rect.height + padding * 2, 6);
    indicator.style.setProperty("left", `${rect.left + (rect.width - width) / 2}px`, "important");
    indicator.style.setProperty("top", `${rect.top + (rect.height - height) / 2}px`, "important");
    indicator.style.setProperty("width", `${width}px`, "important");
    indicator.style.setProperty("height", `${height}px`, "important");
  }

  function createIndicator(element, color, width, padding = 0) {
    const indicator = document.createElement("vamber-ai-indicator");
    indicator._vamberPadding = padding;
    indicator.style.cssText = "all:initial!important;position:fixed!important;display:block!important;z-index:2147483646!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;opacity:1!important;overflow:visible!important;pointer-events:none!important;";
    const shadow = indicator.attachShadow({ mode: "closed" });
    const frame = document.createElement("div");
    frame.style.cssText = `position:absolute;inset:0;box-sizing:border-box;border:${width}px solid ${color};border-radius:3px;background:transparent;pointer-events:none;`;
    shadow.appendChild(frame);
    document.documentElement.appendChild(indicator);
    placeIndicator(indicator, element);
    return indicator;
  }

  function flashSuccess(element) {
    const indicator = createIndicator(element, "#22c55e", 2);
    window.setTimeout(() => indicator.remove(), FLASH_MS);
  }

  function showToast(success = true) {
    let host = document.getElementById("vamber-ai-toast-host");
    if (!host) {
      host = document.createElement("vamber-ai-toast");
      host.id = "vamber-ai-toast-host";
      host.style.cssText = "all:initial!important;position:fixed!important;z-index:2147483647!important;right:20px!important;bottom:20px!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;opacity:1!important;overflow:visible!important;pointer-events:none!important;";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>
        :host{all:initial}
        .toast{box-sizing:border-box;display:flex;align-items:center;gap:11px;min-width:285px;max-width:340px;padding:12px 15px;border:1px solid #24543b;border-radius:14px;background:linear-gradient(135deg,#101c20f5,#0b1220f5);color:#e2e8f0;font:13px/1.35 system-ui,sans-serif;box-shadow:0 12px 36px #0008,0 0 22px #22c55e10;backdrop-filter:blur(12px);opacity:0;transform:translateY(9px) scale(.98);transition:opacity .2s ease,transform .22s cubic-bezier(.2,.8,.2,1);}
        .toast.visible{opacity:1;transform:translateY(0) scale(1)}
        .toast.error{border-color:#63343a;box-shadow:0 12px 36px #0008,0 0 22px #ef444410}
        .icon{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border:1px solid #276444;border-radius:10px;background:#123321;color:#4ade80;font:700 16px/1 system-ui,sans-serif}
        .error .icon{border-color:#71383e;background:#35191e;color:#f87171}
        .title{font-weight:700;font-size:12px;color:#f1f5f9}
        .message{margin-top:2px;color:#94a3b8;font-size:11px}
      </style>
      <div class="toast" role="status" aria-live="polite"><span class="icon"></span><div><div class="title"></div><div class="message"></div></div></div>`;
      document.documentElement.appendChild(host);
    }
    const toast = host.shadowRoot.querySelector(".toast");
    toast.classList.toggle("error", !success);
    toast.querySelector(".icon").textContent = success ? "✓" : "!";
    toast.querySelector(".title").textContent = success ? "Copied to clipboard" : "Copy failed";
    toast.querySelector(".message").textContent = success
      ? "Element context is ready to paste."
      : "Clipboard access was blocked.";
    toast.classList.add("visible");
    window.clearTimeout(host._hideTimer);
    host._hideTimer = window.setTimeout(() => toast.classList.remove("visible"), 2100);
  }

  function clearHover() {
    hoverOverlay?.remove();
    hoverOverlay = null;
    hoveredElement = null;
  }

  function showHover(element) {
    if (element !== hoveredElement) {
      clearHover();
      hoveredElement = element;
      hoverOverlay = createIndicator(element, "#22d3ee", 1);
    } else if (hoverOverlay) {
      placeIndicator(hoverOverlay, element);
    }
  }

  function refreshIndicators() {
    if (hoverOverlay && hoveredElement) placeIndicator(hoverOverlay, hoveredElement);
  }

  async function selectElement(element) {
    if (!element) return;
    clearHover();
    const context = getElementContext(element);
    try {
      await copyText(context);
      flashSuccess(element);
      showToast(true);
    } catch (error) {
      console.warn("Vamber AI: clipboard copy failed.", error);
      showToast(false);
    }
  }

  document.addEventListener("mousemove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (event.altKey) {
      const element = getEventElement(event);
      const overlay = findTransparentOverlay(event.clientX, event.clientY, element);
      const target = overlay || element;
      if (target) showHover(target);
    } else {
      clearHover();
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt") {
      const element = document.elementFromPoint(pointer.x, pointer.y);
      if (element) {
        const overlay = findTransparentOverlay(pointer.x, pointer.y, element);
        if (overlay || element) showHover(overlay || element);
      }
    }
    if (event.key === "Escape") clearHover();
  }, true);
  window.addEventListener("keyup", (event) => { if (event.key === "Alt") clearHover(); }, true);
  window.addEventListener("blur", clearHover);
  window.addEventListener("scroll", refreshIndicators, true);
  window.addEventListener("resize", refreshIndicators, true);

  document.addEventListener("click", (event) => {
    if (!event.altKey || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = getEventElement(event);
    const overlay = findTransparentOverlay(event.clientX, event.clientY, target);
    void selectElement(overlay || target);
  }, true);

})();
