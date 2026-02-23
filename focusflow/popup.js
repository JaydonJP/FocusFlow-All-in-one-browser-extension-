/**
 * FocusFlow - popup.js
 * Controls the popup UI state machine.
 * Communicates with content.js via chrome.tabs.sendMessage
 * and reads the API key from chrome.storage.sync.
 */

// ── DOM References ────────────────────────────────────────────
const mainBtn = document.getElementById("mainBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const wordChip = document.getElementById("wordChip");
const messageBox = document.getElementById("messageBox");
const messageIcon = document.getElementById("messageIcon");
const messageTextEl = document.getElementById("messageText");
const optionsBtn = document.getElementById("optionsBtn");
const openOptionsLink = document.getElementById("openOptionsLink");
const profileChips = document.querySelectorAll(".profile-chip");

/** @type {{ adBlockEnabled: boolean }} */
let state = {
    adBlockEnabled: false
};

/**
 * Live-tracked state for each accessibility profile.
 * @type {{ adhd: boolean, dyslexia: boolean, elderly: boolean, autism: boolean }}
 */
let profileState = { adhd: false, dyslexia: false, elderly: false, autism: false };

// ── UI Helpers ────────────────────────────────────────────────

/**
 * Updates the status indicator bar.
 * @param {boolean} active - Whether focus mode is on.
 * @param {string} [words] - Optional word count string.
 */
const setStatus = (enabled) => {
    if (enabled) {
        statusDot.classList.add("active");
        statusText.classList.add("active");
        statusText.textContent = "Ad Block is ON";
    } else {
        statusDot.classList.remove("active");
        statusText.classList.remove("active");
        statusText.textContent = "Ad Block is off";
    }
};

const setBtnEnable = () => {
    mainBtn.className = "btn-primary";
    mainBtn.querySelector(".btn-label").textContent = "🛡 Block Ads";
    mainBtn.disabled = false;
};

const setBtnDisable = () => {
    mainBtn.className = "btn-primary off-state";
    mainBtn.querySelector(".btn-label").textContent = "✕ Disable Ad Block";
    mainBtn.disabled = false;
};

const setBtnLoading = (label = "Applying…") => {
    mainBtn.className = "btn-primary loading";
    mainBtn.querySelector(".btn-label").textContent = label;
    mainBtn.disabled = true;
};

/**
 * Displays a feedback message in the message area.
 * @param {"error"|"success"|"info"} type - Visual variant.
 * @param {string} icon - Emoji icon.
 * @param {string} text - Message body.
 */
const showMessage = (type, icon, text) => {
    messageBox.className = `message ${type} visible`;
    messageIcon.textContent = icon;
    messageTextEl.textContent = text;
};

/** Hides the feedback message area. */
const clearMessage = () => {
    messageBox.className = "message";
};

// ── Tab Helper ────────────────────────────────────────────────

/**
 * Returns the active tab in the current window.
 * @returns {Promise<chrome.tabs.Tab>}
 */
const getActiveTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
};

/**
 * Sends a message to the content script of the given tab.
 * @param {number} tabId - The target tab's ID.
 * @param {object} message - The message object.
 * @returns {Promise<any>} Response from content.js.
 */
const sendToContent = (tabId, message) => {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
};

// ── Storage Helpers ───────────────────────────────────────────

/**
 * Retrieves the stored Hugging Face API key from chrome.storage.sync.
 * @returns {Promise<string|null>} The API key or null.
 */
const getApiKey = () => {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["hfApiKey"], (result) => {
            resolve(result.hfApiKey || null);
        });
    });
};

// ── Core Flow ─────────────────────────────────────────────────

/**
 * Enables ad blocking via the background service worker.
 */
const handleAdBlockOn = async () => {
    clearMessage();
    setBtnLoading("Enabling Ad Block…");
    try {
        const result = await chrome.runtime.sendMessage({ action: "TOGGLE_AD_BLOCK", enable: true });
        if (result?.success) {
            state.adBlockEnabled = true;
            setStatus(true);
            setBtnDisable();
            showMessage("success", "🛡", "Ad Block is ON! Reloading page…");
            const tab = await getActiveTab();
            setTimeout(() => chrome.tabs.reload(tab.id), 800);
        } else {
            showMessage("error", "❌", result?.error || "Could not enable ad blocking.");
            setBtnEnable();
        }
    } catch (err) {
        showMessage("error", "❌", `Error: ${err.message}`);
        setBtnEnable();
    }
};

/**
 * Disables ad blocking via the background service worker.
 */
const handleAdBlockOff = async () => {
    clearMessage();
    setBtnLoading("Disabling Ad Block…");
    try {
        const result = await chrome.runtime.sendMessage({ action: "TOGGLE_AD_BLOCK", enable: false });
        if (result?.success) {
            state.adBlockEnabled = false;
            setStatus(false);
            setBtnEnable();
            showMessage("info", "↩️", "Ad Block off. Reloading page…");
            const tab = await getActiveTab();
            setTimeout(() => chrome.tabs.reload(tab.id), 800);
        } else {
            showMessage("error", "❌", result?.error || "Could not disable ad blocking.");
            setBtnDisable();
        }
    } catch (err) {
        showMessage("error", "❌", `Error: ${err.message}`);
        setBtnDisable();
    }
};

// ── Initialization ────────────────────────────────────────────

/**
 * Syncs the chip UI to match a profile state object.
 * @param {{ adhd: boolean, dyslexia: boolean, elderly: boolean, autism: boolean }} profiles
 */
const syncChipUI = (profiles) => {
    profileChips.forEach((chip) => {
        const key = chip.dataset.profile;
        const isOn = !!profiles[key];
        chip.classList.toggle("active", isOn);
        chip.setAttribute("aria-pressed", String(isOn));
    });
};

/**
 * Loads saved profile state from chrome.storage.sync and syncs the chip UI.
 * @param {number} tabId - Active tab ID to query current DOM state from,
 *   used as a fallback if storage is empty.
 */
const loadProfiles = async (tabId) => {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["ffProfiles"], async (result) => {
            if (result.ffProfiles) {
                profileState = result.ffProfiles;
            } else {
                // Fallback: read from live DOM (already applied by content.js init)
                try {
                    const res = await sendToContent(tabId, { action: "GET_PROFILES" });
                    if (res?.profiles) profileState = res.profiles;
                } catch { /* page may not have content script */ }
            }
            syncChipUI(profileState);
            resolve();
        });
    });
};

/**
 * Handles a profile chip toggle: flips the named profile, sends the
 * full updated state to content.js, and persists to storage.
 * @param {string} profileKey - One of: adhd | dyslexia | elderly | autism
 * @param {number} tabId - Active tab ID.
 */
const handleProfileToggle = async (profileKey, tabId) => {
    // Flip the targeted profile key
    profileState[profileKey] = !profileState[profileKey];
    syncChipUI(profileState);

    try {
        await sendToContent(tabId, { action: "SET_PROFILES", profiles: { ...profileState } });
    } catch (err) {
        // Page may be restricted (e.g. chrome:// pages) — show brief warning
        showMessage("error", "⚠️", "Cannot apply profile on this page. Try a regular website.");
        // Revert the toggle
        profileState[profileKey] = !profileState[profileKey];
        syncChipUI(profileState);
    }
};

/**
 * Initializes the popup: checks current tab's focus mode status
 * and loads saved accessibility profiles.
 */
const initPopup = async () => {
    try {
        const tab = await getActiveTab();

        // Check ad-block state
        const adStatus = await chrome.runtime.sendMessage({ action: "GET_AD_BLOCK_STATUS" });
        if (adStatus?.enabled) {
            state.adBlockEnabled = true;
            setStatus(true);
            setBtnDisable();
        } else {
            setBtnEnable();
        }

        // Load and render saved accessibility profiles
        await loadProfiles(tab.id);

    } catch {
        setBtnEnable();
        showMessage("info", "ℹ️", "Navigate to a web page and click Block Ads to enable.");
    }
};

// ── Event Listeners ───────────────────────────────────────────
mainBtn.addEventListener("click", () => {
    if (state.adBlockEnabled) {
        handleAdBlockOff();
    } else {
        handleAdBlockOn();
    }
});

optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

openOptionsLink.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

/**
 * Wire up each accessibility profile chip to its toggle handler.
 * Chips are queried once at startup to avoid repeated DOM lookups.
 */
profileChips.forEach((chip) => {
    chip.addEventListener("click", async () => {
        const tab = await getActiveTab();
        await handleProfileToggle(chip.dataset.profile, tab.id);
    });
});

// Boot
initPopup();

