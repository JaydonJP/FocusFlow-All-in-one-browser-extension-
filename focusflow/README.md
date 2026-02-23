# FocusFlow – ADHD-Friendly Chrome Extension

> **"Your Cognitive Firewall for the Web"** — Powered by Qwen-Coder AI + Mozilla Readability

FocusFlow is a Manifest V3 Chrome Extension that helps ADHD users cut through the noise of modern web pages. One click simplifies any article into clean bullet points and applies a distraction-free "Minimalist Light Mode" overlay.

---

## ✨ Features

- ⚡ **AI Summarization** – Sends article text to Qwen-Coder (Hugging Face) and returns 3–5 focused bullet points
- 🧹 **Minimalist Light Mode** – Hides ads, navbars, sidebars, iframes, and cookie banners
- 📖 **Mozilla Readability** – Accurately extracts the real article content (the same engine Firefox Reader View uses)
- 🔒 **Secure API Key** – Stored in Chrome's encrypted `storage.sync`, never hardcoded
- 🔁 **Toggle ON/OFF** – Focus Mode is a toggle; original page is restored without a refresh
- 📊 **Word Count Awareness** – Automatically trims to 1,500 words to stay within free-tier token limits

---

## 📁 File Structure

```
focusflow/
├── manifest.json        # MV3 manifest
├── background.js        # Service worker – API relay
├── content.js           # DOM manipulation + Readability integration
├── api.js               # Hugging Face fetch logic with error handling
├── popup.html           # Extension popup UI
├── popup.js             # Popup controller (state machine)
├── options.html         # Settings page
├── options.js           # API key save/load logic
├── styles.css           # ADHD-friendly CSS overlay
├── lib/
│   └── Readability.js   # Mozilla Readability v0.6.0
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🚀 Installation

1. **Get a free Hugging Face API Key**
   - Visit [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
   - Create a token with `Inference API` read access

2. **Load the extension in Chrome**
   - Open `chrome://extensions`
   - Enable **Developer Mode** (top right toggle)
   - Click **"Load unpacked"** → select the `focusflow/` folder

3. **Set your API key**
   - Click the FocusFlow icon in your toolbar
   - Click **⚙ Settings** (or "Set API Key" link)
   - Paste your `hf_...` token and click **Save**

4. **Use it!**
   - Navigate to any news article, blog post, or documentation page
   - Click the FocusFlow extension icon
   - Click **⚡ Simplify This Page**
   - The AI will summarize and the page will transform into a clean reading mode

---

## 🔐 Security Model

| Concern | How FocusFlow Handles It |
|---|---|
| API Key Storage | `chrome.storage.sync` (encrypted by Chrome, synced across devices) |
| Key Visibility | Never logged, never exposed to page content scripts |
| API Calls | Made from background service worker, not injected scripts |
| DOM Manipulation | XSS-safe via `escapeHtml()` on all AI-generated content |
| Readability | Runs on a cloned document — never mutates the live DOM |

---

## 🧠 How It Works (Architecture)

```
User Click (popup.js)
    │
    ├─► content.js: Extract via Readability.js → returns { title, text }
    │
    ├─► background.js: api.js → Hugging Face Qwen-Coder API
    │       Prompt: "Summarize into 3–5 bullet points..."
    │       Trims to 1,500 words if needed
    │
    └─► content.js: Inject <div#focusflow-summary-banner>
                    Add class .focusflow-active to <html>
                    CSS hides clutter, applies Lexend font + #FAFAFA bg
```

---

## ⚙️ Technical Details

- **Manifest**: V3 (service worker background, `scripting` permission)
- **Model**: `Qwen/Qwen2.5-Coder-32B-Instruct` via Hugging Face Inference API
- **Font**: [Lexend](https://fonts.google.com/specimen/Lexend) (designed for reading proficiency)
- **Background color**: `#FAFAFA` (off-white, reduces glare vs pure white)
- **Max content width**: `800px` centered
- **Line height**: `1.7` (increased for cognitive ease)
- **Token safety**: Sends max 1,500 words (~2,000 tokens) to stay within free tier

---

## 🛠️ Development Notes

- All functions have JSDoc comments
- `const`/`let` only — no `var`
- `try/catch` blocks on all API calls and DOM operations
- Modular architecture: API logic, DOM logic, and UI logic are all separate files
