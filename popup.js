const DEFAULTS = { hoverPreview: true, detail: "compact", toast: true };
const controls = {
  hoverPreview: document.getElementById("hoverPreview"),
  detail: document.getElementById("detail"),
  toast: document.getElementById("toast")
};

chrome.storage.sync.get(DEFAULTS, (settings) => {
  controls.hoverPreview.checked = settings.hoverPreview;
  controls.detail.value = settings.detail;
  controls.toast.checked = settings.toast;
  updateHint();
});

controls.hoverPreview.addEventListener("change", () => chrome.storage.sync.set({ hoverPreview: controls.hoverPreview.checked }));
controls.toast.addEventListener("change", () => chrome.storage.sync.set({ toast: controls.toast.checked }));
controls.detail.addEventListener("change", () => {
  chrome.storage.sync.set({ detail: controls.detail.value });
  updateHint();
});

function updateHint() {
  document.getElementById("detailHint").textContent = controls.detail.value === "compact"
    ? "Compact to save tokens"
    : "Includes HTML and extra details";
}
