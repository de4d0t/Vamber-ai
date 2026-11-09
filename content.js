(() => {
  "use strict";

  const SCRIPT_VERSION = "1.8.8";
  const PROBE_EVENT = "__vamber_probe__";
  const PROBE_ATTR = "data-vamber-probe";
  const SUPERSEDE_EVENT = "__vamber_supersede__";
  const VERSION_ATTR = "data-vamber-version";
  const DETAIL_ATTR = "data-vamber-detail";
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

  function compareVer(left, right) {
    const a = String(left || "0").replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
    const b = String(right || "0").replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] || 0) - (b[i] || 0);
      if (diff !== 0) return Math.sign(diff);
    }
    return 0;
  }

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
        // Stack frames point at the transpiled module, so the line is only approximate ("~").
        const cleaned = cleanSourcePath(match[1], match[2] ? `~${match[2]}` : "");
        if (cleaned) return cleaned;
      }
    }
    return "";
  }

  // Shared UI-kit folders (shadcn `components/ui`, design systems...). An element defined there is
  // rarely what the user wants to edit; the call site that renders it is.
  const PRIMITIVE_PATH = /(^|\/)(ui|primitives?|design-system|atoms)\//i;
  const sourceFile = (source) => String(source || "").replace(/:~?\d+$/, "");

  function pushSource(list, source) {
    if (!source) return;
    if (list.length && sourceFile(list[list.length - 1]) === sourceFile(source)) return;
    list.push(source);
  }

  // `list` is ordered innermost-first: [where the DOM node is written, where its owner is used, ...]
  function pickSources(list) {
    if (!list.length) return { source: "" };
    const first = list[0];
    if (PRIMITIVE_PATH.test(sourceFile(first))) {
      const usage = list.find((s) => !PRIMITIVE_PATH.test(sourceFile(s)));
      if (usage) return { source: usage, definedIn: first };
    }
    return { source: first, usedIn: list[1] || "" };
  }

  const SKIP_PROP = /^(children|className|class|style|key|ref|as|asChild|id|tabIndex|dangerouslySetInnerHTML|on[A-Z].*|aria-.*|data-.*|render[A-Z]?.*)$/;
  const SENSITIVE_PROP = /password|token|secret|apikey/i;

  function formatProps(name, props) {
    if (!name || !props || typeof props !== "object") return null;
    const out = [];
    try {
      for (const key of Object.keys(props)) {
        if (out.length >= 6) break;
        if (SKIP_PROP.test(key) || SENSITIVE_PROP.test(key)) continue;
        const value = props[key];
        if (typeof value === "string") {
          const text = value.trim();
          if (!text || text.length > 40 || /[\n\r]/.test(text)) continue;
          out.push(`${key}="${text.replace(/"/g, "\\\"")}"`);
        } else if (typeof value === "number" && Number.isFinite(value)) {
          out.push(`${key}={${value}}`);
        } else if (value === true) {
          out.push(key);
        }
      }
    } catch {}
    return out.length ? { name, text: out.join(" ") } : null;
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
      const sourceOf = (f) => {
        const dbg = f._debugSource;
        if (dbg?.fileName) {
          const cleaned = cleanSourcePath(dbg.fileName, dbg.lineNumber);
          if (cleaned) return cleaned;
        }
        return f._debugStack?.stack ? parseStackSource(f._debugStack.stack) : "";
      };

      const collectFromChain = (startFiber, stepKey) => {
        const names = [];
        const seen = new Set();
        const sources = [];
        let props = null;
        for (
          let curr = startFiber, steps = 0;
          curr && steps < 35 && (names.length < 5 || sources.length < 4);
          curr = curr[stepKey], steps++
        ) {
          if (sources.length < 4) pushSource(sources, sourceOf(curr));
          if (names.length < 5) {
            const clean = normalizeComponentName(getReactTypeName(curr.type));
            if (clean && !seen.has(clean)) {
              if (!names.length) props = formatProps(clean, curr.memoizedProps);
              names.push(clean);
              seen.add(clean);
            }
          }
        }
        return { names: names.reverse(), sources, props };
      };

      const ownerResult = collectFromChain(fiber, "_debugOwner");
      const returnResult = ownerResult.names.length < 2 || !ownerResult.sources.length
        ? collectFromChain(fiber, "return")
        : null;
      const useReturn = Boolean(returnResult && returnResult.names.length > ownerResult.names.length);
      const finalNames = useReturn ? returnResult.names : ownerResult.names;
      const finalProps = useReturn ? returnResult.props : ownerResult.props;
      const finalSources = ownerResult.sources.length ? ownerResult.sources : (returnResult?.sources || []);

      if (finalNames.length || finalSources.length) {
        return {
          component: finalNames.slice(-4).join(" > "),
          ...pickSources(finalSources),
          props: finalProps
        };
      }
    }

    // 2. Vue 3 & Vue 2
    for (let el = element, depth = 0; el && depth < 5; el = el.parentElement, depth++) {
      if (el.__vueParentComponent) {
        const names = [];
        const seen = new Set();
        const sources = [];
        let props = null;
        for (
          let comp = el.__vueParentComponent, steps = 0;
          comp && steps < 15 && (names.length < 4 || sources.length < 4);
          comp = comp.parent, steps++
        ) {
          const file = comp.type?.__file || "";
          if (sources.length < 4) pushSource(sources, cleanSourcePath(file));
          const rawName = comp.type?.__name || comp.type?.name || (file ? file.split("/").pop().replace(/\.vue$/i, "") : "");
          if (names.length < 4 && rawName && !seen.has(rawName) && !/^(Transition|KeepAlive|Teleport|Suspense|RouterView|RouterLink)$/.test(rawName)) {
            if (!names.length) props = formatProps(rawName, comp.props);
            names.push(rawName);
            seen.add(rawName);
          }
        }
        names.reverse();
        if (names.length || sources.length) {
          return { component: names.join(" > "), ...pickSources(sources), props };
        }
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

  // In MAIN world (where window === window.top's page context and no extension runtime exists):
  // Only attach the synchronous probe responder unless running as an OTA USER_SCRIPT.
  const isMainPageWorld = !IS_EXTENSION_WORLD && (() => {
    try {
      // Detect if we are in MAIN world vs USER_SCRIPT isolated world:
      // MAIN world shares expando properties on document.documentElement with inline script / page context
      return !window.__vamberUserScriptWorld;
    } catch {
      return true;
    }
  })();

  if (isMainPageWorld) {
    window.__vamberProbeAbort?.abort();
    const probeAbort = new AbortController();
    window.__vamberProbeAbort = probeAbort;
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
      { capture: true, signal: probeAbort.signal }
    );
    return;
  }

  const DEFAULTS = { detail: "compact" };
  const FLASH_MS = 500;
  const DELETE_TASK_TEXT =
    "Remove this element from the UI. Delete its JSX/HTML node in the source component and clean up any props, state, handlers, imports, or styles that become unused as a result, without breaking sibling layout.";
  const FIX_TASK_TEXT =
    "Debug and fix this element's behavior. Trace its event handlers (onClick/onSubmit/onChange), state updates, props, and any related async/API calls in the source component to resolve why it is not working as expected.";
  const ACTION_COLORS = {
    "": "#22d3ee",
    d: "#f43f5e",
    f: "#f59e0b",
    a: "#a855f7"
  };
  let settings = {
    detail: document.documentElement?.getAttribute(DETAIL_ATTR) || DEFAULTS.detail
  };
  let hoveredElement = null;
  let hoverOverlay = null;
  let activeActionKey = "";
  let copiedBatch = [];
  let pointer = { x: 0, y: 0 };
  let lastCandidateRefresh = 0;
  let transparentCandidates = [];

  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get(DEFAULTS, (saved) => {
      settings = { ...DEFAULTS, ...saved };
      document.documentElement?.setAttribute(DETAIL_ATTR, settings.detail);
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes.detail) {
        settings.detail = changes.detail.newValue || DEFAULTS.detail;
        document.documentElement?.setAttribute(DETAIL_ATTR, settings.detail);
      }
    });
  }

  // If a newer OTA version of Vamber AI is already active on this page, let it handle UI events.
  const activeVersion = document.documentElement?.getAttribute(VERSION_ATTR);
  if (activeVersion && compareVer(activeVersion, SCRIPT_VERSION) > 0) {
    return;
  }

  window.__vamberUiAbort?.abort();
  const uiAbort = new AbortController();
  window.__vamberUiAbort = uiAbort;
  const { signal } = uiAbort;

  document.documentElement?.setAttribute(VERSION_ATTR, SCRIPT_VERSION);
  document.dispatchEvent(new CustomEvent(SUPERSEDE_EVENT, { detail: SCRIPT_VERSION }));

  document.addEventListener(
    SUPERSEDE_EVENT,
    () => {
      const currentActive = document.documentElement?.getAttribute(VERSION_ATTR);
      if (currentActive && compareVer(currentActive, SCRIPT_VERSION) > 0) {
        clearHover();
        uiAbort.abort();
      }
    },
    { signal }
  );

  function shorten(value, limit) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
  }

  // Reads text as it is written in the source code. Unlike `innerText`, this ignores CSS
  // `text-transform` (e.g. Tailwind `uppercase`), so the result stays greppable in the codebase.
  function readText(node, limit = 300) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const parts = [];
    let length = 0;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text && length < limit; text = walker.nextNode()) {
      const value = text.nodeValue?.trim();
      if (!value || text.parentElement?.closest("script, style, noscript, template")) continue;
      parts.push(value);
      length += value.length + 1;
    }
    return parts.join(" ");
  }

  function toHexColor(color) {
    const match = String(color || "").match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
    if (!match) return shorten(color, 40);
    const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
    if (alpha === 0) return "transparent";
    const hex = [match[1], match[2], match[3]]
      .map((v) => Math.min(255, Math.round(Number(v))).toString(16).padStart(2, "0"))
      .join("");
    return alpha < 1 ? `#${hex}/${Math.round(alpha * 100)}%` : `#${hex}`;
  }

  function boxShorthand(top, right, bottom, left) {
    const v = [top, right, bottom, left].map((x) => (x === "0px" ? "0" : x));
    if (v.every((x) => x === "0")) return "";
    if (v.every((x) => x === v[0])) return v[0];
    if (v[0] === v[2] && v[1] === v[3]) return `${v[0]} ${v[1]}`;
    if (v[1] === v[3]) return `${v[0]} ${v[1]} ${v[2]}`;
    return v.join(" ");
  }

  // Current visual values, so the agent can map "make it bigger / darker" to real tokens.
  function describeStyle(element, hasText, isDetailed) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const isSvg = element.namespaceURI === "http://www.w3.org/2000/svg";
    const out = [`${Math.round(rect.width)}×${Math.round(rect.height)}px`];

    if (hasText) {
      let font = `font ${style.fontSize}/${style.fontWeight}`;
      if (isDetailed && style.lineHeight !== "normal") font += ` lh ${style.lineHeight}`;
      if (isDetailed && style.letterSpacing !== "normal") font += ` ls ${style.letterSpacing}`;
      out.push(font);
      if (isDetailed) out.push(`family ${shorten(style.fontFamily.split(",")[0].replace(/["']/g, ""), 30)}`);
    }
    if (hasText || isSvg) out.push(`color ${toHexColor(style.color)}`);

    const bg = toHexColor(style.backgroundColor);
    if (bg !== "transparent") out.push(`bg ${bg}`);
    if (style.backgroundImage && style.backgroundImage !== "none") {
      out.push(/gradient\(/.test(style.backgroundImage) ? `bg-image ${shorten(style.backgroundImage, 90)}` : "bg-image url(…)");
    }

    const padding = boxShorthand(style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft);
    if (padding) out.push(`p ${padding}`);
    const margin = boxShorthand(style.marginTop, style.marginRight, style.marginBottom, style.marginLeft);
    if (margin) out.push(`m ${margin}`);
    if (/flex|grid/.test(style.display) && style.gap && !/^(normal|0px)( normal| 0px)?$/.test(style.gap)) {
      out.push(`gap ${style.gap}`);
    }

    const sides = [
      ["t", style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
      ["r", style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
      ["b", style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
      ["l", style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor]
    ].filter(([, width, lineStyle]) => Number.parseFloat(width) > 0 && lineStyle !== "none");
    if (sides.length === 4 && sides.every((s) => s[1] === sides[0][1] && s[3] === sides[0][3])) {
      out.push(`border ${sides[0][1]} ${sides[0][2]} ${toHexColor(sides[0][3])}`);
    } else {
      for (const [side, width, lineStyle, color] of sides) out.push(`border-${side} ${width} ${lineStyle} ${toHexColor(color)}`);
    }

    if (style.borderRadius && !/^0px( 0px)*$/.test(style.borderRadius)) out.push(`radius ${style.borderRadius}`);
    if (style.boxShadow && style.boxShadow !== "none") out.push(isDetailed ? `shadow ${shorten(style.boxShadow, 90)}` : "shadow");
    if (Number(style.opacity) < 1) out.push(`opacity ${style.opacity}`);

    return shorten(out.join(" | "), isDetailed ? 420 : 260);
  }

  function detectTheme() {
    for (const root of [document.documentElement, document.body].filter(Boolean)) {
      if (root.classList.contains("dark")) return "dark";
      if (root.classList.contains("light")) return "light";
      for (const attr of ["data-theme", "data-mode", "data-color-mode", "data-color-scheme", "data-bs-theme"]) {
        const value = root.getAttribute(attr)?.trim();
        if (value && value.length < 30) return value;
      }
    }
    try {
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches && document.querySelector("[class*='dark:']")) {
        return "dark (system)";
      }
    } catch {}
    return "";
  }

  // Viewport + active Tailwind-style breakpoint, so the agent edits the right responsive variant.
  function describeViewport() {
    const width = window.innerWidth;
    let usesBreakpoints = false;
    try {
      usesBreakpoints = Boolean(document.querySelector("[class*='sm:'], [class*='md:'], [class*='lg:'], [class*='xl:']"));
    } catch {}
    if (!usesBreakpoints) return `${width}px`;
    const breakpoint = width >= 1536 ? "2xl" : width >= 1280 ? "xl" : width >= 1024 ? "lg" : width >= 768 ? "md" : width >= 640 ? "sm" : "< sm";
    return `${width}px (${breakpoint})`;
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
        if (/^(lucide|fa|bi|ri|tabler-icon|heroicon|material-icons)-.+/.test(cls) && cls !== "fa-solid" && cls !== "fa-regular" && cls !== "fa-brands") {
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
    // An ancestor's title/aria-label only describes this element when it is the element itself,
    // an interactive wrapper (button, link...), or a close parent of a text-less node (icon).
    const hasOwnText = Boolean(readText(element, 20).trim());
    const describesElement = (host) => {
      if (!host) return false;
      if (host === element) return true;
      if (host.matches("button, a, [role='button'], [role='link'], [role='tab'], [role='menuitem'], label, summary")) return true;
      if (hasOwnText) return false;
      let depth = 0;
      for (let el = element; el && el !== host; el = el.parentElement) depth++;
      return depth <= 2;
    };

    const withTitle = element.closest("[title]");
    if (describesElement(withTitle) && withTitle.getAttribute("title")?.trim()) {
      return withTitle.getAttribute("title").trim();
    }

    const withAria = element.closest("[aria-label]");
    if (describesElement(withAria) && withAria.getAttribute("aria-label")?.trim()) {
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
        const labelText = readText(labelFor, 120).trim();
      } catch {}
    }

    const interactive = element.closest("button, a, [role='button'], label, summary");
    if (interactive && interactive !== element) {
      const t = readText(interactive, 120).trim();
      if (t && t.length < 80) return t;
    }

    const groupContainer = element.closest(".group, [data-tooltip], [role='tooltip']");
    if (groupContainer) {
      const tip = groupContainer.querySelector(
        "[role='tooltip'], [data-tooltip-content], .tooltip, [class*='group-hover:opacity-100']"
      );
      if (tip) {
        const tipText = readText(tip, 140).trim();
        if (tipText && tipText.length < 100) return tipText;
      }
    }

    return "";
  }

  function findNearbyAnchor(element) {
    const prev = element.previousElementSibling;
    if (prev) {
      const t = shorten(readText(prev, 80), 50);
      if (t) return t;
    }
    const next = element.nextElementSibling;
    if (next) {
      const t = shorten(readText(next, 80), 50);
      if (t) return t;
    }
    for (let curr = element.parentElement, depth = 0; curr && depth < 4; curr = curr.parentElement, depth++) {
      const heading = curr.querySelector("h1, h2, h3, h4, h5, h6, legend, [data-slot='card-title'], [role='heading']");
      if (heading && !element.contains(heading)) {
        const t = shorten(readText(heading, 80), 55);
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
        .map((id) => readText(findById(id), 80))
        .filter(Boolean)
        .join(" ");
      const heading = region.querySelector("h1, h2, h3, h4, [role='heading']");
      return shorten(
        region.getAttribute("aria-label") || region.getAttribute("title") || labelledBy || readText(heading, 80),
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
    if (
      rawElement.namespaceURI === "http://www.w3.org/2000/svg" &&
      SVG_CHILD_TAGS.has(rawElement.tagName.toLowerCase())
    ) {
      return rawElement.closest("svg") || rawElement;
    }
    return rawElement;
  }

  function getElementContext(element, taskText = "[ __________ ]") {
    const currentDetail = document.documentElement?.getAttribute(DETAIL_ATTR) || settings.detail;
    const isDetailed = currentDetail === "detailed";
    const tag = element.tagName.toLowerCase();
    const selector = getUniqueSelector(element);

    let directText = "";
    if (tag !== "svg" && element.namespaceURI !== "http://www.w3.org/2000/svg") {
      directText = shorten(readText(element, 160), isDetailed ? 110 : 60);
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
      `Task: ${taskText}`
    ];

    const routePath = `${location.pathname || "/"}${location.hash && location.hash.length < 40 ? location.hash : ""}`;
    const pageParts = [`- Page: \`${routePath}\``, `Viewport: ${describeViewport()}`];
    const theme = detectTheme();
    if (theme) pageParts.push(`Theme: ${theme}`);
    lines.push(pageParts.join(" | "));

    const fw = getFrameworkMetadata(element);
    const section = getSectionContext(element);
    if (fw?.source) {
      lines.push(`- Source: \`${fw.source}\`${fw.component ? ` (${fw.component})` : ""}`);
      if (fw.definedIn) lines.push(`- Defined in: \`${fw.definedIn}\``);
      else if (fw.usedIn) lines.push(`- Used in: \`${fw.usedIn}\``);
    } else if (fw?.component && section) {
      lines.push(`- Component: ${fw.component} (${section})`);
    } else if (fw?.component) {
      lines.push(`- Component: ${fw.component}`);
    }
    if (fw?.props?.name && fw.props.text) {
      lines.push(`- Props (${fw.props.name}): ${fw.props.text}`);
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

    if (directText && directText !== primaryLabel) {
      lines.push(`- Text: "${directText}"`);
    } else if (!primaryLabel && !stableId && !iconHint) {
      const near = findNearbyAnchor(element);
      if (near) lines.push(`- Near: "${near}"`);
    }

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

    const hasText = Boolean(directText) || /^(input|textarea|select)$/.test(tag);
    lines.push(`- Style: ${describeStyle(element, hasText, isDetailed)}`);

    if (isDetailed) {
      const style = getComputedStyle(element);
      const isFlex = /flex/.test(style.display);
      const metrics = [
        style.display,
        isFlex && style.flexDirection !== "row" ? style.flexDirection : null,
        (isFlex || /grid/.test(style.display)) && style.alignItems !== "normal" ? `align ${style.alignItems}` : null,
        (isFlex || /grid/.test(style.display)) && style.justifyContent !== "normal" ? `justify ${style.justifyContent}` : null,
        style.position !== "static" ? `${style.position}${style.zIndex && style.zIndex !== "auto" ? ` z=${style.zIndex}` : ""}` : null,
        style.overflow !== "visible" ? `overflow ${style.overflow}` : null
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
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
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
    indicator._vamberFrame = frame;
    shadow.appendChild(frame);
    document.documentElement.appendChild(indicator);
    placeIndicator(indicator, element);
    return indicator;
  }

  function flashSuccess(element, color = "#22c55e") {
    const indicator = createIndicator(element, color, 2);
    window.setTimeout(() => indicator.remove(), FLASH_MS);
  }

  function showToast(success = true, customTitle = "", customMessage = "") {
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
    toast.querySelector(".title").textContent = success ? (customTitle || "Copied to clipboard") : "Copy failed";
    toast.querySelector(".message").textContent = success
      ? (customMessage || "Element context is ready to paste.")
      : "Clipboard access was blocked.";
    toast.classList.add("visible");
    window.clearTimeout(host._hideTimer);
    host._hideTimer = window.setTimeout(() => toast.classList.remove("visible"), 2100);
  }

  function getActionKey(event) {
    const code = event.code || "";
    if (code === "KeyD") return "d";
    if (code === "KeyF") return "f";
    if (code === "KeyA") return "a";
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key === "d" || key === "f" || key === "a") return key;
    return "";
  }

  function isEditableTarget(node) {
    const el = node instanceof Element ? node : document.activeElement;
    if (!el) return false;
    return Boolean(el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function currentHoverColor() {
    return ACTION_COLORS[activeActionKey] || ACTION_COLORS[""];
  }

  function updateHoverColor() {
    if (hoverOverlay?._vamberFrame) {
      hoverOverlay._vamberFrame.style.borderColor = currentHoverColor();
    }
  }

  function clearHover() {
    hoverOverlay?.remove();
    hoverOverlay = null;
    hoveredElement = null;
  }

  function showHover(element) {
    const color = currentHoverColor();
    if (element !== hoveredElement) {
      clearHover();
      hoveredElement = element;
      hoverOverlay = createIndicator(element, color, 1);
    } else if (hoverOverlay) {
      updateHoverColor();
      placeIndicator(hoverOverlay, element);
    }
  }

  function refreshIndicators() {
    if (hoverOverlay && hoveredElement) placeIndicator(hoverOverlay, hoveredElement);
  }

  function resolvePointerTarget() {
    if (hoveredElement?.isConnected) return hoveredElement;
    const raw = document.elementFromPoint(pointer.x, pointer.y);
    const element = resolveTargetElement(raw);
    if (!element) return null;
    const overlay = findTransparentOverlay(pointer.x, pointer.y, element);
    return resolveTargetElement(overlay || element);
  }

  function parseContextEntry(rawContext, taskText) {
    const lines = rawContext.split("\n");
    const headerTarget = (lines[0] || "").replace(/^## Element:\s*/, "");
    const bodyLines = lines.slice(2);
    const pageLine = bodyLines[0]?.startsWith("- Page:") ? bodyLines[0] : "";
    const detailLines = pageLine ? bodyLines.slice(1) : bodyLines;
    return { rawContext, headerTarget, pageLine, detailLines, taskText };
  }

  function formatBatchContext(batch) {
    if (batch.length === 1) return batch[0].rawContext;
    const firstPage = batch[0].pageLine;
    const blocks = ["Task: [ __________ ]"];
    batch.forEach((entry, idx) => {
      const itemLines = [`## Element ${idx + 1}: ${entry.headerTarget}`];
      if (entry.pageLine && (idx === 0 || entry.pageLine !== firstPage)) {
        itemLines.push(entry.pageLine);
      }
      itemLines.push(...entry.detailLines);
      blocks.push(itemLines.join("\n"));
    });
    return blocks.join("\n\n");
  }

  async function selectElement(element, options = {}) {
    if (!element) return;
    clearHover();
    const taskText = options.append ? "[ __________ ]" : (options.taskText || "[ __________ ]");
    const rawContext = getElementContext(element, taskText);
    const entry = parseContextEntry(rawContext, taskText);

    if (options.append) {
      copiedBatch.push(entry);
    } else if (options.taskText) {
      copiedBatch = [];
    } else {
      copiedBatch = [entry];
    }

    const finalText = options.append ? formatBatchContext(copiedBatch) : rawContext;
    const count = copiedBatch.length;
    const toastTitle = options.append
      ? (count > 1 ? `Appended element (#${count})` : "Added element (#1)")
      : (options.toastTitle || "");
    const toastMessage = options.append
      ? `${count} ${count === 1 ? "element" : "elements"} in clipboard, ready to paste.`
      : (options.toastMessage || "");

    try {
      await copyText(finalText);
      flashSuccess(element, options.flashColor || "#22c55e");
      showToast(true, toastTitle, toastMessage);
    } catch (error) {
      console.warn("Vamber AI: clipboard copy failed.", error);
      showToast(false);
    }
  }

  document.addEventListener("mousemove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (event.shiftKey) {
      const element = getEventElement(event);
      const overlay = findTransparentOverlay(event.clientX, event.clientY, element);
      const target = resolveTargetElement(overlay || element);
      if (target) showHover(target);
    } else {
      activeActionKey = "";
      clearHover();
    }
  }, { capture: true, signal });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      if (isEditableTarget(event.target)) return;
      const target = resolvePointerTarget();
      if (target) showHover(target);
      return;
    }
    const actionKey = getActionKey(event);
    if (actionKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.shiftKey && isEditableTarget(event.target) && !hoveredElement) return;
      activeActionKey = actionKey;
      if (event.shiftKey) {
        event.preventDefault();
        const target = resolvePointerTarget();
        if (target) showHover(target);
        else updateHoverColor();
      }
      return;
    }
    if (event.key === "Escape") {
      activeActionKey = "";
      clearHover();
    }
  }, { capture: true, signal });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      activeActionKey = "";
      clearHover();
    } else if (getActionKey(event) === activeActionKey) {
      activeActionKey = "";
      updateHoverColor();
    }
  }, { capture: true, signal });

  window.addEventListener("blur", () => {
    activeActionKey = "";
    clearHover();
  }, { signal });
  window.addEventListener("scroll", refreshIndicators, { capture: true, signal });
  window.addEventListener("resize", refreshIndicators, { capture: true, signal });

  document.addEventListener("mousedown", (event) => {
    if (!event.shiftKey || event.button !== 0) return;
    event.preventDefault();
  }, { capture: true, signal });

  document.addEventListener("click", (event) => {
    if (!event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = getEventElement(event);
    const overlay = findTransparentOverlay(event.clientX, event.clientY, target);
    const resolved = resolveTargetElement(overlay || target);
    const action = activeActionKey;
    activeActionKey = "";

    if (action === "d") {
      void selectElement(resolved, {
        taskText: DELETE_TASK_TEXT,
        flashColor: "#f43f5e",
        toastTitle: "Copied delete task",
        toastMessage: "Remove-element task is ready to paste."
      });
    } else if (action === "f") {
      void selectElement(resolved, {
        taskText: FIX_TASK_TEXT,
        flashColor: "#f59e0b",
        toastTitle: "Copied fix-bug task",
        toastMessage: "Debug & fix instruction is ready to paste."
      });
    } else if (action === "a") {
      void selectElement(resolved, {
        append: true,
        flashColor: "#a855f7"
      });
    } else {
      void selectElement(resolved);
    }
  }, { capture: true, signal });

})();
