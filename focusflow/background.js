/**
 * FocusFlow - background.js
 * Service Worker (MV3 background).
 * Acts as a secure relay for API calls, keeping the api.js logic
 * out of the content script's sandboxed environment.
 * Receives messages from popup.js and delegates to api.js.
 */

// Import the API module (importScripts is the MV3 service worker pattern)
importScripts("api.js");

/**
 * Listens for messages from the extension popup.
 * Handles FETCH_SUMMARY by calling the Hugging Face API.
 *
 * Returning `true` from the listener keeps the message channel open
 * until sendResponse is called asynchronously.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // ── Popup-initiated summary ───────────────────────────────────────────────
    if (message.action === "FETCH_SUMMARY") {
        const { text, apiKey } = message;
        const run = async () => {
            try {
                const summary = await fetchSummary(text, apiKey);
                sendResponse({ success: true, summary });
            } catch (err) {
                console.error("[FocusFlow Background] fetchSummary error:", err.message);
                sendResponse({ success: false, error: err.message });
            }
        };
        run();
        return true;
    }

    // ── Widget-initiated summary (reads API key from storage automatically) ───
    if (message.action === "SUMMARIZE_FROM_WIDGET") {
        const { article } = message;
        const run = async () => {
            try {
                const stored = await chrome.storage.sync.get(["hfApiKey"]);
                const apiKey = stored.hfApiKey || "";
                const rawSummary = await fetchSummary(article.text, apiKey);
                sendResponse({ success: true, rawSummary });
            } catch (err) {
                console.error("[FocusFlow Background] SUMMARIZE_FROM_WIDGET error:", err.message);
                sendResponse({ success: false, error: err.message });
            }
        };
        run();
        return true;
    }

    return false;
});

