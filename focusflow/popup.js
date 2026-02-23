// ── DOM References ────────────────────────────────────────────
const mainBtn = document.getElementById("mainBtn");
const summarizeBtn = document.getElementById("summarizeBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const wordChip = document.getElementById("wordChip");
const messageBox = document.getElementById("messageBox");
const messageIcon = document.getElementById("messageIcon");
const messageTextEl = document.getElementById("messageText");
const optionsBtn = document.getElementById("optionsBtn");
const openOptionsLink = document.getElementById("openOptionsLink");
const profileChips = document.querySelectorAll(".profile-chip");
const adBlockToggle = document.getElementById("adBlockToggle");

/** @type {{ isActive: boolean, adBlockEnabled: boolean }} */
let state = {
    isActive: false,
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
    } else {
        wordChip.classList.remove("visible");
    }
};

/**
 * Sets the main button to the "activate" state.
 */
const setBtnActivate = () => {
    mainBtn.className = "btn-primary";
    mainBtn.querySelector(".btn-label").textContent = "✨ Simplify";
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
const setBtnLoading = (label = "Applying…") => {
    mainBtn.className = "btn-primary loading";
    mainBtn.querySelector(".btn-label").textContent = label;
    mainBtn.disabled = true;
};

/**
 * Sets the summarize button into a loading state.
 */
const setSummarizeBtnLoading = (loading, label = "🪷 Summarize Page") => {
    if (loading) {
        summarizeBtn.className = "btn-secondary loading";
        summarizeBtn.disabled = true;
    } else {
        summarizeBtn.className = "btn-secondary";
        summarizeBtn.querySelector(".btn-label").textContent = label;
        summarizeBtn.disabled = false;
    }
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
 * "Find Your Flow" — applies ONLY the CSS focus-mode overlay.
 * Does NOT call the AI.
 */
const handleActivate = async () => {
    clearMessage();
    setBtnLoading("Applying Focus Mode…");

    try {
        const tab = await getActiveTab();

        // Enable CSS Focus Mode on the page
        let result;
        try {
            result = await sendToContent(tab.id, { action: "ENABLE_FOCUS_MODE" });
        } catch {
            showMessage("error", "⚠️", "Cannot connect to page. Try reloading the tab and opening FocusFlow again.");
            setBtnActivate();
            return;
        }

        state.isActive = true;
        setStatus(true);
        setBtnDeactivate();
        showMessage("success", "✅", "Focus Mode is active. Hit 'Summarize with AI' to get an AI summary.");

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

/**
 * "Summarize with AI" — extracts page content and calls Qwen via the background worker.
 * Can run independently of Focus Mode being on/off.
 */
const handleSummarize = async () => {
    clearMessage();
    setSummarizeBtnLoading(true);
    mainBtn.disabled = true;

    try {
        const tab = await getActiveTab();

        // Step 1: Get API Key
        const apiKey = await getApiKey();
        if (!apiKey) {
            showMessage("error", "🔑", "No API key set. Click 'Set API Key' below to add your Hugging Face key.");
            setSummarizeBtnLoading(false);
            mainBtn.disabled = false;
            return;
        }

        // Step 2: Extract article content from the page
        showMessage("info", "📄", "Extracting article content from this page…");
        let extractResult;
        try {
            extractResult = await sendToContent(tab.id, { action: "EXTRACT_CONTENT" });
        } catch {
            showMessage("error", "⚠️", "Cannot connect to page. Try reloading the tab and opening FocusFlow again.");
            setSummarizeBtnLoading(false);
            mainBtn.disabled = false;
            return;
        }

        if (!extractResult.success) {
            showMessage("error", "📄", extractResult.error);
            setSummarizeBtnLoading(false);
            mainBtn.disabled = false;
            return;
        }

        const { article, wordCount } = extractResult;
        const wordLabel = `${wordCount.toLocaleString()} words`;

        // Step 3: Fetch AI summary via background service worker
        showMessage("info", "🤖", `Sending ${wordLabel} to AI for summarization — this may take a moment…`);

        let summaryResult;
        try {
            summaryResult = await chrome.runtime.sendMessage({
                action: "FETCH_SUMMARY",
                text: article.text,
                apiKey
            });
        } catch (err) {
            showMessage("error", "🌐", `API communication failed: ${err.message}`);
            setSummarizeBtnLoading(false);
            mainBtn.disabled = false;
            return;
        }

        if (!summaryResult.success) {
            showMessage("error", "❌", summaryResult.error);
            setSummarizeBtnLoading(false);
            mainBtn.disabled = false;
            return;
        }

        // Step 4: Inject the summary banner and enable Focus Mode (if not already on)
        await sendToContent(tab.id, {
            action: "INJECT_SUMMARY",
            title: article.title,
            rawSummary: summaryResult.summary
        });

        // If focus mode wasn't on, turn it on now so the page is in reading mode
        if (!state.isActive) {
            await sendToContent(tab.id, { action: "ENABLE_FOCUS_MODE" });
            state.isActive = true;
            setStatus(true, wordLabel);
            setBtnDeactivate();
        } else {
            setStatus(true, wordLabel);
        }

        setSummarizeBtnLoading(false, "🔄 Re-Summarize");
        mainBtn.disabled = false;
        showMessage("success", "✅", `Done! Summary ready above — ${wordLabel} processed.`);

    } catch (err) {
        console.error("[FocusFlow Popup]", err);
        showMessage("error", "❌", `Unexpected error: ${err.message}`);
        setSummarizeBtnLoading(false);
        mainBtn.disabled = false;
    }
};

/**
 * Toggles ad blocking via the background service worker.
 */
const handleAdBlockToggle = async (enable) => {
    try {
        const result = await chrome.runtime.sendMessage({ action: "TOGGLE_AD_BLOCK", enable });
        if (result?.success) {
            state.adBlockEnabled = enable;
            showMessage("success", "🛡", `Ad Block is ${enable ? "ON" : "OFF"}! Reloading page…`);
            const tab = await getActiveTab();
            setTimeout(() => chrome.tabs.reload(tab.id), 800);
        } else {
            showMessage("error", "❌", result?.error || "Could not toggle ad blocking.");
            adBlockToggle.checked = !enable;
        }
    } catch (err) {
        showMessage("error", "❌", `Error: ${err.message}`);
        adBlockToggle.checked = !enable;
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
 * @param {number} tabId - Active tab ID to query current DOM state from.
 */
const loadProfiles = async (tabId) => {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["ffProfiles"], async (result) => {
            if (result.ffProfiles) {
                profileState = result.ffProfiles;
            } else {
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
 * Handles a profile chip toggle.
 * @param {string} profileKey - One of: adhd | dyslexia | elderly | autism
 * @param {number} tabId - Active tab ID.
 */
const handleProfileToggle = async (profileKey, tabId) => {
    profileState[profileKey] = !profileState[profileKey];
    syncChipUI(profileState);

    try {
        await sendToContent(tabId, { action: "SET_PROFILES", profiles: { ...profileState } });
        chrome.storage.sync.set({ ffProfiles: profileState });
    } catch (err) {
        showMessage("error", "⚠️", "Cannot apply profile on this page. Try a regular website.");
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

        // Check Focus Mode state
        const response = await sendToContent(tab.id, { action: "CHECK_STATUS" });
        if (response?.isActive) {
            state.isActive = true;
            setStatus(true);
            setBtnDeactivate();
        } else {
            setBtnActivate();
        }

        // Check Ad Block state
        const adStatus = await chrome.runtime.sendMessage({ action: "GET_AD_BLOCK_STATUS" });
        state.adBlockEnabled = !!adStatus?.enabled;
        if (adBlockToggle) adBlockToggle.checked = state.adBlockEnabled;

        // Load and render saved accessibility profiles
        await loadProfiles(tab.id);

    } catch {
        // Content script may not be injected yet
        setBtnActivate();
        showMessage("info", "ℹ️", "Navigate to a web article and click 'Simplify'.");
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

summarizeBtn.addEventListener("click", () => {
    handleSummarize();
});

adBlockToggle.addEventListener("change", (e) => {
    handleAdBlockToggle(e.target.checked);
});

optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

openOptionsLink.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

profileChips.forEach((chip) => {
    chip.addEventListener("click", async () => {
        const tab = await getActiveTab();
        await handleProfileToggle(chip.dataset.profile, tab.id);
    });
});

// Boot
initPopup();
