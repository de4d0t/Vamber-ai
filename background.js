const RELEASE_API = "https://api.github.com/repos/de4d0t/Vamber-ai/releases/latest";
const RELEASE_CHECK_ALARM = "github-release-check";
const CHECK_PERIOD_MINUTES = 360;
const DEFAULT_TITLE = "Vamber AI — UI Context";

chrome.runtime.onInstalled.addListener(() => {
  scheduleReleaseChecks();
  checkForUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleReleaseChecks();
  checkForUpdate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RELEASE_CHECK_ALARM) checkForUpdate();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_UPDATE_STATUS") {
    chrome.storage.local.get("githubUpdate", ({ githubUpdate }) => {
      const maxAge = githubUpdate?.available ? CHECK_PERIOD_MINUTES * 60_000 : 60_000;
      const isStale = !githubUpdate?.checkedAt || Date.now() - githubUpdate.checkedAt > maxAge;
      if (isStale) {
        checkForUpdate().then(sendResponse);
      } else {
        sendResponse(githubUpdate);
      }
    });
    return true;
  }

  if (message?.type === "CHECK_FOR_UPDATE") {
    checkForUpdate().then(sendResponse);
    return true;
  }
  return false;
});

function scheduleReleaseChecks() {
  chrome.alarms.create(RELEASE_CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
}

async function checkForUpdate() {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });

    if (response.status === 404) {
      const result = { status: "none", available: false, checkedAt: Date.now() };
      await saveUpdateStatus(result);
      return result;
    }
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const release = await response.json();
    const currentVersion = chrome.runtime.getManifest().version;
    const latestVersion = normalizeVersion(release.tag_name);
    const available = compareVersions(latestVersion, currentVersion) > 0;
    const result = {
      status: "checked",
      available,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      releaseName: release.name || "",
      checkedAt: Date.now()
    };
    await saveUpdateStatus(result);
    return result;
  } catch (error) {
    const previous = await chrome.storage.local.get("githubUpdate");
    const cached = previous.githubUpdate;
    if (cached?.available) {
      await updateBadge(cached);
      return cached;
    }
    const result = {
      status: "error",
      available: false,
      message: "Could not reach GitHub. Try again later.",
      checkedAt: Date.now()
    };
    await chrome.storage.local.set({ githubUpdate: result });
    console.warn("Vamber AI release check failed:", error);
    return result;
  }
}

async function saveUpdateStatus(status) {
  await chrome.storage.local.set({ githubUpdate: status });
  await updateBadge(status);
}

async function updateBadge(status) {
  if (status.available) {
    await chrome.action.setBadgeBackgroundColor({ color: "#06b6d4" });
    await chrome.action.setBadgeText({ text: "NEW" });
    await chrome.action.setTitle({ title: `Vamber AI — Update available: v${status.latestVersion}` });
    return;
  }
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: DEFAULT_TITLE });
}

function normalizeVersion(version) {
  return String(version || "").replace(/^v/i, "").split("-")[0];
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
