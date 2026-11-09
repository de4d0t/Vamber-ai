const DEFAULTS = { detail: "compact" };
const detailOptions = Array.from(document.querySelectorAll("[data-detail]"));
const manifestVersion = chrome.runtime.getManifest().version;
const versionLabel = document.getElementById("currentVersion");
const updateButton = document.getElementById("updateButton");
const detailHint = document.getElementById("detailHint");
let selectedDetail = DEFAULTS.detail;
let statusTimer = null;

versionLabel.textContent = `v${manifestVersion}`;

chrome.storage.sync.get(DEFAULTS, (settings) => {
  selectDetail(settings.detail || DEFAULTS.detail, false);
});

for (const button of detailOptions) {
  button.addEventListener("click", () => selectDetail(button.dataset.detail, true));
}

updateButton.addEventListener("click", () => {
  handleSingleButtonAction();
});

function defaultHintText() {
  return selectedDetail === "compact"
    ? "Compact to save tokens"
    : "Detailed HTML and element attributes";
}

function showTemporaryStatus(text, durationMs = 2400) {
  window.clearTimeout(statusTimer);
  detailHint.textContent = text;
  if (durationMs > 0) {
    statusTimer = window.setTimeout(() => {
      detailHint.textContent = defaultHintText();
    }, durationMs);
  }
}

function handleSingleButtonAction() {
  const isUpdatePending = updateButton.classList.contains("available");
  updateButton.classList.add("checking");
  updateButton.disabled = true;
  showTemporaryStatus(isUpdatePending ? "Updating directly from GitHub…" : "Checking GitHub & reloading…", 0);

  chrome.runtime.sendMessage({ type: "APPLY_GITHUB_UPDATE" }, (result) => {
    updateButton.classList.remove("checking");
    updateButton.disabled = false;

    if (chrome.runtime.lastError) {
      showTemporaryStatus("Reloading extension…", 1000);
      window.setTimeout(() => chrome.runtime.reload(), 150);
      return;
    }

    renderUpdateStatus(result);

    if (result?.updatedNow) {
      showTemporaryStatus(`Updated to v${result.activeVersion}!`, 2800);
      return;
    }

    if (result?.available && (result.downloadUrl || result.releaseUrl)) {
      showTemporaryStatus(`Downloading v${result.latestVersion} ZIP…`, 3000);
      chrome.tabs.create({ url: result.downloadUrl || result.releaseUrl });
      return;
    }

    showTemporaryStatus(`Up to date (v${result?.activeVersion || manifestVersion}) · Reloading…`, 1200);
    window.setTimeout(() => chrome.runtime.reload(), 350);
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
  selectedDetail = detail === "detailed" ? "detailed" : "compact";
  for (const button of detailOptions) {
    const active = button.dataset.detail === selectedDetail;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
  window.clearTimeout(statusTimer);
  detailHint.textContent = defaultHintText();
  if (save) chrome.storage.sync.set({ detail: selectedDetail });
}

function renderUpdateStatus(result) {
  updateButton.classList.remove("available");
  updateButton.disabled = false;

  const displayedVersion = result?.activeVersion || manifestVersion;
  versionLabel.textContent = `v${displayedVersion}`;

  if (!result || result.status === "error") {
    updateButton.title = result?.message || "Click to check GitHub or reload extension";
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  if (result.available) {
    updateButton.classList.add("available");
    updateButton.title = `Update available: v${result.latestVersion}. Click to update now.`;
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  updateButton.title = `Vamber AI v${displayedVersion} is up to date. Click to check updates & reload.`;
  updateButton.setAttribute("aria-label", updateButton.title);
}
