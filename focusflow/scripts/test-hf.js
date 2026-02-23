const HF_SIMILARITY_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2";

async function run() {
  const apiKey = "hf_FakeKey"; // Need to check if public models allow unauthorized or if we just get a 401. Let's send a fake key and see if we get a 401 (valid route) or 400 (invalid payload).
  try {
    const response = await fetch(HF_SIMILARITY_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: {
            "source_sentence": "That is a happy person",
            "sentences": [
                "That is a happy dog",
                "That is a very happy person",
                "Today is a sunny day"
            ]
        }
      })
    });
    
    console.log("Status:", response.status);
    if (!response.ok) {
        const text = await response.text();
        console.log("Error text:", text);
    } else {
        const data = await response.json();
        console.log("Data:", data);
    }
  } catch (err) {
      console.log("Network error:", err);
  }
}
run();
