# 🚀 FocusFlow: All-in-One Browser Extension

> **"Your Cognitive Firewall for the Web"** — Powered by AI + Mozilla Readability

Welcome to **FocusFlow**! A next-generation, ADHD-friendly accessibility browser extension specifically tailored for the elderly, neurodivergent individuals, and marginalized communities to extract, summarize, and present web content in a clean, distraction-free reading environment.

This guide will walk you through the ultimate "hacker-style" way to deploy FocusFlow on ANY device. Fire up your terminal, put on your shades, and let's get deploying. 🕶️

---

## 🛠️ Prerequisites

Before we start, verify that your local environment has the required dependencies:
- **Git** (for cloning the repo like a pro)
- **A Chromium-based browser** (Google Chrome, Brave, Edge, Opera, etc.)

---

## 💻 Deployment: The Hacker Way

Open your favorite terminal application. If you want to make it look cool, maximize the window, maybe switch to a retro green-on-black color scheme, and execute the following sequence:

### Step 1: Clone the Repository
Let's pull the source code directly from the matrix. Run this command to download the project to your local machine:

```bash
# 🧙‍♂️ Initiating secure repository clone sequence...
echo "Fetching FocusFlow payload..."
git clone https://github.com/JaydonJP/FocusFlow-All-in-one-browser-extension-.git

# 📂 Navigate into the heart of the project directory
cd FocusFlow-All-in-one-browser-extension-
```

### Step 2: Verify the Payload
Ensure all the essential modules successfully made it to your local environment. Run a quick list command with some swagger to verify the files:

```bash
# 🔍 Scanning directory contents for validation...
ls -la ./focusflow
```
*You should see core files like `manifest.json`, `background.js`, and `content.js` confirming the payload is intact and ready for execution.*


### Step 3: Obtain Your AI Power Source (Hugging Face API Key)
FocusFlow leverages Qwen-Coder AI to summarize pages lightning-fast. You need a free API key to fuel the neural network.
1. Head over to [Hugging Face Settings](https://huggingface.co/settings/tokens) in your browser.
2. Generate a new token and ensure it has **Inference API** read access.
3. Copy this key to your clipboard. Keep it secret, keep it safe. 🤫

### Step 4: Inject into the Browser (Deploy)
Now for the final deployment phase. We bypass the standard web stores and load it directly into the browser core:

1. Open your Chromium-based browser (Chrome, Edge, Brave).
2. Type the following internal command into your address bar and hit Enter:
   ```text
   chrome://extensions/
   ```
   *(Note: If you are using Edge, input `edge://extensions/` instead)*
3. **Bypass Security (Enable Developer Mode)**: Look for the **Developer mode** toggle (usually located in the top-right corner) and switch it **ON**. 🔓
4. **Load the Payload**: Click the **"Load unpacked"** button that just appeared on the top left.
5. In the file picker window, navigate to the folder where you cloned the repository and select the `focusflow` subdirectory.
   - *Example Path:* `.../FocusFlow-All-in-one-browser-extension-/focusflow`

### Step 5: Initialize the Core (Configure API Key)
The extension is loaded, but it needs the power source we acquired in Step 3.

1. Pin the **FocusFlow** puzzle piece icon 🧩 to your browser's toolbar for quick access.
2. Click the FocusFlow icon, then click the **⚙ Settings** (or "Set API Key" link).
3. Paste your Hugging Face API token (`hf_...`) into the input field.
4. Click **Save** to lock it in.

### 🎯 Mission Accomplished
Congratulations! The FocusFlow cognitive firewall is now fully operational locally on your device.

**To trigger your new tool:**
1. Navigate to any cluttered, ad-heavy webpage, news article, or blog.
2. Click the FocusFlow icon in your toolbar.
3. Click the **⚡ Simplify This Page** button.
4. Watch as the noise fades away, ads are vaporized, and the AI generates a clean, readable summary tailored specifically for you.

---

## 🛡️ Security Clearance

- **Encrypted API Keys**: Your keys are stored locally using your browser's encrypted `storage.sync`. They are never hardcoded, never exposed to page scripts, and never shared anywhere except the secure Hugging Face API tunnel.
- **Privacy First**: FocusFlow processes data securely. The `Readability` module runs locally on a cloned document, meaning it never mutates the live DOM without your permission. No creepy tracking!

---

*Enjoy a cleaner, more focused web experience. 🌐✨*
