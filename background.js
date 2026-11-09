const RELEASE_API = "https://api.github.com/repos/de4d0t/Vamber-ai/releases/latest";
const RAW_CONTENT_URL = (tag) => `https://raw.githubusercontent.com/de4d0t/Vamber-ai/${tag}/content.js`;
const RELEASE_CHECK_ALARM = "github-release-check";
const CHECK_PERIOD_MINUTES = 60;
const DEFAULT_TITLE = "Vamber AI — UI Context";
const OTA_SCRIPT_IDS = ["vamber-ota-user", "vamber-ota-main"];

chrome.runtime.onInstalled.addListener(() => {
  scheduleReleaseChecks();
  restoreOrClearOtaScript().then(() => checkForUpdate());
});

chrome.runtime.onStartup.addListener(() => {
  scheduleReleaseChecks();
  restoreOrClearOtaScript().then(() => checkForUpdate());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RELEASE_CHECK_ALARM) checkForUpdate();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_UPDATE_STATUS") {
    chrome.storage.local.get(["githubUpdate", "otaContentScript"], ({ githubUpdate, otaContentScript }) => {
      const manifestVersion = chrome.runtime.getManifest().version;
      const activeVersion = getHigherVersion(manifestVersion, otaContentScript?.version);
      const maxAge = CHECK_PERIOD_MINUTES * 60_000;
      const isStale =
        !githubUpdate?.checkedAt ||
        githubUpdate.manifestVersion !== manifestVersion ||
        Date.now() - githubUpdate.checkedAt > maxAge;
      if (isStale) {
        checkForUpdate().then(sendResponse);
      } else {
        sendResponse({ ...githubUpdate, activeVersion });
      }
    });
    return true;
  }

  if (message?.type === "CHECK_FOR_UPDATE") {
    checkForUpdate().then(sendResponse);
    return true;
  }

  if (message?.type === "APPLY_GITHUB_UPDATE") {
    applyGitHubUpdate().then(sendResponse);
    return true;
  }

  return false;
});

function scheduleReleaseChecks() {
  chrome.alarms.create(RELEASE_CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
}

function getHigherVersion(v1, v2) {
  return compareVersions(v1, v2) >= 0 ? normalizeVersion(v1) : normalizeVersion(v2);
}

async function getActiveVersion() {
  const manifestVersion = chrome.runtime.getManifest().version;
  const { otaContentScript } = await chrome.storage.local.get("otaContentScript");
  return getHigherVersion(manifestVersion, otaContentScript?.version);
}

async function clearOtaUserScripts() {
  await chrome.storage.local.remove("otaContentScript");
  if (!chrome.userScripts?.unregister) return;
  try {
    const existing = await chrome.userScripts.getScripts({ ids: OTA_SCRIPT_IDS });
    if (existing.length) {
      await chrome.userScripts.unregister({ ids: existing.map((s) => s.id) });
    }
  } catch {}
}

async function registerOtaUserScripts(code) {
  if (!chrome.userScripts?.register || !code) return false;
  try {
    const existing = await chrome.userScripts.getScripts({ ids: OTA_SCRIPT_IDS });
    if (existing.length) {
      await chrome.userScripts.unregister({ ids: existing.map((s) => s.id) });
    }
    await chrome.userScripts.register([
      {
        id: "vamber-ota-user",
        matches: ["http://*/*", "https://*/*"],
        js: [{ code: `window.__vamberUserScriptWorld = true;\n${code}` }],
        runAt: "document_idle",
        allFrames: true,
        world: "USER_SCRIPT"
      },
      {
        id: "vamber-ota-main",
        matches: ["http://*/*", "https://*/*"],
        js: [{ code }],
        runAt: "document_idle",
        allFrames: true,
        world: "MAIN"
      }
    ]);
    return true;
  } catch {
    return false;
  }
}

async function restoreOrClearOtaScript() {
  const manifestVersion = chrome.runtime.getManifest().version;
  const { otaContentScript } = await chrome.storage.local.get("otaContentScript");
  if (!otaContentScript?.version || compareVersions(otaContentScript.version, manifestVersion) <= 0) {
    await clearOtaUserScripts();
    return;
  }
  await registerOtaUserScripts(otaContentScript.code);
}

async function fetchAndStoreOtaScript(tag, latestVersion) {
  if (!tag) return false;
  try {
    const response = await fetch(RAW_CONTENT_URL(tag), { cache: "no-store" });
    if (!response.ok) return false;
    const code = await response.text();
    if (!code || !code.includes("__vamber_probe__")) return false;
    await chrome.storage.local.set({
      otaContentScript: { version: latestVersion, tag, code, syncedAt: Date.now() }
    });
    await registerOtaUserScripts(code);
    return true;
  } catch {
    return false;
  }
}

async function applyGitHubUpdate() {
  const status = await checkForUpdate();
  if (!status?.available || !status.tagName) {
    return { ...status, updatedNow: false };
  }
  const synced = await fetchAndStoreOtaScript(status.tagName, status.latestVersion);
  if (synced) {
    const updatedStatus = {
      ...status,
      available: false,
      otaSynced: true,
      updatedNow: true,
      activeVersion: status.latestVersion,
      checkedAt: Date.now()
    };
    await saveUpdateStatus(updatedStatus);
    return updatedStatus;
  }
  return { ...status, updatedNow: false };
}

async function checkForUpdate() {
  const manifestVersion = chrome.runtime.getManifest().version;
  const activeVersion = await getActiveVersion();
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });

    if (response.status === 404) {
      const result = {
        status: "none",
        available: false,
        manifestVersion,
        activeVersion,
        checkedAt: Date.now()
      };
      await saveUpdateStatus(result);
      return result;
    }
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const release = await response.json();
    const latestVersion = normalizeVersion(release.tag_name);
    const available = compareVersions(latestVersion, activeVersion) > 0;
    const zipAsset = Array.isArray(release.assets)
      ? release.assets.find((asset) => asset.name?.endsWith(".zip") && asset.browser_download_url) || release.assets[0]
      : null;
    const downloadUrl =
      zipAsset?.browser_download_url ||
      (release.tag_name
        ? `https://github.com/de4d0t/Vamber-ai/releases/download/${release.tag_name}/vamber-ai-${release.tag_name}.zip`
        : release.html_url);

    const result = {
      status: "checked",
      available,
      manifestVersion,
      activeVersion,
      latestVersion,
      tagName: release.tag_name || `v${latestVersion}`,
      releaseUrl: release.html_url,
      downloadUrl,
      releaseName: release.name || "",
      checkedAt: Date.now()
    };
    await saveUpdateStatus(result);
    return result;
  } catch (error) {
    const previous = await chrome.storage.local.get("githubUpdate");
    const cached = previous.githubUpdate;
    if (cached?.available && compareVersions(cached.latestVersion, activeVersion) > 0) {
      await updateBadge(cached);
      return { ...cached, activeVersion };
    }
    const result = {
      status: "error",
      available: false,
      manifestVersion,
      activeVersion,
      message: "Could not reach GitHub. Try again later.",
      checkedAt: Date.now()
    };
    await saveUpdateStatus(result);
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
