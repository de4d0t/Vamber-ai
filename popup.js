const DEFAULTS = { detail: "compact" };
const detailOptions = Array.from(document.querySelectorAll("[data-detail]"));
const currentVersion = chrome.runtime.getManifest().version;
const updateButton = document.getElementById("updateButton");
document.getElementById("currentVersion").textContent = `v${currentVersion}`;

chrome.storage.sync.get(DEFAULTS, (settings) => {
  selectDetail(settings.detail || DEFAULTS.detail, false);
});

for (const button of detailOptions) {
  button.addEventListener("click", () => selectDetail(button.dataset.detail, true));
}

updateButton.addEventListener("click", () => {
  if (updateButton.dataset.releaseUrl) {
    chrome.tabs.create({ url: updateButton.dataset.releaseUrl });
    return;
  }
  triggerCheck();
});

function triggerCheck() {
  updateButton.title = "Checking GitHub for updates...";
  updateButton.setAttribute("aria-label", updateButton.title);
  chrome.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" }, (result) => {
    if (chrome.runtime.lastError) {
      updateButton.title = "Update checker is unavailable";
      updateButton.setAttribute("aria-label", updateButton.title);
      return;
    }
    renderUpdateStatus(result);
  });
}

chrome.runtime.sendMessage({ type: "GET_UPDATE_STATUS" }, (result) => {
  if (chrome.runtime.lastError) {
    updateButton.title = "Update checker is unavailable";
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }
  renderUpdateStatus(result);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.githubUpdate) {
    renderUpdateStatus(changes.githubUpdate.newValue);
  }
});

function selectDetail(detail, save) {
  const selected = detail === "detailed" ? "detailed" : "compact";
  for (const button of detailOptions) {
    const active = button.dataset.detail === selected;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
  document.getElementById("detailHint").textContent = selected === "compact"
    ? "Compact to save tokens"
    : "Detailed HTML and element attributes";
  if (save) chrome.storage.sync.set({ detail: selected });
}

function renderUpdateStatus(result) {
  updateButton.classList.remove("available");
  delete updateButton.dataset.releaseUrl;
  updateButton.disabled = false;

  if (!result || result.status === "error") {
    updateButton.title = result?.message || "Could not check GitHub right now. Click to check again.";
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  if (result.available) {
    updateButton.classList.add("available");
    updateButton.dataset.releaseUrl = result.releaseUrl;
    updateButton.title = `Update available: v${result.latestVersion}. Open GitHub release.`;
    updateButton.setAttribute("aria-label", updateButton.title);
    updateButton.disabled = false;
    return;
  }

  updateButton.title = result.status === "none"
    ? `No GitHub release published yet (current v${currentVersion}). Click to check again.`
    : `Vamber AI v${currentVersion} is up to date. Click to check again.`;
  updateButton.setAttribute("aria-label", updateButton.title);
}
