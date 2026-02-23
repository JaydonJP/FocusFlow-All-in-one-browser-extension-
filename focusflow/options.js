/**
 * FocusFlow - options.js
 * Handles the options page: loading, saving, and toggling
 * the Hugging Face API key via chrome.storage.sync.
 */

const apiKeyInput = document.getElementById("apiKeyInput");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");
const toggleVis = document.getElementById("toggleVis");

/** @type {ReturnType<typeof setTimeout> | null} */
let statusTimer = null;

/**
 * Loads the saved API key from chrome.storage.sync and populates the input.
 */
const loadSavedKey = () => {
    chrome.storage.sync.get(["hfApiKey"], (result) => {
        if (result.hfApiKey) {
            apiKeyInput.value = result.hfApiKey;
        }
    });
};

/**
 * Shows a temporary status message below the save button.
 * @param {"success"|"error"} type - Visual variant.
 * @param {string} text - Message to display.
 */
const showStatus = (type, text) => {
    saveStatus.textContent = text;
    saveStatus.className = `save-status ${type}`;

    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        saveStatus.textContent = "";
        saveStatus.className = "save-status";
    }, 3000);
};

/**
 * Validates that the given string looks like a Hugging Face API key.
 * @param {string} key - The key string to validate.
 * @returns {boolean} True if the format looks valid.
 */
const isValidHfKey = (key) => {
    return typeof key === "string" && key.trim().startsWith("hf_") && key.trim().length > 10;
};

/**
 * Saves the API key from the input field to chrome.storage.sync.
 */
const handleSave = () => {
    const key = apiKeyInput.value.trim();

    if (!key) {
        showStatus("error", "⚠️ Please enter an API key.");
        return;
    }

    if (!isValidHfKey(key)) {
        showStatus("error", "⚠️ Key should start with \"hf_\". Check your Hugging Face token.");
        return;
    }

    chrome.storage.sync.set({ hfApiKey: key }, () => {
        if (chrome.runtime.lastError) {
            showStatus("error", `❌ Save failed: ${chrome.runtime.lastError.message}`);
        } else {
            showStatus("success", "✅ API key saved securely.");
        }
    });
};

/**
 * Toggles the API key input between password and plain-text visibility.
 */
const handleToggleVisibility = () => {
    const isHidden = apiKeyInput.type === "password";
    apiKeyInput.type = isHidden ? "text" : "password";
    toggleVis.textContent = isHidden ? "🙈" : "👁";
    toggleVis.setAttribute("aria-label", isHidden ? "Hide key" : "Show key");
};

// ── Event Listeners ───────────────────────────────────────────
saveBtn.addEventListener("click", handleSave);
toggleVis.addEventListener("click", handleToggleVisibility);

// Allow pressing Enter in the input to save
apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSave();
});

// ── Init ──────────────────────────────────────────────────────
loadSavedKey();
