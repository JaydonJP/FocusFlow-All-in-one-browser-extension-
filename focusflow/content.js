/**
 * FocusFlow - content.js
 * Main content script. Handles Readability-based article extraction,
 * CSS overlay injection, and AI summary rendering on the active page.
 * Runs in the context of the web page, not the extension popup.
 */

/** Sentinel class added to <html> when Focus Mode is active. */
const FOCUS_MODE_CLASS = "focusflow-active";

/** ID of the injected summary banner element. */
const SUMMARY_BANNER_ID = "focusflow-summary-banner";

/** Map of profile keys → <html> CSS classes. */
const PROFILE_CLASSES = {
    adhd: "ff-adhd",
    dyslexia: "ff-dyslexia",
    elderly: "ff-elderly",
    autism: "ff-autism"
};

// ── RAG State ──────────────────────────────────────────────────
/** @type {string[]} Holds text chunks of the current article */
let ffChunks = [];

/** Hostnames known to be non-article pages that Readability can't parse usefully. */
const NON_ARTICLE_HOSTS = [
    "google.com", "google.co.in", "bing.com", "duckduckgo.com", "yahoo.com",  // search engines
    "youtube.com", "youtu.be", "vimeo.com",                                     // video
    "twitter.com", "x.com", "instagram.com", "facebook.com", "reddit.com",     // social
    "mail.google.com", "outlook.live.com", "outlook.office.com",               // webmail
    "docs.google.com", "sheets.google.com", "slides.google.com",               // google apps
    "web.whatsapp.com", "web.telegram.org"                                      // chat apps
];

/**
 * Uses Mozilla's Readability to extract the main article content
 * from the current document.
 * @returns {{ title: string, text: string } | { error: string }} Parsed article data or an error object.
 */
const extractArticleContent = () => {
    // Pre-flight: reject pages known not to be articles
    const hostname = location.hostname.replace(/^www\./, "");
    if (NON_ARTICLE_HOSTS.some(h => hostname === h || hostname.endsWith("." + h))) {
        return { error: `FocusFlow works on articles and blog posts — not on ${hostname}. Try it on a news article, Wikipedia page, or documentation site.` };
    }

    try {
        // Readability mutates the document clone, never the live DOM
        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone);
        const article = reader.parse();

        if (!article || !article.textContent || article.textContent.trim().length < 200) {
            return { error: "This page doesn't appear to contain a readable article. FocusFlow works best on news articles, blog posts, Wikipedia, and documentation pages." };
        }

        return {
            title: article.title || document.title || "Untitled Article",
            text: article.textContent.trim()
        };
    } catch (err) {
        console.error("[FocusFlow] Readability extraction failed:", err);
        return { error: "Content extraction failed unexpectedly. Please try reloading the page." };
    }
};

/**
 * Counts the number of words in a string.
 * @param {string} text - Input text.
 * @returns {number} Word count.
 */
const countWords = (text) => text.trim().split(/\s+/).length;

// ─── RAG Utilities ──────────────────────────────────────────────────────────

/**
 * Splits text into chunks of roughly ~250 words, respecting sentence boundaries.
 * @param {string} text 
 * @param {number} targetWords 
 * @returns {string[]}
 */
const chunkText = (text, targetWords = 250) => {
    // Split by sentence endings (. ! ?)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [];
    let currentChunk = "";

    for (const sentence of sentences) {
        const sentenceWords = countWords(sentence);
        const currentWords = countWords(currentChunk);

        if (currentWords + sentenceWords > targetWords && currentChunk !== "") {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += " " + sentence;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
};

// Removed local cosineSimilarity in favor of HF remote API

/**
 * Creates and injects the summary banner element above the article.
 * @param {string} title - The article title.
 * @param {string} summaryMarkup - HTML string of bullet points.
 */
const injectSummaryBanner = (title, summaryMarkup) => {
    // Avoid duplicate banners
    if (document.getElementById(SUMMARY_BANNER_ID)) return;

    const banner = document.createElement("div");
    banner.id = SUMMARY_BANNER_ID;
    banner.setAttribute("role", "complementary");
    banner.setAttribute("aria-label", "FocusFlow AI Summary");
    banner.innerHTML = `
    <div class="ff-banner-inner">
      <div class="ff-banner-header">
        <span class="ff-logo">⚡ FocusFlow</span>
        <span class="ff-badge">AI Summary</span>
      </div>
      <h2 class="ff-article-title">${escapeHtml(title)}</h2>
      <div class="ff-bullets">${summaryMarkup}</div>
      <p class="ff-caption">Generated by Qwen-Coder · Content simplified for focus</p>
    </div>
  `;

    // Insert before the first meaningful content block
    const insertTarget = document.body.querySelector(
        "article, main, [role='main'], .content, .post, .entry, h1"
    ) || document.body.firstElementChild;

    if (insertTarget && insertTarget.parentNode) {
        insertTarget.parentNode.insertBefore(banner, insertTarget);
    } else {
        document.body.prepend(banner);
    }
};

/**
 * Converts the AI's structured markdown output (## headings + • bullets)
 * into safe, sectioned HTML.
 * Each ## heading becomes an <h3>, and its following bullets become a <ul>.
 * Falls back to a flat <ul> for any lines that don't match a heading or bullet.
 * @param {string} rawText - AI-generated structured text.
 * @returns {string} Safe HTML string with section headers and bullet lists.
 */
const parseBulletsToHtml = (rawText) => {
    const lines = rawText
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const sections = [];   // { heading: string|null, bullets: string[] }
    let current = null;

    for (const line of lines) {
        // Detect ## Section Header
        if (line.startsWith("## ")) {
            // Save previous section
            if (current) sections.push(current);
            current = { heading: line.replace(/^##\s*/, "").trim(), bullets: [] };
            continue;
        }

        // Detect bullet lines (•, -, *, or "1. ")
        const isBullet = /^[•\-\*]/.test(line) || /^\d+\.\s/.test(line);
        const cleaned = line
            .replace(/^[•\-\*\s]+/, "")
            .replace(/^\d+\.\s*/, "")
            .trim();

        if (!cleaned) continue;

        if (!current) {
            // Bullets before any heading — create implicit section
            current = { heading: null, bullets: [] };
        }
        if (isBullet || !line.startsWith("##")) {
            current.bullets.push(cleaned);
        }
    }
    if (current) sections.push(current);

    // If the AI produced no structured sections at all, fall back to a flat list
    if (sections.length === 0) {
        return "<ul class=\"ff-bullet-list\"><li>No summary available.</li></ul>";
    }

    return sections.map(({ heading, bullets }) => {
        const headingHtml = heading
            ? `<h3 class="ff-section-heading">${escapeHtml(heading)}</h3>`
            : "";
        const bulletsHtml = bullets.length
            ? `<ul class="ff-bullet-list">${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
            : "";
        return `<div class="ff-section">${headingHtml}${bulletsHtml}</div>`;
    }).join("");
};

/**
 * Escapes HTML entities to prevent XSS when injecting user/AI content.
 * @param {string} str - Raw string.
 * @returns {string} HTML-safe string.
 */
const escapeHtml = (str) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(str).replace(/[&<>"']/g, m => map[m]);
};

/**
 * Removes the injected summary banner from the DOM.
 */
const removeSummaryBanner = () => {
    const banner = document.getElementById(SUMMARY_BANNER_ID);
    if (banner) banner.remove();
};

/**
 * Activates Focus Mode: applies the CSS overlay class to <html>.
 * Also automatically pops up the chatbot on the right of the screen.
 */
const enableFocusMode = () => {
    document.documentElement.classList.add(FOCUS_MODE_CLASS);
    // Automatically open the chatbot when Focus Mode is turned on
    setTimeout(() => {
        openChatPanel();
    }, 800);
};

/**
 * Deactivates Focus Mode: removes the CSS overlay class from <html>.
 */
const disableFocusMode = () => {
    document.documentElement.classList.remove(FOCUS_MODE_CLASS);
};

/**
 * Checks whether Focus Mode is currently active on the page.
 * @returns {boolean}
 */
const isFocusModeActive = () => {
    return document.documentElement.classList.contains(FOCUS_MODE_CLASS);
};

// ─── Profile Helpers ─────────────────────────────────────────────────────────

// ── Bionic Reading (Dyslexia) ─────────────────────────────────────────────
// Bolds the first half of every word to help dyslexic readers anchor letters.

const BIONIC_MARKER = "data-ff-bionic-node";

/**
 * Wraps the first ~half of a word in a bold span for bionic reading.
 * @param {string} word
 * @returns {string} HTML string with bold prefix.
 */
const bionicWord = (word) => {
    if (word.length <= 1) return `<b class="ff-bionic">${word}</b>`;
    const boldLen = Math.ceil(word.length / 2);
    return `<b class="ff-bionic">${word.slice(0, boldLen)}</b>${word.slice(boldLen)}`;
};

/**
 * Applies bionic reading to all text nodes on the page.
 * Safe: operates only on text nodes, never on scripts/code/our own banner.
 */
const applyBionicReading = () => {
    if (document.documentElement.hasAttribute("data-ff-bionic")) return;
    document.documentElement.setAttribute("data-ff-bionic", "1");

    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "B", "STRONG", "INPUT", "TEXTAREA", "SELECT"]);

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                if (parent.closest(`#${SUMMARY_BANNER_ID}, #ff-tts-bar, [${BIONIC_MARKER}]`)) return NodeFilter.FILTER_REJECT;
                if (node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(textNode => {
        const wrapper = document.createElement("span");
        wrapper.setAttribute(BIONIC_MARKER, "1");
        wrapper.innerHTML = textNode.textContent.replace(/(\w+)/g, (w) => bionicWord(w));
        textNode.parentNode.replaceChild(wrapper, textNode);
    });
};

/**
 * Removes bionic reading — restores all text nodes to plain text.
 */
const removeBionicReading = () => {
    document.documentElement.removeAttribute("data-ff-bionic");
    document.querySelectorAll(`[${BIONIC_MARKER}]`).forEach(span => {
        const textNode = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(textNode, span);
    });
};

// ── Text-to-Speech (Elderly) ──────────────────────────────────────────────
// Uses the browser's built-in SpeechSynthesis API. Clicking any paragraph
// or heading starts reading from that element.

const TTS_BAR_ID = "ff-tts-bar";
/** Weak reference to the last click target so we can remove listeners cleanly. */
const _ttsListeners = new Map();

/**
 * Speaks the text content of an element.
 * @param {HTMLElement} el
 */
const ttsSpeak = (el) => {
    speechSynthesis.cancel();
    const text = (el.innerText || el.textContent || "").trim();
    if (!text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.92;
    utter.pitch = 1.0;
    const label = document.getElementById("ff-tts-label");
    const pauseBtn = document.getElementById("ff-tts-pause");
    if (label) label.textContent = `🔊 Reading aloud…`;
    if (pauseBtn) pauseBtn.textContent = "⏸ Pause";
    utter.onend = () => { if (label) label.textContent = "🔊 Click any text to read it"; };
    speechSynthesis.speak(utter);
};

/**
 * Injects the floating TTS control bar at the bottom of the screen.
 */
const injectTTSBar = () => {
    if (document.getElementById(TTS_BAR_ID)) return;
    const bar = document.createElement("div");
    bar.id = TTS_BAR_ID;
    bar.setAttribute("aria-label", "FocusFlow Text-to-Speech controls");
    bar.innerHTML = `
        <span id="ff-tts-label">🔊 Click any text to read it aloud</span>
        <div id="ff-tts-btns">
            <button id="ff-tts-pause" title="Pause or resume reading">⏸ Pause</button>
            <button id="ff-tts-stop" title="Stop reading">⏹ Stop</button>
        </div>
    `;
    document.body.appendChild(bar);

    document.getElementById("ff-tts-pause").addEventListener("click", (e) => {
        e.stopPropagation();
        if (speechSynthesis.speaking && !speechSynthesis.paused) {
            speechSynthesis.pause();
            document.getElementById("ff-tts-pause").textContent = "▶ Resume";
        } else if (speechSynthesis.paused) {
            speechSynthesis.resume();
            document.getElementById("ff-tts-pause").textContent = "⏸ Pause";
        }
    });

    document.getElementById("ff-tts-stop").addEventListener("click", (e) => {
        e.stopPropagation();
        speechSynthesis.cancel();
        const label = document.getElementById("ff-tts-label");
        if (label) label.textContent = "🔊 Click any text to read it aloud";
        const pauseBtn = document.getElementById("ff-tts-pause");
        if (pauseBtn) pauseBtn.textContent = "⏸ Pause";
    });
};

/**
 * Adds click-to-read listeners to all readable elements on the page.
 */
const addTTSListeners = () => {
    document.querySelectorAll("p, h1, h2, h3, h4, li, blockquote, td").forEach(el => {
        if (el.closest(`#${TTS_BAR_ID}, #${SUMMARY_BANNER_ID}`)) return;
        if (_ttsListeners.has(el)) return;
        const handler = () => ttsSpeak(el);
        el.addEventListener("click", handler);
        el.setAttribute("data-ff-tts", "1");
        _ttsListeners.set(el, handler);
    });
};

/**
 * Removes all TTS listeners and the control bar.
 */
const removeTTS = () => {
    speechSynthesis.cancel();
    _ttsListeners.forEach((handler, el) => {
        el.removeEventListener("click", handler);
        el.removeAttribute("data-ff-tts");
    });
    _ttsListeners.clear();
    const bar = document.getElementById(TTS_BAR_ID);
    if (bar) bar.remove();
};

// ── Core Profile Application ──────────────────────────────────────────────

/**
 * Applies a set of accessibility profile classes to <html> and triggers
 * any JS-powered features (bionic reading, TTS) that go beyond CSS.
 * @param {{ adhd: boolean, dyslexia: boolean, elderly: boolean, autism: boolean }} profiles
 */
const applyProfiles = (profiles) => {
    Object.entries(PROFILE_CLASSES).forEach(([key, cls]) => {
        if (profiles[key]) {
            document.documentElement.classList.add(cls);
        } else {
            document.documentElement.classList.remove(cls);
        }
    });

    // Bionic reading — activated with dyslexia profile
    if (profiles.dyslexia) {
        // Small delay so DOM is settled
        setTimeout(applyBionicReading, 50);
    } else {
        removeBionicReading();
    }

    // Text-to-Speech — activated with elderly profile
    if (profiles.elderly) {
        setTimeout(() => { injectTTSBar(); addTTSListeners(); }, 50);
    } else {
        removeTTS();
    }
};

/**
 * Reads the active profile states from <html> class list.
 * @returns {{ adhd: boolean, dyslexia: boolean, elderly: boolean, autism: boolean }}
 */
const readActiveProfiles = () => {
    return Object.fromEntries(
        Object.entries(PROFILE_CLASSES).map(([key, cls]) => [
            key, document.documentElement.classList.contains(cls)
        ])
    );
};

// ─── Ad-Block Cosmetic Filtering ─────────────────────────────────────────────
// Collapses empty ad placeholder boxes left behind by declarativeNetRequest.
// Strategy: CSS handles known ad attributes/classes + src-based iframe selectors.
//           JS sweeps same-origin iframes that ended up blank after blocking.

/**
 * Stamps `ff-adblock-active` on <html> (triggers CSS rules) and sets up a
 * MutationObserver to collapse newly added empty iframes.
 */
const applyAdBlockCosmeticFiltering = () => {
    document.documentElement.classList.add("ff-adblock-active");

    /**
     * Collapse same-origin iframes whose body is empty (ad was blocked so
     * the iframe loaded but has no content).
     */
    const collapseEmptyIframes = () => {
        document.querySelectorAll("iframe").forEach((iframe) => {
            if (iframe.id && iframe.id.startsWith("ff-")) return; // skip our own
            try {
                const doc = iframe.contentDocument;
                if (doc && doc.body && doc.body.innerHTML.trim() === "") {
                    iframe.style.setProperty("display", "none", "important");
                    iframe.style.setProperty("height", "0", "important");
                    // Collapse wrapper only if it exists purely to hold the ad
                    const p = iframe.parentElement;
                    if (p && p.children.length === 1) {
                        p.style.setProperty("height", "0", "important");
                        p.style.setProperty("overflow", "hidden", "important");
                        p.style.setProperty("min-height", "0", "important");
                        p.style.setProperty("margin", "0", "important");
                        p.style.setProperty("padding", "0", "important");
                    }
                }
            } catch (_) {
                // Cross-origin iframes — handled by CSS src-attribute selectors
            }
        });
    };

    // Run once after page has settled
    setTimeout(collapseEmptyIframes, 2000);

    // Guard against double-registering on SPA navigations
    if (window._ffAdObserver) return;
    window._ffAdObserver = new MutationObserver((mutations) => {
        const hasNewIframe = mutations.some((m) =>
            [...m.addedNodes].some(
                (n) => n.nodeName === "IFRAME" ||
                    (n.querySelectorAll && n.querySelectorAll("iframe").length > 0)
            )
        );
        if (hasNewIframe) setTimeout(collapseEmptyIframes, 600);
    });
    window._ffAdObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // ── Popup blocker: patch window.open ─────────────────────────────────────
    // Block new-window/tab calls whose URL resolves to a known ad/tracker domain.
    // All other window.open calls (share dialogs, OAuth, video players, etc.) pass through.
    if (!window._ffOpenPatched) {
        window._ffOpenPatched = true;
        const _AD_POPUP_DOMAINS = [
            "doubleclick.net", "googlesyndication.com", "googleadservices.com",
            "adnxs.com", "amazon-adsystem.com", "taboola.com", "outbrain.com",
            "criteo.com", "criteo.net", "moatads.com", "rubiconproject.com",
            "pubmatic.com", "openx.net", "adsrvr.org", "thetradedesk.com",
            "adroll.com", "sharethrough.com", "media.net", "propellerads.com",
            "adsterra.com", "mgid.com", "exoclick.com", "adform.net",
            "zedo.com", "adblade.com", "revcontent.com", "triplelift.com",
            "advertising.com", "spotxchange.com", "smartadserver.com",
            "quantserve.com", "casalemedia.com", "conversantmedia.com",
            "tradedoubler.com", "clickbooth.com", "buysellads.com",
            "trafficjunky.net", "juicyads.com", "adtarget.me",
            "popcash.net", "popads.net", "hilltopads.net",
        ];
        const _origOpen = window.open.bind(window);
        window.open = function (url, target, features) {
            if (url) {
                try {
                    const hostname = new URL(url, location.href).hostname.toLowerCase();
                    if (_AD_POPUP_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d))) {
                        console.log("[FocusFlow] Popup blocked:", url);
                        return null;
                    }
                } catch (_) { /* malformed URL — let the browser handle it */ }
            }
            return _origOpen.call(this, url, target, features);
        };
    }
};


// ─── Auto-Apply on Page Load ──────────────────────────────────────────────────
// When a new page loads the content script re-runs, so we restore
// the user's saved profiles from storage immediately.

(() => {
    try {
        chrome.storage.sync.get(["ffProfiles", "ffAdBlockEnabled"], (result) => {
            if (result.ffProfiles) {
                applyProfiles(result.ffProfiles);
            }
            if (result.ffAdBlockEnabled) {
                applyAdBlockCosmeticFiltering();
            }
        });
    } catch (err) {
        // storage may be unavailable on restricted pages — fail silently
        console.warn("[FocusFlow] Could not restore profiles:", err.message);
    }
})();


// ─── Message Listener ────────────────────────────────────────────────────────
// Listens for commands from popup.js via chrome.runtime messaging.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { action } = message;

    if (action === "CHECK_STATUS") {
        sendResponse({ isActive: isFocusModeActive() });
        return true;
    }

    if (action === "EXTRACT_CONTENT") {
        const result = extractArticleContent();
        if (result.error) {
            sendResponse({ success: false, error: result.error });
        } else {
            const wordCount = countWords(result.text);
            sendResponse({ success: true, article: result, wordCount });
        }
        return true;
    }

    if (action === "INJECT_SUMMARY") {
        const { title, rawSummary } = message;
        try {
            const summaryHtml = parseBulletsToHtml(rawSummary);
            injectSummaryBanner(title, summaryHtml);
            enableFocusMode();
            sendResponse({ success: true });

            // ── RAG: Initialize Embeddings ──
            // Once the page is simplified, silently chunk the text and get embeddings
            // so chatting is instant later.
            setTimeout(() => {
                initializeRAG().catch(e => console.error(e));
                openChatPanel();
            }, 1000);

        } catch (err) {
            console.error("[FocusFlow] Summary injection failed:", err);
            sendResponse({ success: false, error: err.message });
        }
        return true;
    }

    if (action === "ENABLE_FOCUS_MODE") {
        enableFocusMode();
        sendResponse({ success: true });
        return true;
    }

    if (action === "DISABLE_FOCUS_MODE") {
        disableFocusMode();
        removeSummaryBanner();
        sendResponse({ success: true });
        return true;
    }

    if (action === "SET_PROFILES") {
        /**
         * Receives a profiles object from popup, applies CSS classes,
         * and persists the setting to chrome.storage.sync.
         */
        try {
            const { profiles } = message;
            applyProfiles(profiles);
            chrome.storage.sync.set({ ffProfiles: profiles });
            sendResponse({ success: true });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
        return true;
    }

    if (action === "GET_PROFILES") {
        /** Returns the currently active profile states from the DOM. */
        sendResponse({ profiles: readActiveProfiles() });
        return true;
    }

    if (action === "OPEN_CHAT") {
        openChatPanel();
        sendResponse({ success: true });
        return true;
    }

    if (action === "WIDGET_HIDE") {
        hideFloatingWidget();
        sendResponse({ success: true });
        return true;
    }

    if (action === "WIDGET_SHOW") {
        showFloatingWidget();
        sendResponse({ success: true });
        return true;
    }
});

// ─── Floating Widget ──────────────────────────────────────────────────────────
// A draggable floating button that gives quick access to all FocusFlow features
// directly on the page—without opening the popup.
//
// UX rules:
//  • Completely outside the normal document flow (fixed, high z-index).
//  • Draggable anywhere; position is persisted per-origin in localStorage.
//  • Clicking without dragging opens/closes the feature panel.
//  • Dragging to the center zone (within 80px of viewport centre) triggers
//    a shrink-and-dissolve delete animation that permanently hides the widget
//    for the current session (restored on next page load via the auto-init).

const FF_WIDGET_ID = "ff-floating-widget";
const FF_PANEL_ID = "ff-floating-panel";
const FF_STORAGE_KEY = "ff-widget-pos";

/** Hides (but does not destroy) the floating widget. */
const hideFloatingWidget = () => {
    const w = document.getElementById(FF_WIDGET_ID);
    if (w) w.style.display = "none";
};

/** Re-shows the floating widget if it exists. */
const showFloatingWidget = () => {
    const w = document.getElementById(FF_WIDGET_ID);
    if (w) w.style.display = "";
};

/**
 * Returns { x, y } saved position from localStorage, or a sensible default.
 */
const getSavedWidgetPos = () => {
    try {
        const raw = localStorage.getItem(FF_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    // Default: bottom-right corner
    return { x: window.innerWidth - 80, y: window.innerHeight - 80 };
};

/**
 * Saves the widget position to localStorage.
 * @param {{ x: number, y: number }} pos
 */
const saveWidgetPos = (pos) => {
    try { localStorage.setItem(FF_STORAGE_KEY, JSON.stringify(pos)); } catch (_) { }
};

/**
 * Clamps a coordinate so the widget stays fully inside the viewport.
 * @param {number} x @param {number} y @param {number} size  Button diameter in px.
 */
const clampToViewport = (x, y, size = 56) => ({
    x: Math.max(8, Math.min(window.innerWidth - size - 8, x)),
    y: Math.max(8, Math.min(window.innerHeight - size - 8, y)),
});

/**
 * Returns true if (x, y) is within `threshold` pixels of the top-horizontal-centre.
 * Only the horizontal distance to the centre matters; the widget must also be
 * within the top 120px of the viewport so it feels like a top-bar drop target.
 * @param {number} x @param {number} y @param {number} [threshold=80]
 */
const isNearTopCenter = (x, y, threshold = 80) => {
    const cx = window.innerWidth / 2;
    return Math.abs(x - cx) < threshold && y < 120;
};

/**
 * Builds and injects the floating widget + panel into the page.
 * Safe to call multiple times — replaces existing widget to ensure updated HTML.
 */
const injectFloatingWidget = () => {
    const existingWidget = document.getElementById(FF_WIDGET_ID);
    if (existingWidget) {
        // Remove old widget to rebuild with new HTML structure (e.g. Chat button)
        existingWidget.remove();
    }

    // ── Wrapper (acts as drag handle + position anchor) ───────────────────
    const widget = document.createElement("div");
    widget.id = FF_WIDGET_ID;
    widget.setAttribute("aria-label", "FocusFlow quick access");
    widget.setAttribute("role", "button");
    widget.setAttribute("tabindex", "0");

    // ── Feature Panel ─────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.id = FF_PANEL_ID;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "FocusFlow features");

    // Determine current states so we can show active indicators
    const activeProfiles = readActiveProfiles();
    const focusActive = isFocusModeActive();

    panel.innerHTML = `
      <div class="ff-floating-panel-header">
        <span class="ff-panel-logo">🪷 FocusFlow</span>
        <button class="ff-panel-close" aria-label="Close menu" title="Close">✕</button>
      </div>
      <div class="ff-panel-section-label">Focus</div>
      <button class="ff-panel-item${focusActive ? " ff-panel-item--active" : ""}" data-action="TOGGLE_FOCUS" title="Apply a clean reading overlay — CSS only, no AI">
        <span class="ff-pi-icon">🎯</span>
        <span class="ff-pi-text">
          <span class="ff-pi-name">Focus Mode</span>
          <span class="ff-pi-desc">Clean reading overlay</span>
        </span>
        <span class="ff-pi-dot${focusActive ? " ff-pi-dot--on" : ""}"></span>
      </button>
      <button class="ff-panel-item" data-action="SUMMARIZE_PAGE" title="AI-powered summarization — reads the article with Qwen">
        <span class="ff-pi-icon">🪷</span>
        <span class="ff-pi-text"><span class="ff-pi-name">Summarize with AI</span><span class="ff-pi-desc">Qwen reads the article</span></span>
      </button>
      <div class="ff-panel-section-label">Accessibility</div>
      <button class="ff-panel-item${activeProfiles.adhd ? " ff-panel-item--active ff-panel-item--adhd" : ""}" data-action="TOGGLE_PROFILE" data-profile="adhd"     title="Reduce distractions &amp; animations">
        <span class="ff-pi-icon">⚡</span>
        <span class="ff-pi-text"><span class="ff-pi-name">ADHD</span><span class="ff-pi-desc">Calm &amp; focused</span></span>
        <span class="ff-pi-dot${activeProfiles.adhd ? " ff-pi-dot--on" : ""}"></span>
      </button>
      <button class="ff-panel-item${activeProfiles.dyslexia ? " ff-panel-item--active ff-panel-item--dyslexia" : ""}" data-action="TOGGLE_PROFILE" data-profile="dyslexia" title="Bionic reading &amp; better spacing">
        <span class="ff-pi-icon">📖</span>
        <span class="ff-pi-text"><span class="ff-pi-name">Dyslexia</span><span class="ff-pi-desc">Bionic reading</span></span>
        <span class="ff-pi-dot${activeProfiles.dyslexia ? " ff-pi-dot--on" : ""}"></span>
      </button>
      <button class="ff-panel-item${activeProfiles.elderly ? " ff-panel-item--active ff-panel-item--elderly" : ""}" data-action="TOGGLE_PROFILE" data-profile="elderly"  title="Larger text &amp; text-to-speech">
        <span class="ff-pi-icon">🔡</span>
        <span class="ff-pi-text"><span class="ff-pi-name">Elderly</span><span class="ff-pi-desc">Larger text + TTS</span></span>
        <span class="ff-pi-dot${activeProfiles.elderly ? " ff-pi-dot--on" : ""}"></span>
      </button>
      <button class="ff-panel-item${activeProfiles.autism ? " ff-panel-item--active ff-panel-item--autism" : ""}" data-action="TOGGLE_PROFILE" data-profile="autism"   title="No motion, muted colours">
        <span class="ff-pi-icon">🤫</span>
        <span class="ff-pi-text"><span class="ff-pi-name">Autism</span><span class="ff-pi-desc">No motion or noise</span></span>
        <span class="ff-pi-dot${activeProfiles.autism ? " ff-pi-dot--on" : ""}"></span>
      </button>
      <div class="ff-panel-section-label">General</div>
      <button class="ff-panel-item" data-action="OPEN_CHAT" title="Ask questions about this page">
        <span class="ff-pi-icon">💬</span>
        <span class="ff-pi-text"><span class="ff-pi-name">Chat with Page</span><span class="ff-pi-desc">Ask AI questions</span></span>
      </button>
      <button class="ff-panel-item" data-action="SHOW_SUMMARY_CARD" title="Restore the summary card if you dismissed it">
        <span class="ff-pi-icon">📋</span>
        <span class="ff-pi-text"><span class="ff-pi-name">Show Summary Card</span><span class="ff-pi-desc">Restore inline card</span></span>
      </button>
      <div class="ff-panel-footer">Drag to centre to dismiss</div>
    `;

    widget.appendChild(panel);
    document.body.appendChild(widget);

    // ── Position ──────────────────────────────────────────────────────────
    const saved = getSavedWidgetPos();
    const pos = clampToViewport(saved.x, saved.y);
    widget.style.left = pos.x + "px";
    widget.style.top = pos.y + "px";

    // ── Delete-zone indicator (top-center target shown while dragging) ─────
    const deleteZone = document.createElement("div");
    deleteZone.id = "ff-delete-zone";
    deleteZone.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><small>Release to dismiss</small>`;
    document.body.appendChild(deleteZone);

    // ── State ─────────────────────────────────────────────────────────────
    let isDragging = false;
    let panelOpen = false;
    let dragMoved = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let startWidgetX = 0;
    let startWidgetY = 0;

    // ── Drag Logic ────────────────────────────────────────────────────────
    widget.addEventListener("mousedown", (e) => {
        // Only drag from the widget itself (not panel buttons)
        if (e.target.closest(`#${FF_PANEL_ID}`) && !e.target.closest(".ff-panel-header")) return;
        if (e.button !== 0) return;

        isDragging = true;
        dragMoved = false;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startWidgetX = parseInt(widget.style.left, 10);
        startWidgetY = parseInt(widget.style.top, 10);

        widget.classList.add("ff-widget--dragging");
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;

        const raw = { x: startWidgetX + dx, y: startWidgetY + dy };
        const { x, y } = clampToViewport(raw.x, raw.y);
        widget.style.left = x + "px";
        widget.style.top = y + "px";

        // Show delete-zone when near top-centre
        const btnCx = x + 28; // centre of 56px button
        const btnCy = y + 28;
        if (isNearTopCenter(btnCx, btnCy)) {
            deleteZone.classList.add("ff-delete-zone--visible");
            widget.classList.add("ff-widget--near-delete");
        } else {
            deleteZone.classList.remove("ff-delete-zone--visible");
            widget.classList.remove("ff-widget--near-delete");
        }
    });

    document.addEventListener("mouseup", (e) => {
        if (!isDragging) return;
        isDragging = false;

        const x = parseInt(widget.style.left, 10);
        const y = parseInt(widget.style.top, 10);
        const btnCx = x + 28;
        const btnCy = y + 28;

        widget.classList.remove("ff-widget--dragging", "ff-widget--near-delete");
        deleteZone.classList.remove("ff-delete-zone--visible");

        if (dragMoved && isNearTopCenter(btnCx, btnCy)) {
            // ── Delete animation ─────────────────────────────────────────
            // 1. Snap to top-horizontal-centre
            const finalX = window.innerWidth / 2 - 28;
            const finalY = 8;
            widget.style.transition = "left 0.25s cubic-bezier(.4,0,.2,1), top 0.25s cubic-bezier(.4,0,.2,1)";
            widget.style.left = finalX + "px";
            widget.style.top = finalY + "px";

            // 2. Close panel if open
            setPanel(false);

            // 3. Play dissolve animation
            setTimeout(() => {
                widget.classList.add("ff-widget--explode");
                setTimeout(() => {
                    widget.remove();
                    deleteZone.remove();
                }, 700);
            }, 220);

        } else {
            // Normal drop — save position
            widget.style.transition = "";
            if (dragMoved) saveWidgetPos({ x, y });
        }
    });

    // Touch support
    widget.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        isDragging = true;
        dragMoved = false;
        startMouseX = t.clientX;
        startMouseY = t.clientY;
        startWidgetX = parseInt(widget.style.left, 10);
        startWidgetY = parseInt(widget.style.top, 10);
        widget.classList.add("ff-widget--dragging");
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
        if (!isDragging) return;
        const t = e.touches[0];
        const dx = t.clientX - startMouseX;
        const dy = t.clientY - startMouseY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;

        const { x, y } = clampToViewport(startWidgetX + dx, startWidgetY + dy);
        widget.style.left = x + "px";
        widget.style.top = y + "px";

        const btnCx = x + 28;
        const btnCy = y + 28;
        if (isNearTopCenter(btnCx, btnCy)) {
            deleteZone.classList.add("ff-delete-zone--visible");
            widget.classList.add("ff-widget--near-delete");
        } else {
            deleteZone.classList.remove("ff-delete-zone--visible");
            widget.classList.remove("ff-widget--near-delete");
        }
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
        if (!isDragging) return;
        isDragging = false;
        const x = parseInt(widget.style.left, 10);
        const y = parseInt(widget.style.top, 10);
        const btnCx = x + 28;
        const btnCy = y + 28;

        widget.classList.remove("ff-widget--dragging", "ff-widget--near-delete");
        deleteZone.classList.remove("ff-delete-zone--visible");

        if (dragMoved && isNearTopCenter(btnCx, btnCy)) {
            widget.classList.add("ff-widget--explode");
            setTimeout(() => { widget.remove(); deleteZone.remove(); }, 700);
        } else {
            if (dragMoved) saveWidgetPos({ x, y });
        }
    });

    // ── Panel Toggle ──────────────────────────────────────────────────────
    const setPanel = (open) => {
        panelOpen = open;
        if (open) {
            panel.classList.add("ff-panel--open");
            widget.classList.add("ff-widget--open");
            // Refresh state each time we open so toggles are accurate
            refreshPanelState();
        } else {
            panel.classList.remove("ff-panel--open");
            widget.classList.remove("ff-widget--open");
        }
    };

    widget.addEventListener("click", (e) => {
        // Ignore clicks that were actually drags
        if (dragMoved) { dragMoved = false; return; }
        // If click was inside the panel (not the FAB itself), let it bubble
        if (e.target.closest(`#${FF_PANEL_ID}`)) return;
        setPanel(!panelOpen);
    });

    widget.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPanel(!panelOpen); }
        if (e.key === "Escape") setPanel(false);
    });

    // Close button inside panel
    panel.querySelector(".ff-panel-close").addEventListener("click", (e) => {
        e.stopPropagation();
        setPanel(false);
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
        if (panelOpen && !widget.contains(e.target)) setPanel(false);
    });

    // ── Feature Buttons ───────────────────────────────────────────────────
    panel.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        const profile = btn.dataset.profile;

        if (action === "SHOW_SUMMARY_CARD") {
            injectSummaryCard();
            setPanel(false);
            const card = document.getElementById(FF_CARD_ID);
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        if (action === "OPEN_CHAT") {
            setPanel(false);
            openChatPanel();
        }

        if (action === "TOGGLE_FOCUS") {
            if (isFocusModeActive()) {
                disableFocusMode();
                removeSummaryBanner();
            } else {
                // CSS-only: just apply the focus mode overlay
                enableFocusMode();
            }
            refreshPanelState();
        }

        if (action === "SUMMARIZE_PAGE") {
            // AI summarization — separate action from toggling Focus Mode
            btn.classList.add("ff-panel-item--loading");
            showWidgetToast("Extracting article…", "info");
            const articleResult = extractArticleContent();
            if (articleResult.error) {
                btn.classList.remove("ff-panel-item--loading");
                showWidgetToast(articleResult.error, "error");
                return;
            }
            showWidgetToast(`Sending ${articleResult.text.split(/\s+/).length.toLocaleString()} words to AI…`, "info");
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "SUMMARIZE_FROM_WIDGET",
                    article: articleResult
                });
                btn.classList.remove("ff-panel-item--loading");
                if (response && response.success) {
                    const summaryHtml = parseBulletsToHtml(response.rawSummary);
                    injectSummaryBanner(articleResult.title, summaryHtml);
                    if (!isFocusModeActive()) enableFocusMode();
                    showWidgetToast("Summary ready!", "success");
                } else {
                    showWidgetToast(response?.error || "Summary failed. Check your API key in Settings.", "error");
                }
            } catch (err) {
                btn.classList.remove("ff-panel-item--loading");
                showWidgetToast("Could not reach background worker.", "error");
            }
            refreshPanelState();
        }

        if (action === "TOGGLE_PROFILE") {
            const profiles = readActiveProfiles();
            profiles[profile] = !profiles[profile];
            applyProfiles(profiles);
            try { chrome.storage.sync.set({ ffProfiles: profiles }); } catch (_) { }
            refreshPanelState();
        }
    });

    // ── State Sync ────────────────────────────────────────────────────────
    const refreshPanelState = () => {
        const prof = readActiveProfiles();
        const focus = isFocusModeActive();

        // Focus Mode button
        const focusBtn = panel.querySelector('[data-action="TOGGLE_FOCUS"]');
        if (focusBtn) {
            focusBtn.classList.toggle("ff-panel-item--active", focus);
            const dot = focusBtn.querySelector(".ff-pi-dot");
            if (dot) dot.classList.toggle("ff-pi-dot--on", focus);
        }

        // Profile buttons
        Object.entries(prof).forEach(([key, active]) => {
            const btn2 = panel.querySelector(`[data-profile="${key}"]`);
            if (!btn2) return;
            btn2.classList.toggle("ff-panel-item--active", active);
            btn2.classList.toggle(`ff-panel-item--${key}`, active);
            const dot = btn2.querySelector(".ff-pi-dot");
            if (dot) dot.classList.toggle("ff-pi-dot--on", active);
        });
    };
};

/**
 * Shows a brief toast notification anchored to the floating widget.
 * @param {string} message
 * @param {"info"|"error"|"success"} [type]
 */
const showWidgetToast = (message, type = "info") => {
    const existing = document.getElementById("ff-widget-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "ff-widget-toast";
    toast.className = `ff-widget-toast ff-widget-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Position near widget
    const widget = document.getElementById(FF_WIDGET_ID);
    if (widget) {
        const wx = parseInt(widget.style.left, 10);
        const wy = parseInt(widget.style.top, 10);
        toast.style.left = Math.max(8, wx - 120) + "px";
        toast.style.top = Math.max(8, wy - 60) + "px";
    }

    requestAnimationFrame(() => toast.classList.add("ff-widget-toast--visible"));
    setTimeout(() => {
        toast.classList.remove("ff-widget-toast--visible");
        setTimeout(() => toast.remove(), 350);
    }, 3500);
};



// ─── Chat with Page (RAG) ───────────────────────────────────────────────────

const FF_CHAT_ID = "ff-chat-panel";

/**
 * Silently extracts the article and chunks it so it's ready for the chat UI.
 */
const initializeRAG = async () => {
    if (ffChunks.length > 0) return; // Already initialized

    const result = extractArticleContent();
    if (result.error) throw new Error(result.error);

    // Split article into ~150 word chunks for better retrieval granularity
    ffChunks = chunkText(result.text, 150);

    if (ffChunks.length === 0) throw new Error("Could not extract readable text.");
    console.log(`[FocusFlow] RAG initialized: ${ffChunks.length} chunks ready for similarity search.`);
};

/**
 * Creates and shows the chat panel.
 */
const openChatPanel = () => {
    // Ensure RAG is initializing if they didn't click "Simplify" first
    if (ffChunks.length === 0) {
        initializeRAG().catch(e => console.error("[FocusFlow] Auto-init RAG failed:", e.message));
    }

    let chat = document.getElementById(FF_CHAT_ID);
    if (!chat) {
        chat = document.createElement("div");
        chat.id = FF_CHAT_ID;
        chat.innerHTML = `
            <div class="ff-chat-header">
                <div>
                    <strong>Chat with Page</strong>
                    <span>Ask FocusFlow AI</span>
                </div>
                <button class="ff-chat-close">✕</button>
            </div>
            <div class="ff-chat-history" id="ff-chat-history">
                <div class="ff-chat-msg ff-chat-ai">Hi! I've read this page. What would you like to know?</div>
            </div>
            <form class="ff-chat-input-area" id="ff-chat-form">
                <input type="text" id="ff-chat-input" placeholder="Ask a question..." autocomplete="off" required>
                <button type="submit" id="ff-chat-submit">↑</button>
            </form>
        `;
        document.body.appendChild(chat);

        // Events
        chat.querySelector(".ff-chat-close").addEventListener("click", () => {
            chat.classList.remove("ff-chat-open");
        });

        const form = chat.querySelector("#ff-chat-form");
        const input = chat.querySelector("#ff-chat-input");
        const history = chat.querySelector("#ff-chat-history");

        const appendMsg = (text, role) => {
            const div = document.createElement("div");
            div.className = `ff-chat-msg ff-chat-${role}`;
            div.textContent = text;
            history.appendChild(div);
            history.scrollTop = history.scrollHeight;
            return div;
        };

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const question = input.value.trim();
            if (!question) return;

            input.value = "";

            // ── Internal Slash Commands ──
            if (question.startsWith("/")) {
                const cmd = question.toLowerCase();

                if (cmd === "/clear") {
                    history.innerHTML = '<div class="ff-chat-msg ff-chat-ai">Hi! I\'ve read this page. What would you like to know?</div>';
                    return;
                }

                appendMsg(question, "user");

                if (cmd === "/help") {
                    appendMsg("Available commands:\n/clear - Clear the chat history\n/help - Show this message\n/model - Show the AI models currently in use", "ai");
                    return;
                }

                if (cmd === "/model") {
                    appendMsg("Current AI Models powering FocusFlow:\n• LLM: Qwen/Qwen2.5-Coder-32B-Instruct:fastest\n• Context Engine: sentence-transformers/all-MiniLM-L6-v2", "ai");
                    return;
                }

                appendMsg(`Unknown command: ${question}. Type /help for a list of available commands.`, "ai");
                return;
            }

            appendMsg(question, "user");

            const loadingMsg = appendMsg("Thinking...", "ai");
            loadingMsg.classList.add("ff-chat-loading");

            // RAG Flow
            try {
                // 1. If no chunks exist, try extracting text.
                if (ffChunks.length === 0) {
                    await initializeRAG();
                }

                if (ffChunks.length === 0) {
                    throw new Error("Could not read the page content.");
                }

                // 2. Ask HF to compare the question against our chunks
                const simRes = await chrome.runtime.sendMessage({
                    action: "GET_SIMILAR_CHUNKS",
                    question: question,
                    chunks: ffChunks
                });

                if (!simRes || !simRes.success) {
                    throw new Error("Failed to search page: " + (simRes?.error || "Unknown"));
                }

                const scores = simRes.scores; // Array of floats, same length as ffChunks (up to 40 max in api.js)

                // 3. Find top 3 most similar chunks
                const scoredChunks = ffChunks.slice(0, 40).map((chunk, i) => ({
                    chunk,
                    score: scores[i] || 0
                }));

                // Sort descending by score
                scoredChunks.sort((a, b) => b.score - a.score);

                // Take top 3
                const topChunks = scoredChunks.slice(0, 3).map(sc => sc.chunk);
                const context = topChunks.join("\n\n---\n\n");

                // 4. Send to LLM
                const chatRes = await chrome.runtime.sendMessage({
                    action: "CHAT_WITH_CONTEXT",
                    question,
                    context
                });

                loadingMsg.remove();

                if (chatRes && chatRes.success) {
                    appendMsg(chatRes.answer, "ai");
                } else {
                    appendMsg(chatRes?.error || "Error asking AI.", "ai");
                }

            } catch (err) {
                loadingMsg.remove();
                appendMsg(`Error: ${err.message}`, "ai");
            }
        });
    }

    // Force reflow and slide in
    requestAnimationFrame(() => {
        chat.classList.add("ff-chat-open");
        chat.querySelector("#ff-chat-input").focus();
    });
};


// ─── Inline Summary Card ──────────────────────────────────────────────────────
// A small "Summarise this page" card injected into the article body.
// Provides one-click AI summarisation without opening the extension popup.

const FF_CARD_ID = "ff-summary-card";

/**
 * Injects the inline summary quick-click card into the page.
 * Idempotent — skips if already present.
 */
const injectSummaryCard = () => {
    if (document.getElementById(FF_CARD_ID)) return;
    if (!document.body) return;

    const card = document.createElement("div");
    card.id = FF_CARD_ID;
    card.setAttribute("role", "complementary");
    card.setAttribute("aria-label", "FocusFlow — Summarise this page");
    card.innerHTML = `
        <div id="ff-card-inner">
            <span id="ff-card-icon">🪷</span>
            <div id="ff-card-text">
                <strong>Find Your Flow</strong>
                <span id="ff-card-sub">Zen Summarisation · FocusFlow</span>
            </div>
            <button id="ff-card-btn" aria-label="Generate AI summary">Go</button>
            <button id="ff-card-close" aria-label="Dismiss summary card" title="Dismiss">✕</button>
        </div>
        <div id="ff-card-status" aria-live="polite" hidden></div>
    `;

    document.body.prepend(card);

    const btn = card.querySelector("#ff-card-btn");
    const closeBtn = card.querySelector("#ff-card-close");
    const statusEl = card.querySelector("#ff-card-status");
    const iconEl = card.querySelector("#ff-card-icon");
    const subEl = card.querySelector("#ff-card-sub");

    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        card.remove();
    });

    const setCardState = (state) => {
        card.dataset.state = state;
    };

    const showCardStatus = (msg, isError = false) => {
        statusEl.hidden = false;
        statusEl.textContent = msg;
        statusEl.dataset.error = isError ? "true" : "false";
    };

    btn.addEventListener("click", async () => {
        if (card.dataset.state === "loading") return;
        setCardState("loading");
        btn.disabled = true;
        btn.textContent = "…";
        iconEl.textContent = "⏳";
        subEl.textContent = "Extracting article…";
        statusEl.hidden = true;

        // Step 1: Extract content
        const articleResult = extractArticleContent();
        if (articleResult.error) {
            setCardState("error");
            iconEl.textContent = "⚠️";
            subEl.textContent = "Not an article";
            showCardStatus(articleResult.error, true);
            btn.textContent = "Retry";
            btn.disabled = false;
            return;
        }

        subEl.textContent = "Asking AI…";

        // Step 2: Send to background for summarisation
        let result;
        try {
            result = await chrome.runtime.sendMessage({
                action: "SUMMARIZE_FROM_WIDGET",
                article: { text: articleResult.text, title: articleResult.title }
            });
        } catch (err) {
            setCardState("error");
            iconEl.textContent = "❌";
            subEl.textContent = "Failed to reach extension";
            showCardStatus(err.message, true);
            btn.textContent = "Retry";
            btn.disabled = false;
            return;
        }

        if (!result?.success) {
            setCardState("error");
            iconEl.textContent = "❌";
            subEl.textContent = result?.error || "Summarisation failed";
            showCardStatus(result?.error || "Unknown error", true);
            btn.textContent = "Retry";
            btn.disabled = false;
            return;
        }

        // Step 3: Inject the summary banner into the page
        const html = parseBulletsToHtml(result.rawSummary);
        injectSummaryBanner(articleResult.title, html);

        // Step 4: Collapse the card
        setCardState("done");
        iconEl.textContent = "✅";
        subEl.textContent = "Summary ready — scroll up";
        btn.textContent = "↑";
        btn.disabled = false;
        btn.title = "Scroll to summary";
        btn.addEventListener("click", () => {
            const banner = document.getElementById(SUMMARY_BANNER_ID);
            if (banner) banner.scrollIntoView({ behavior: "smooth" });
        }, { once: true });
    });
};

// ── Auto-inject on page load ─────────────────────────────────────────────────
// Must be at the END so all const functions above are defined before the
// setTimeout callback fires (const is NOT hoisted like function declarations).
setTimeout(() => {
    injectFloatingWidget();
    injectSummaryCard();
}, 500);
