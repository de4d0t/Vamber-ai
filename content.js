(() => {
  "use strict";

  const PROBE_EVENT = "__vamber_probe__";
  const PROBE_ATTR = "data-vamber-probe";
  const IS_EXTENSION_WORLD = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

  const NOISE_COMPONENTS = new Set([
    "Fragment", "Suspense", "StrictMode", "Profiler", "ErrorBoundary",
    "Provider", "Consumer", "Context", "ForwardRef", "Memo",
    "Primitive", "Slot", "Slottable", "Presence", "Portal",
    "Collection", "CollectionSlot", "CollectionItemSlot",
    "DismissableLayer", "DismissableLayerBranch", "FocusScope", "FocusGuards",
    "Popper", "PopperAnchor", "PopperContent", "RovingFocusGroup", "RovingFocusGroupItem",
    "InnerLayoutRouter", "OuterLayoutRouter", "RedirectErrorBoundary", "RedirectBoundary",
    "NotFoundErrorBoundary", "NotFoundBoundary", "LoadingBoundary", "ErrorBoundaryHandler",
    "ScrollAndFocusHandler", "RenderFromTemplateContext", "HotReload",
    "AppRouter", "ServerRoot", "Root", "Head", "Html", "Body", "Router", "Routes", "Route"
  ]);

  const GENERIC_UTILITY_CLASSES = new Set([
    "flex", "inline-flex", "grid", "inline-grid", "block", "inline-block", "inline", "hidden", "contents",
    "relative", "absolute", "fixed", "sticky", "static", "isolate",
    "items-center", "items-start", "items-end", "items-stretch", "items-baseline",
    "justify-center", "justify-between", "justify-start", "justify-end", "justify-around",
    "flex-col", "flex-row", "flex-wrap", "flex-nowrap", "flex-1", "flex-auto", "flex-none", "shrink-0", "grow",
    "w-full", "h-full", "w-auto", "h-auto", "w-screen", "h-screen", "min-w-0", "min-h-0", "max-w-full",
    "overflow-hidden", "overflow-auto", "overflow-x-hidden", "overflow-y-auto", "truncate",
    "pointer-events-none", "pointer-events-auto", "select-none", "cursor-pointer", "cursor-default",
    "antialiased", "subpixel-antialiased", "sr-only", "not-sr-only", "group", "peer"
  ]);

  const SVG_CHILD_TAGS = new Set([
    "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
    "g", "use", "defs", "stop", "clippath", "mask", "tspan", "lineargradient", "radialgradient", "title", "desc"
  ]);

  function cleanSourcePath(rawFile, lineNumber) {
    if (!rawFile || typeof rawFile !== "string") return "";
    let file = rawFile
      .replace(/^rsc:\/\/[^/]+\/[^/]+\//i, "")
      .replace(/^(webpack-internal:\/\/\/|vite:\/\/\/|file:\/\/\/|https?:\/\/[^/]+\/)/i, "")
      .replace(/^(\(\w+-pages-browser\)\/|\.\.?\/)+/, "")
      .replace(/^\/@fs\//, "")
      .split("?")[0]
      .split("#")[0]
      .replace(/\\/g, "/")
      .trim();

    if (!file || /(^|\/)(node_modules|\.next|\.nuxt|\.svelte-kit|\.vite|dist|build|chunks)\//i.test(file)) {
      return "";
    }
    const parts = file.split("/").filter(Boolean);
    const srcIdx = parts.findIndex((p) => /^(src|app|pages|components|views|lib|modules|features)$/i.test(p));
    const trimmed = srcIdx !== -1 ? parts.slice(srcIdx).join("/") : parts.slice(-4).join("/");
    return lineNumber ? `${trimmed}:${lineNumber}` : trimmed;
  }

  function parseStackSource(stack) {
    if (!stack || typeof stack !== "string") return "";
    for (const line of stack.split("\n")) {
      const match = line.match(/(?:https?:\/\/[^/\s]+\/|webpack-internal:\/\/\/|\/@fs\/)?([^\s():?]+\.(?:tsx|ts|jsx|js|vue|svelte))(?:\?[^\s:)]*)?:(\d+)(?::\d+)?/i);
      if (match) {
        const cleaned = cleanSourcePath(match[1], match[2]);
        if (cleaned) return cleaned;
      }
    }
    return "";
  }

  function normalizeComponentName(rawName) {
    if (!rawName || typeof rawName !== "string") return "";
    let name = rawName.trim();
    const wrapperMatch = name.match(/^(?:ForwardRef|Memo|Context\.Provider|Styled)\(([^)]+)\)$/);
    if (wrapperMatch) name = wrapperMatch[1].trim();
    name = name.replace(/\$.*$/, "");
    if (
      name.length <= 1 ||
      /^[a-z]/.test(name) ||
      /^_?[A-Z0-9]{1,2}$/.test(name) ||
      NOISE_COMPONENTS.has(name) ||
      /(Provider|Context|Boundary|Slot|Portal|Presence|Fragment)$/.test(name)
    ) {
      return "";
    }
    return name;
  }

  function getReactTypeName(type) {
    if (!type) return "";
    if (typeof type === "function") return type.displayName || type.name || "";
    if (typeof type === "object") {
      return (
        type.displayName ||
        type.name ||
        type.render?.displayName ||
        type.render?.name ||
        type.type?.displayName ||
        type.type?.name ||
        ""
      );
    }
    return "";
  }

  function extractFrameworkMetadata(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

    // 1. React (16–19)
    let fiber = null;
    for (let el = element, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
      const key = Object.keys(el).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
      );
      if (key && el[key]) {
        fiber = el[key];
        break;
      }
    }

    if (fiber) {
      const collectFromChain = (startFiber, stepKey) => {
        const names = [];
        const seen = new Set();
        let source = "";
        for (let curr = startFiber, steps = 0; curr && steps < 35 && names.length < 5; curr = curr[stepKey], steps++) {
          if (!source) {
            const dbg = curr._debugSource || curr._debugOwner?._debugSource;
            if (dbg?.fileName) source = cleanSourcePath(dbg.fileName, dbg.lineNumber);
            if (!source && curr._debugStack?.stack) source = parseStackSource(curr._debugStack.stack);
          }
          const clean = normalizeComponentName(getReactTypeName(curr.type));
          if (clean && !seen.has(clean)) {
            names.push(clean);
            seen.add(clean);
          }
        }
        return { names: names.reverse(), source };
      };

      const ownerResult = collectFromChain(fiber, "_debugOwner");
      const returnResult = ownerResult.names.length < 2 ? collectFromChain(fiber, "return") : null;
      const finalNames = ownerResult.names.length >= (returnResult?.names.length || 0)
        ? ownerResult.names
        : returnResult.names;
      const finalSource = ownerResult.source || returnResult?.source || "";

      if (finalNames.length || finalSource) {
        return {
          component: finalNames.slice(-4).join(" > "),
          source: finalSource
        };
      }
    }

    // 2. Vue 3 & Vue 2
    for (let el = element, depth = 0; el && depth < 5; el = el.parentElement, depth++) {
      if (el.__vueParentComponent) {
        const names = [];
        const seen = new Set();
        let source = "";
        for (let comp = el.__vueParentComponent, steps = 0; comp && steps < 15 && names.length < 4; comp = comp.parent, steps++) {
          const file = comp.type?.__file || "";
          if (!source && file) source = cleanSourcePath(file);
          const rawName = comp.type?.__name || comp.type?.name || (file ? file.split("/").pop().replace(/\.vue$/i, "") : "");
          if (rawName && !seen.has(rawName) && !/^(Transition|KeepAlive|Teleport|Suspense|RouterView|RouterLink)$/.test(rawName)) {
            names.push(rawName);
            seen.add(rawName);
          }
        }
        names.reverse();
        if (names.length || source) return { component: names.join(" > "), source };
      }

      if (el.__vue__) {
        const vm = el.__vue__;
        const file = vm.$options?.__file || "";
        const name = vm.$options?.name || vm.$options?._componentTag || "";
        const source = cleanSourcePath(file);
        if (name || source) return { component: name, source };
      }

      // 3. Svelte
      if (el.__svelte_meta?.loc) {
        const { file, line } = el.__svelte_meta.loc;
        const source = cleanSourcePath(file, line);
        const name = file ? file.split("/").pop().replace(/\.svelte$/i, "") : "";
        if (name || source) return { component: name, source };
      }
    }

    // 4. Angular (dev mode)
    try {
      if (typeof window !== "undefined" && window.ng) {
        const comp = window.ng.getOwningComponent?.(element) || window.ng.getComponent?.(element);
        const name = comp?.constructor?.name?.replace(/^_/, "");
        if (name) return { component: name, source: "" };
      }
    } catch {}

    return null;
  }

  // When running in MAIN world, only listen for synchronous probe requests from ISOLATED world.
  if (!IS_EXTENSION_WORLD) {
    document.addEventListener(
      PROBE_EVENT,
      (event) => {
        const target = event.composedPath?.().find((n) => n instanceof Element) ||
          (event.target instanceof Element ? event.target : null);
        if (!target) return;
        try {
          const meta = extractFrameworkMetadata(target);
          if (meta) target.setAttribute(PROBE_ATTR, JSON.stringify(meta));
        } catch {}
      },
      true
    );
    return;
  }

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

  function isStableId(id) {
    if (!id || typeof id !== "string" || id.length > 64) return false;
    if (id.includes(":")) return false;
    if (/^(radix|headlessui|mui|chakra|mantine|react-select|downshift|reach|ariakit|reka|bits)-/i.test(id)) return false;
    if (/^\d+$/.test(id) || /[a-f0-9]{8}-[a-f0-9]{4}/i.test(id) || /[_-]\d{5,}$/.test(id)) return false;
    return true;
  }

  function isRuntimeHashClass(name) {
    return /^(css-[a-z0-9]+|sc-[a-zA-Z0-9]+|jsx-\d+|svelte-[a-z0-9]+|v-enter.*|v-leave.*|_[a-z0-9]{12,}|\w{24,})$/.test(name);
  }

  function isSelectorFriendlyClass(name) {
    if (!name || isRuntimeHashClass(name)) return false;
    if (/[:/\[\]!%()#]/.test(name)) return false;
    return true;
  }

  function pickSelectorClasses(classList, maxCount = 2) {
    const valid = Array.from(classList).filter(isSelectorFriendlyClass);
    const semantic = valid.filter((c) => !GENERIC_UTILITY_CLASSES.has(c) && !/^-?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space|text|font|bg|border|rounded|shadow|opacity|z|top|bottom|left|right|inset|w|h|min|max|leading|tracking)-/.test(c));
    const chosen = [...semantic, ...valid.filter((c) => !semantic.includes(c))];
    return chosen.slice(0, maxCount);
  }

  function formatClassList(classes, isDetailed) {
    const filtered = classes.filter((c) => !isRuntimeHashClass(c));
    if (!filtered.length) return "";
    if (isDetailed) return shorten(filtered.join(" "), 600);

    // In compact mode, strip state-variant noise (hover:, focus:, dark:, etc.) if there are plenty of classes
    const baseClasses = filtered.filter(
      (c) => !/^(hover|focus|focus-visible|focus-within|active|disabled|visited|dark|light|group-hover|peer-hover|placeholder|motion-safe|motion-reduce|supports|aria-|data-):/.test(c) &&
             !/^(transition|duration-|ease-|delay-|animate-)/.test(c)
    );
    const list = baseClasses.length >= 2 ? baseClasses : filtered;
    return shorten(list.join(" "), 150);
  }

  function extractCssModuleHint(element) {
    for (let el = element, depth = 0; el && depth < 3; el = el.parentElement, depth++) {
      for (const cls of el.classList || []) {
        const match = cls.match(/^_?([A-Z][A-Za-z0-9]+)_([a-zA-Z0-9_-]+)__[a-zA-Z0-9_-]{4,}$/);
        if (match) return `${match[1]}.${match[2]}`;
      }
    }
    return "";
  }

  function getFrameworkMetadata(element) {
    const direct = extractFrameworkMetadata(element);
    if (direct) return direct;
    try {
      element.dispatchEvent(new CustomEvent(PROBE_EVENT, { bubbles: true, composed: true }));
      const raw = element.getAttribute(PROBE_ATTR);
      if (raw) {
        element.removeAttribute(PROBE_ATTR);
        return JSON.parse(raw);
      }
    } catch {}
    const cssModule = extractCssModuleHint(element);
    return cssModule ? { component: cssModule, source: "" } : null;
  }

  function extractIconHint(element) {
    const svg = element.tagName?.toLowerCase() === "svg" ? element : element.querySelector?.("svg");
    const candidates = [element, svg, element.querySelector?.("i, [data-lucide], [data-icon]")].filter(Boolean);
    for (const node of candidates) {
      const dataIcon = node.getAttribute?.("data-lucide") || node.getAttribute?.("data-icon") || node.getAttribute?.("data-feather");
      if (dataIcon) return dataIcon;
      for (const cls of node.classList || []) {
        if (/^(lucide|fa|bi|ri|tabler-icon|heroicon| material-icons)-.+/.test(cls) && cls !== "fa-solid" && cls !== "fa-regular" && cls !== "fa-brands") {
          return cls;
        }
      }
      const useEl = node.querySelector?.("use");
      const href = useEl?.getAttribute("href") || useEl?.getAttribute("xlink:href") || "";
      if (href && href.includes("#")) return href.split("#").pop();
    }
    return "";
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

    const svgEl = element.tagName?.toLowerCase() === "svg" ? element : element.closest("svg");
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

  function findNearbyAnchor(element) {
    // Look at adjacent siblings or closest section/card heading when the target itself has no text
    const prev = element.previousElementSibling;
    if (prev) {
      const t = shorten(prev.innerText || prev.textContent, 50);
      if (t) return t;
    }
    const next = element.nextElementSibling;
    if (next) {
      const t = shorten(next.innerText || next.textContent, 50);
      if (t) return t;
    }
    for (let curr = element.parentElement, depth = 0; curr && depth < 4; curr = curr.parentElement, depth++) {
      const heading = curr.querySelector("h1, h2, h3, h4, h5, h6, legend, [data-slot='card-title'], [role='heading']");
      if (heading && !element.contains(heading)) {
        const t = shorten(heading.innerText || heading.textContent, 55);
        if (t) return t;
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

    const tag = element.tagName.toLowerCase();

    for (const attribute of ["data-testid", "data-test", "data-cy", "data-slot", "data-id"]) {
      const value = element.getAttribute(attribute);
      if (value) {
        const selector = `${tag}[${attribute}=${cssString(value)}]`;
        if (isUnique(selector)) return selector;
      }
    }

    if (isStableId(element.id)) {
      const selector = `#${esc(element.id)}`;
      if (isUnique(selector)) return selector;
    }

    for (const attribute of ["aria-label", "name", "placeholder", "title", "alt"]) {
      const value = element.getAttribute(attribute);
      if (!value?.trim() || value.length > 60) continue;
      const selector = `${tag}[${attribute}=${cssString(value.trim())}]`;
      if (isUnique(selector)) return selector;
    }

    if (element instanceof HTMLAnchorElement && element.getAttribute("href")) {
      const rawHref = element.getAttribute("href").trim();
      if (rawHref && !rawHref.startsWith("javascript:") && rawHref.length <= 80) {
        const selector = `a[href=${cssString(rawHref)}]`;
        if (isUnique(selector)) return selector;
      }
    }

    const parts = [];
    for (let current = element; current && current.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      const currTag = current.tagName.toLowerCase();
      let segment = currTag;
      let anchored = false;

      const testIdAttr = ["data-testid", "data-test", "data-cy"].find((a) => current.getAttribute(a));
      if (testIdAttr) {
        segment = `${currTag}[${testIdAttr}=${cssString(current.getAttribute(testIdAttr))}]`;
        anchored = true;
      } else if (isStableId(current.id)) {
        segment = `${currTag}#${esc(current.id)}`;
        anchored = true;
      } else {
        const slot = current.getAttribute("data-slot");
        const chosenClasses = pickSelectorClasses(current.classList, 2);
        if (slot && /^[a-z0-9_-]+$/i.test(slot)) {
          segment += `[data-slot=${cssString(slot)}]`;
        } else if (chosenClasses.length) {
          segment += chosenClasses.map((name) => `.${esc(name)}`).join("");
        }
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
          : [];
        if (siblings.length > 1) {
          const candidateWithSegment = [segment, ...parts].join(" > ");
          if (!isUnique(candidateWithSegment)) {
            segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
        }
      }

      parts.unshift(segment);
      const selector = parts.join(" > ");
      if (isUnique(selector)) return selector;
      if (anchored && current !== element) {
        const anchoredSelector = parts.join(" > ");
        if (isUnique(anchoredSelector)) return anchoredSelector;
      }
      if (current.tagName === "BODY" || current.tagName === "HTML" || parts.length >= 6) break;
    }
    return parts.join(" > ");
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
        50
      );
    };

    const modal = element.closest("dialog, [role='dialog'], [aria-modal='true']");
    if (modal) {
      const label = getRegionLabel(modal);
      return label ? `Modal "${label}"` : "Modal";
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
      if (name && regions[0] !== name) regions.unshift(name);
    }
    return regions.join(" > ");
  }

  function cleanHtmlSnippet(target, isSameElement) {
    const clone = target.cloneNode(true);
    if (isSameElement) clone.removeAttribute("class");
    clone.removeAttribute("style");
    clone.removeAttribute(PROBE_ATTR);

    for (const svg of clone.querySelectorAll("svg")) {
      svg.innerHTML = "…";
      svg.removeAttribute("style");
      svg.removeAttribute("xmlns");
      svg.removeAttribute("viewBox");
    }
    if (clone.tagName?.toLowerCase() === "svg") {
      clone.innerHTML = "…";
      clone.removeAttribute("xmlns");
      clone.removeAttribute("viewBox");
    }

    for (const node of clone.querySelectorAll("*")) {
      node.removeAttribute("style");
      for (const attr of Array.from(node.attributes)) {
        if (attr.name.startsWith("data-v-") || attr.value.startsWith("data:")) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.classList.length > 3) {
        node.setAttribute("class", Array.from(node.classList).slice(0, 3).join(" "));
      }
    }

    if (clone.children.length > 5) {
      while (clone.children.length > 4) {
        clone.lastElementChild.remove();
      }
      clone.appendChild(document.createComment(" … "));
    }

    return shorten((clone.outerHTML || "").replace(/\s+/g, " ").trim(), 400);
  }

  function resolveTargetElement(rawElement) {
    if (!rawElement) return null;
    // Lift internal SVG primitives (<path>, <circle>, <g>, etc.) up to the enclosing <svg>
    if (
      rawElement.namespaceURI === "http://www.w3.org/2000/svg" &&
      SVG_CHILD_TAGS.has(rawElement.tagName.toLowerCase())
    ) {
      return rawElement.closest("svg") || rawElement;
    }
    return rawElement;
  }

  function getElementContext(element) {
    const isDetailed = settings.detail === "detailed";
    const tag = element.tagName.toLowerCase();
    const selector = getUniqueSelector(element);

    let directText = "";
    if (tag !== "svg" && element.namespaceURI !== "http://www.w3.org/2000/svg") {
      directText = shorten(element.innerText || element.textContent, isDetailed ? 110 : 60);
    }

    const labelOrTooltip = findTooltipText(element);
    const primaryLabel = shorten(
      labelOrTooltip || directText || element.getAttribute("placeholder") || element.getAttribute("alt") || "",
      65
    );
    const iconHint = extractIconHint(element);
    const stableId = isStableId(element.id) ? element.id : "";

    let headerTarget = tag;
    if (stableId && !selector.startsWith(`#${stableId}`)) headerTarget += `#${stableId}`;
    if (primaryLabel) headerTarget += ` "${primaryLabel}"`;
    if (iconHint) headerTarget += ` (icon: ${iconHint})`;

    const lines = [
      `## Element: ${headerTarget}`,
      "Task: [Describe_the_change]"
    ];

    const routePath = `${location.pathname || "/"}${location.hash && location.hash.length < 40 ? location.hash : ""}`;
    if (routePath) {
      lines.push(`- Page: \`${routePath}\``);
    }

    const fw = getFrameworkMetadata(element);
    const section = getSectionContext(element);
    if (fw?.source) {
      lines.push(`- Source: \`${fw.source}\`${fw.component ? ` (${fw.component})` : ""}`);
    } else if (fw?.component && section) {
      lines.push(`- Component: ${fw.component} (${section})`);
    } else if (fw?.component) {
      lines.push(`- Component: ${fw.component}`);
    }

    lines.push(`- Selector: \`${selector}\``);

    if (section && (!fw?.component || fw?.source)) {
      lines.push(`- Section: ${section}`);
    }

    if (typeof ShadowRoot !== "undefined" && element.getRootNode() instanceof ShadowRoot) {
      lines.push("- Scope: shadow-root");
    }

    const interactive = element.closest("button, a, [role='button'], [role='tab'], [role='menuitem'], input, select, textarea, label, summary");
    const isInsideInteractive = Boolean(interactive && interactive !== element);
    if (isInsideInteractive) {
      const parentSelector = getUniqueSelector(interactive);
      const parentLabel = shorten(interactive.getAttribute("aria-label") || interactive.getAttribute("title") || "", 50);
      lines.push(`- Parent: \`${parentSelector}\`${parentLabel && parentLabel !== primaryLabel ? ` "${parentLabel}"` : ""}`);
    }

    // Only emit Text if it adds new information not already shown in the header's primaryLabel
    if (directText && directText !== primaryLabel) {
      lines.push(`- Text: "${directText}"`);
    } else if (!primaryLabel && !stableId && !iconHint) {
      const near = findNearbyAnchor(element);
      if (near) lines.push(`- Near: "${near}"`);
    }

    // Collect non-redundant attributes
    const attributes = [];
    const attrKeys = [
      "data-testid", "data-test", "data-cy", "data-slot", "data-variant", "data-state",
      "name", "type", "role", "placeholder", "for", "aria-label", "title", "alt",
      "aria-pressed", "aria-expanded", "aria-current"
    ];
    if (isDetailed && stableId && !selector.includes(stableId)) {
      attributes.push(`id="${stableId}"`);
    }
    for (const name of attrKeys) {
      const value = element.getAttribute(name)?.trim();
      if (!value) continue;
      if (!isDetailed && (value === primaryLabel || selector.includes(`${name}=`))) continue;
      attributes.push(`${name}="${shorten(value, 50)}"`);
    }

    const linkEl = element instanceof HTMLAnchorElement ? element : (interactive instanceof HTMLAnchorElement ? interactive : null);
    if (linkEl?.href) {
      try {
        const url = new URL(linkEl.href, location.origin);
        const hrefVal = url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
        if (hrefVal && !selector.includes(hrefVal)) {
          attributes.push(`href="${shorten(hrefVal, 80)}"`);
        }
      } catch {}
    }

    const imgEl = element.tagName === "IMG" ? element : element.querySelector?.("img");
    const rawSrc = imgEl?.getAttribute("src")?.trim();
    if (rawSrc && !rawSrc.startsWith("data:") && !rawSrc.startsWith("blob:")) {
      try {
        const srcUrl = new URL(rawSrc, location.origin);
        attributes.push(`src="${shorten(srcUrl.pathname, 70)}"`);
      } catch {
        attributes.push(`src="${shorten(rawSrc, 70)}"`);
      }
    }

    const states = [];
    if (element.disabled || (isInsideInteractive && interactive?.disabled)) states.push("disabled");
    if (element.checked) states.push("checked");
    if (element.readOnly) states.push("readonly");
    if (states.length) attributes.push(...states);

    if (attributes.length) {
      lines.push(`- Attrs: ${attributes.join(" | ")}`);
    }

    const classText = formatClassList(Array.from(element.classList), isDetailed);
    if (classText) {
      lines.push(`- Classes: \`${classText}\``);
    }

    if (isDetailed) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const metrics = [
        `${Math.round(rect.width)}×${Math.round(rect.height)}px`,
        style.display,
        style.position !== "static" ? `${style.position}${style.zIndex && style.zIndex !== "auto" ? ` z=${style.zIndex}` : ""}` : null,
        Number(style.opacity) < 1 ? `opacity=${style.opacity}` : null
      ].filter(Boolean);
      lines.push(`- Layout: ${metrics.join(" | ")}`);

      const htmlTarget = isInsideInteractive ? interactive : element;
      const htmlPrefix = isInsideInteractive ? "Parent HTML" : "HTML";
      lines.push(`- ${htmlPrefix}: \`${cleanHtmlSnippet(htmlTarget, htmlTarget === element)}\``);
    }

    return lines.join("\n");
  }

  function getEventElement(event) {
    const path = event.composedPath?.() || [];
    const raw = path.find((node) => node instanceof Element)
      || (event.target instanceof Element ? event.target : event.target?.parentElement);
    return resolveTargetElement(raw);
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
      const target = resolveTargetElement(overlay || element);
      if (target) showHover(target);
    } else {
      clearHover();
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt") {
      const raw = document.elementFromPoint(pointer.x, pointer.y);
      const element = resolveTargetElement(raw);
      if (element) {
        const overlay = findTransparentOverlay(pointer.x, pointer.y, element);
        const target = resolveTargetElement(overlay || element);
        if (target) showHover(target);
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
    void selectElement(resolveTargetElement(overlay || target));
  }, true);

})();
