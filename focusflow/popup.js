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

/** @type {{ isActive: boolean, summary: string | null, title: string | null }} */
let state = {
    isActive: false,
    summary: null,
    title: null
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
const setStatus = (active, words = null) => {
    if (active) {
        statusDot.classList.add("active");
        statusText.classList.add("active");
        statusText.textContent = "Focus Mode is ON";
    } else {
        statusDot.classList.remove("active");
        statusText.classList.remove("active");
        statusText.textContent = "Focus Mode is off";
    }

    if (words) {
        wordChip.textContent = words;
        wordChip.classList.add("visible");
    }
};

/**
 * Sets the main button to the "activate" state.
 */
const setBtnActivate = () => {
    mainBtn.className = "btn-primary";
    mainBtn.querySelector(".btn-label").textContent = "⚡ Simplify This Page";
    mainBtn.disabled = false;
};

/**
 * Sets the main button to the "deactivate" state.
 */
const setBtnDeactivate = () => {
    mainBtn.className = "btn-primary off-state";
    mainBtn.querySelector(".btn-label").textContent = "✕ Turn Off Focus Mode";
    mainBtn.disabled = false;
};

/**
 * Sets the main button into a loading/disabled state.
 * @param {string} [label] - Optional label text (hidden while loading).
 */
const setBtnLoading = (label = "Simplifying…") => {
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
 * Orchestrates the full "Simplify" flow:
 * 1. Extract content via content.js
 * 2. Call the Hugging Face API via background.js
 * 3. Inject summary into the page via content.js
 */
const handleActivate = async () => {
    clearMessage();
    setBtnLoading("Extracting content…");

    try {
        const tab = await getActiveTab();

        // Step 1: Get API Key
        const apiKey = await getApiKey();
        if (!apiKey) {
            showMessage("error", "🔑", "No API key set. Click 'Set API Key' below to add your Hugging Face key.");
            setBtnActivate();
            return;
        }

        // Step 2: Extract article content from page
        let extractResult;
        try {
            extractResult = await sendToContent(tab.id, { action: "EXTRACT_CONTENT" });
        } catch {
            showMessage("error", "⚠️", "Cannot connect to page. Try reloading the tab and opening FocusFlow again.");
            setBtnActivate();
            return;
        }

        if (!extractResult.success) {
            showMessage("error", "📄", extractResult.error);
            setBtnActivate();
            return;
        }

        const { article, wordCount } = extractResult;
        const wordLabel = `${wordCount.toLocaleString()} words`;

        // Step 3: Fetch AI summary via background service worker
        setBtnLoading("AI is summarizing…");
        showMessage("info", "🤖", `Sending ${wordLabel} to Qwen AI for summarization…`);

        let summaryResult;
        try {
            summaryResult = await chrome.runtime.sendMessage({
                action: "FETCH_SUMMARY",
                text: article.text,
                apiKey
            });
        } catch (err) {
            showMessage("error", "🌐", `API communication failed: ${err.message}`);
            setBtnActivate();
            return;
        }

        if (!summaryResult.success) {
            showMessage("error", "❌", summaryResult.error);
            setBtnActivate();
            return;
        }

        // Step 4: Inject summary banner into page
        await sendToContent(tab.id, {
            action: "INJECT_SUMMARY",
            title: article.title,
            rawSummary: summaryResult.summary
        });

        // Update state
        state.isActive = true;
        state.summary = summaryResult.summary;
        state.title = article.title;

        setStatus(true, wordLabel);
        setBtnDeactivate();
        clearMessage();
        showMessage("success", "✅", "Page simplified! Scroll down to read the AI summary.");

    } catch (err) {
        console.error("[FocusFlow Popup]", err);
        showMessage("error", "❌", `Unexpected error: ${err.message}`);
        setBtnActivate();
    }
};

/**
 * Turns off Focus Mode on the current tab.
 */
const handleDeactivate = async () => {
    clearMessage();
    setBtnLoading("Restoring page…");

    try {
        const tab = await getActiveTab();
        await sendToContent(tab.id, { action: "DISABLE_FOCUS_MODE" });

        state.isActive = false;
        setStatus(false);
        setBtnActivate();
        showMessage("info", "↩️", "Focus Mode turned off. Original layout restored.");
    } catch (err) {
        showMessage("error", "❌", `Could not disable Focus Mode: ${err.message}`);
        setBtnDeactivate();
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

        // Check focus mode state
        const response = await sendToContent(tab.id, { action: "CHECK_STATUS" });
        if (response?.isActive) {
            state.isActive = true;
            setStatus(true);
            setBtnDeactivate();
        } else {
            setBtnActivate();
        }

        // Load and render saved accessibility profiles
        await loadProfiles(tab.id);

    } catch {
        // Content script may not be injected yet (e.g. chrome:// pages)
        setBtnActivate();
        showMessage("info", "ℹ️", "Navigate to a web article and click Simplify.");
    }
};

// ── Event Listeners ───────────────────────────────────────────
mainBtn.addEventListener("click", () => {
    if (state.isActive) {
        handleDeactivate();
    } else {
        handleActivate();
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

