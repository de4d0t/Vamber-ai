(() => {
  "use strict";

  const DEFAULTS = { hoverPreview: true, detail: "compact", toast: true };
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
      for (const key of Object.keys(DEFAULTS)) {
        if (changes[key]) settings[key] = changes[key].newValue;
      }
      if (!settings.hoverPreview) clearHover();
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

  function getElementContext(element) {
    const classes = Array.from(element.classList);
    const isDetailed = settings.detail === "detailed";
    const classLimit = isDetailed ? 30 : 8;
    const classText = classes.slice(0, classLimit).join(" ") || "(none)";
    const remaining = classes.length > classLimit ? ` …+${classes.length - classLimit}` : "";

    let directText = "";
    if (element.tagName !== "SVG" && element.namespaceURI !== "http://www.w3.org/2000/svg") {
      directText = shorten(element.innerText || element.textContent, isDetailed ? 120 : 60);
    }

    const labelOrTooltip = findTooltipText(element);
    const interactive = element.closest("button, a, [role='button'], input, select, textarea, label, summary");
    const isInsideInteractive = interactive && interactive !== element;

    const details = [];
    const role = element.getAttribute("role") || (isInsideInteractive ? interactive.getAttribute("role") : null);
    const title = element.getAttribute("title");
    const ariaLabel = element.getAttribute("aria-label");
    const name = element.getAttribute("name") || (isInsideInteractive ? interactive.getAttribute("name") : null);

    if (role) details.push(`role="${role}"`);
    if (name) details.push(`name="${name}"`);
    if (title && title !== labelOrTooltip) details.push(`title="${shorten(title, 60)}"`);
    if (ariaLabel && ariaLabel !== labelOrTooltip) details.push(`aria-label="${shorten(ariaLabel, 60)}"`);
    if (element instanceof HTMLAnchorElement && element.href) details.push(`href="${shorten(element.href, 100)}"`);
    if (element instanceof HTMLInputElement && element.type) details.push(`type=${element.type}`);

    const dataAttrs = [];
    const collectDataAttrs = (el) => {
      if (!el?.attributes) return;
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-") && !attr.name.startsWith("data-vamber")) {
          dataAttrs.push(`${attr.name}="${shorten(attr.value, 40)}"`);
        }
      }
    };
    collectDataAttrs(element);
    if (isInsideInteractive) collectDataAttrs(interactive);

    if (dataAttrs.length) {
      details.push(Array.from(new Set(dataAttrs)).slice(0, 4).join(" "));
    }

    const lines = [
      "[UI target]",
      `Element: ${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
      `Path: ${getDomPath(element)}`,
      `Classes: ${classText}${remaining}`
    ];

    if (isInsideInteractive) {
      const parentTag = interactive.tagName.toLowerCase();
      const parentId = interactive.id ? `#${interactive.id}` : "";
      const parentClass = interactive.classList.item(0) ? `.${interactive.classList.item(0)}` : "";
      lines.push(`Parent: <${parentTag}${parentId}${parentClass}>`);
    }

    if (labelOrTooltip) {
      lines.push(`Label: "${shorten(labelOrTooltip, 80)}"`);
    }

    if (directText && directText !== labelOrTooltip) {
      lines.push(`Text: "${directText}"`);
    }

    if (details.length) {
      lines.push(`Info: ${details.join(" | ")}`);
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
      lines.push(`Layout: ${metrics.join(" | ")}`);

      const states = [];
      if (element.disabled || (isInsideInteractive && interactive?.disabled)) states.push("disabled");
      if (element.checked) states.push("checked");
      if (element.readOnly) states.push("readonly");
      if (states.length) {
        lines.push(`State: ${states.join(", ")}`);
      }

      const htmlTarget = (isInsideInteractive && interactive) ? interactive : element;
      const htmlPrefix = (isInsideInteractive && interactive) ? "Parent HTML" : "HTML";
      const cleanHtml = (htmlTarget.outerHTML || "").replace(/\s+/g, " ").trim();
      lines.push(`${htmlPrefix}: ${shorten(cleanHtml, 600)}`);
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
    if (!settings.toast) return;
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
    try {
      await copyText(getElementContext(element));
      flashSuccess(element);
      showToast(true);
    } catch (error) {
      console.warn("Vamber AI: clipboard copy failed.", error);
      showToast(false);
    }
  }

  document.addEventListener("mousemove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (settings.hoverPreview && event.altKey) {
      const element = getEventElement(event);
      const overlay = findTransparentOverlay(event.clientX, event.clientY, element);
      const target = overlay || element;
      if (target) showHover(target);
    } else {
      clearHover();
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt" && settings.hoverPreview) {
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
