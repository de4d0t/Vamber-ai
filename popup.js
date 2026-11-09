const DEFAULTS = { detail: "compact" };
const detailOptions = Array.from(document.querySelectorAll("[data-detail]"));
const currentVersion = chrome.runtime.getManifest().version;
const updateButton = document.getElementById("updateButton");
const detailHint = document.getElementById("detailHint");
let selectedDetail = DEFAULTS.detail;
let statusTimer = null;

document.getElementById("currentVersion").textContent = `v${currentVersion}`;

chrome.storage.sync.get(DEFAULTS, (settings) => {
  selectDetail(settings.detail || DEFAULTS.detail, false);
});

for (const button of detailOptions) {
  button.addEventListener("click", () => selectDetail(button.dataset.detail, true));
}

updateButton.addEventListener("click", () => {
  const targetUrl = updateButton.dataset.downloadUrl || updateButton.dataset.releaseUrl;
  if (targetUrl) {
    startDownload(targetUrl, updateButton.dataset.latestVersion);
    return;
  }
  triggerCheck(true);
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

function startDownload(url, version) {
  showTemporaryStatus(version ? `Downloading v${version} ZIP…` : "Downloading update…", 3000);
  chrome.tabs.create({ url });
}

function triggerCheck(downloadIfAvailable = false) {
  updateButton.classList.add("checking");
  updateButton.disabled = true;
  updateButton.title = "Checking GitHub for updates...";
  updateButton.setAttribute("aria-label", updateButton.title);
  showTemporaryStatus("Checking GitHub for updates…", 0);

  chrome.runtime.sendMessage({ type: "CHECK_FOR_UPDATE" }, (result) => {
    updateButton.classList.remove("checking");
    updateButton.disabled = false;

    if (chrome.runtime.lastError) {
      updateButton.title = "Update checker is unavailable";
      updateButton.setAttribute("aria-label", updateButton.title);
      showTemporaryStatus("Update checker is unavailable");
      return;
    }

    renderUpdateStatus(result);

    if (result?.available) {
      const url = result.downloadUrl || result.releaseUrl;
      if (downloadIfAvailable && url) {
        startDownload(url, result.latestVersion);
      } else {
        showTemporaryStatus(`Update v${result.latestVersion} is ready to download!`);
      }
    } else if (result?.status === "error") {
      showTemporaryStatus("Could not reach GitHub right now");
    } else {
      showTemporaryStatus(`Up to date (v${currentVersion})`);
    }
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
  delete updateButton.dataset.releaseUrl;
  delete updateButton.dataset.downloadUrl;
  delete updateButton.dataset.latestVersion;
  updateButton.disabled = false;

  if (!result || result.status === "error") {
    updateButton.title = result?.message || "Could not check GitHub right now. Click to check again.";
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  if (result.available) {
    updateButton.classList.add("available");
    updateButton.dataset.releaseUrl = result.releaseUrl || "";
    updateButton.dataset.downloadUrl = result.downloadUrl || result.releaseUrl || "";
    updateButton.dataset.latestVersion = result.latestVersion || "";
    updateButton.title = `Download Vamber AI v${result.latestVersion} (.zip)`;
    updateButton.setAttribute("aria-label", updateButton.title);
    return;
  }

  updateButton.title = result.status === "none"
    ? `No GitHub release published yet (current v${currentVersion}). Click to check again.`
    : `Vamber AI v${currentVersion} is up to date. Click to check for updates.`;
  updateButton.setAttribute("aria-label", updateButton.title);
}
