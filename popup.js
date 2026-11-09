const DEFAULTS = { detail: "compact" };
const detailOptions = Array.from(document.querySelectorAll("[data-detail]"));
const manifestVersion = chrome.runtime.getManifest().version;
const versionLabel = document.getElementById("currentVersion");
const updateButton = document.getElementById("updateButton");
const downloadButton = document.getElementById("downloadButton");
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
  checkForUpdatesOnly();
});

downloadButton.addEventListener("click", () => {
  downloadAndApplyUpdate();
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

function checkForUpdatesOnly() {
  updateButton.classList.add("checking");
  updateButton.disabled = true;
  showTemporaryStatus("Checking GitHub for updates…", 0);

  chrome.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" }, (result) => {
    updateButton.classList.remove("checking");
    updateButton.disabled = false;

    if (chrome.runtime.lastError) {
      showTemporaryStatus("Update checker is unavailable");
      return;
    }

    renderUpdateStatus(result);

    if (result?.available) {
      showTemporaryStatus(`Update v${result.latestVersion} is available! Click download.`, 3200);
      return;
    }

    if (result?.status === "error") {
      showTemporaryStatus("Could not reach GitHub right now");
      return;
    }

    showTemporaryStatus(`Up to date (v${result?.activeVersion || manifestVersion})`);
  });
}

function downloadAndApplyUpdate() {
  downloadButton.classList.add("checking");
  downloadButton.disabled = true;
  showTemporaryStatus("Downloading & applying update…", 0);

  chrome.runtime.sendMessage({ type: "APPLY_GITHUB_UPDATE" }, (result) => {
    downloadButton.classList.remove("checking");
    downloadButton.disabled = false;

    if (chrome.runtime.lastError) {
      showTemporaryStatus("Update failed");
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

    if (result?.status === "error") {
      showTemporaryStatus("Could not reach GitHub right now");
      return;
    }

    showTemporaryStatus(`Up to date (v${result?.activeVersion || manifestVersion})`);
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
  updateButton.disabled = false;
  downloadButton.disabled = false;
  downloadButton.classList.add("hidden");

  const displayedVersion = result?.activeVersion || manifestVersion;
  versionLabel.textContent = `v${displayedVersion}`;

  if (!result || result.status === "error") {
    updateButton.title = result?.message || "Click to check for updates";
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  if (result.available) {
    downloadButton.classList.remove("hidden");
    downloadButton.title = `Download & apply update v${result.latestVersion}`;
    downloadButton.setAttribute("aria-label", downloadButton.title);
    updateButton.title = `Update v${result.latestVersion} is available. Click to re-check.`;
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  updateButton.title = `Vamber AI v${displayedVersion} is up to date. Click to check for updates.`;
  updateButton.setAttribute("aria-label", updateButton.title);
}
