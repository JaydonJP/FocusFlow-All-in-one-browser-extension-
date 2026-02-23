/**
 * FocusFlow - background.js
 * Service Worker (MV3 background).
 * Acts as a secure relay for API calls, keeping the api.js logic
 * out of the content script's sandboxed environment.
 * Handles: FETCH_SUMMARY, SUMMARIZE_FROM_WIDGET, TOGGLE_AD_BLOCK, GET_AD_BLOCK_STATUS
 */

// Import the API module (importScripts is the MV3 service worker pattern)
importScripts("api.js");

const AD_BLOCK_RULESET_ID = "ad_blocking";

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

    // ── Widget / inline card summary ─────────────────────────────────────────
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

    // ── Ad-block toggle ───────────────────────────────────────────────────────
    if (message.action === "TOGGLE_AD_BLOCK") {
        const { enable } = message;
        const run = async () => {
            try {
                if (enable) {
                    await chrome.declarativeNetRequest.updateEnabledRulesets({
                        enableRulesetIds: [AD_BLOCK_RULESET_ID]
                    });
                } else {
                    await chrome.declarativeNetRequest.updateEnabledRulesets({
                        disableRulesetIds: [AD_BLOCK_RULESET_ID]
                    });
                }
                await chrome.storage.sync.set({ ffAdBlockEnabled: enable });
                console.log(`[FocusFlow Background] Ad block ${enable ? "ON" : "OFF"}`);
                sendResponse({ success: true, enabled: enable });
            } catch (err) {
                console.error("[FocusFlow Background] TOGGLE_AD_BLOCK error:", err.message);
                sendResponse({ success: false, error: err.message });
            }
        };
        run();
        return true;
    }

    // ── Query ad-block state ──────────────────────────────────────────────────
    if (message.action === "GET_AD_BLOCK_STATUS") {
        const run = async () => {
            try {
                const stored = await chrome.storage.sync.get(["ffAdBlockEnabled"]);
                sendResponse({ enabled: !!stored.ffAdBlockEnabled });
            } catch (err) {
                sendResponse({ enabled: false });
            }
        };
        run();
        return true;
    }

    return false;
});

