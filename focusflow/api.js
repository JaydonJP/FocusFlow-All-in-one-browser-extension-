/**
 * FocusFlow - api.js
 * Handles all communication with the Hugging Face Inference API.
 * Keeps API logic isolated from DOM and UI concerns.
 */

const HF_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct:fastest";
const HF_API_BASE = "https://router.huggingface.co/v1/chat/completions";
const HF_SIMILARITY_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2";

/**
 * Builds the ADHD-accessibility system + user messages for the chat API.
 * @param {string} text - The article text to summarize.
 * @returns {Array} Array of message objects for the chat API.
 */
const buildMessages = (text) => {
  return [
    {
      role: "system",
      content:
        "You are an accessibility assistant that produces structured, comprehensive summaries of web pages. " +
        "Your output must cover the ENTIRE page — do not skip or omit any major section, topic, or idea. " +
        "Format your response as a series of named sections. " +
        "Each section must follow this exact format:\n" +
        "## Section Title\n" +
        "• bullet point one\n" +
        "• bullet point two\n" +
        "(add as many bullets as needed per section)\n\n" +
        "Rules:\n" +
        "- Use one section per major topic or logical part of the page.\n" +
        "- Scale the number of sections to the size and complexity of the content. Small pages: 2–3 sections. Long pages: 5–8+ sections.\n" +
        "- Each bullet must be a concise, informative sentence.\n" +
        "- Do NOT include introductory text, conclusions, or any text outside the section format.\n" +
        "- Every section header must start with '## ' and every bullet must start with '• '."
    },
    {
      role: "user",
      content: `Produce a full, structured summary of the following web page content. Cover every major section and topic:\n\n${text}`
    }
  ];
};

/**
 * Trims text to a maximum word count to respect free-tier token limits.
 * @param {string} text - The full article text.
 * @param {number} [maxWords=1500] - Maximum number of words to send.
 * @returns {string} Trimmed text.
 */
const trimToWordLimit = (text, maxWords = 4000) => {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
};

/**
 * Fetches an AI-generated summary from the Hugging Face Inference API.
 * Uses the /v1/chat/completions (Messages API) format required for Instruct models.
 * @param {string} articleText - The extracted article text.
 * @param {string} apiKey - The user's Hugging Face API key.
 * @returns {Promise<string>} The AI-generated bullet-point summary.
 * @throws {Error} If the API call fails or returns an unexpected response.
 */
const fetchSummary = async (articleText, apiKey) => {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("No API key found. Please set your Hugging Face API key in the extension options.");
  }

  const trimmedText = trimToWordLimit(articleText);
  const messages = buildMessages(trimmedText);

  const requestBody = {
    model: HF_MODEL,
    messages,
    max_tokens: 2048,
    temperature: 0.3,
    stream: false
  };

  let response;
  try {
    response = await fetch(HF_API_BASE, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (networkError) {
    throw new Error(`Network error: Could not reach Hugging Face API. ${networkError.message}`);
  }

  if (response.status === 401) {
    throw new Error("Invalid API key. Please check your Hugging Face API key in the extension options.");
  }
  if (response.status === 429) {
    throw new Error("Rate limit exceeded. Please wait a moment and try again.");
  }
  if (response.status === 503) {
    throw new Error("Model is loading on Hugging Face servers. Please try again in 20–30 seconds.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson.error || errJson.message || "";
    } catch (_) { }
    throw new Error(`API error ${response.status}${detail ? ": " + detail : ": " + response.statusText}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error("Unexpected API response format. Could not parse JSON.");
  }

  // Chat completions response shape: data.choices[0].message.content
  const rawText = data?.choices?.[0]?.message?.content;

  if (!rawText || rawText.trim() === "") {
    throw new Error("The AI returned an empty response. Please try again.");
  }

  return rawText.trim();
};

/**
 * Gets similarity scores for an array of chunks against a single question.
 * @param {string} question - The user's question.
 * @param {string[]} sentences - The array of text chunks from the article.
 * @param {string} apiKey - HF Token.
 * @returns {Promise<number[]>} Array of similarity scores between 0 and 1.
 */
const getSimilarChunks = async (question, sentences, apiKey) => {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("No API key found.");
  }

  let response;
  try {
    // Prevent HF 413 Payload Too Large by slicing to a reasonable chunk size.
    // The HF Similarity API might struggle with 100+ chunks, so limit to top 40 items
    const safeSentences = sentences.slice(0, 40);

    response = await fetch(HF_SIMILARITY_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: {
          source_sentence: question,
          sentences: safeSentences
        }
      })
    });
  } catch (err) {
    throw new Error(`Similarity network error: ${err.message}`);
  }

  if (response.status === 503 || response.status === 504) {
    throw new Error("Similarity model is loading. Please try again in 10-20 seconds.");
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Similarity API error: ${response.status} ${response.statusText} ${errText}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data)) throw new Error("Invalid response format from similarity API.");

  return data; // Array of floats
};

/**
 * Asks a question to the LLM using retrieved RAG context.
 * @param {string} question - The user's query.
 * @param {string} context - The combined relevant text chunks.
 * @param {string} apiKey - The user's Hugging Face API key.
 * @returns {Promise<string>} The AI's answer.
 */
const askQuestion = async (question, context, apiKey) => {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("No API key found.");
  }

  const messages = [
    {
      role: "system",
      content:
        "You are a helpful, precise reading assistant. The user will ask you a question about a specific article. " +
        "You will be provided with EXCERPTS from the article. " +
        "Answer the user's question USING ONLY the provided excerpts. " +
        "If the answer is NOT in the excerpts, say 'I cannot find the answer to that in the article.' " +
        "Do not use outside knowledge. Be concise but informative."
    },
    {
      role: "user",
      content: `EXCERPTS:\n---\n${context}\n---\n\nQUESTION: ${question}`
    }
  ];

  const requestBody = {
    model: HF_MODEL,
    messages,
    max_tokens: 1024,
    temperature: 0.1, // Low temperature for high factual accuracy
    stream: false
  };

  const response = await fetch(HF_API_BASE, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`Chat API error: ${response.statusText}`);
  }

  const data = await response.json();
  const rawText = data?.choices?.[0]?.message?.content;

  if (!rawText) throw new Error("Empty response from AI.");

  return rawText.trim();
};
