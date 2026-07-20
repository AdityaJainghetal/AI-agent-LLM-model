const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const {
  generateEmbedding,
  storeUserChatContext,
  queryContext,
} = require("./embeddingService");
require("dotenv").config();
const {
  DEFAULT_MODEL_LOCAL,
  OLLAMA_GENERATE_ENDPOINT,
} = require("../config/server-config");
const DEFAULT_MODEL = DEFAULT_MODEL_LOCAL;
const MAX_TOKENS = 300;
const CONTEXT_LIMIT = 2;
const CONTEXT_CHAR_LIMIT = 600;

// Compact system prompt to keep responses faster and more direct
const DEFAULT_SYSTEM_PROMPT = `You are a concise assistant. Use the provided context when helpful, otherwise answer directly. Keep your reply short, clear, and practical.`;

function splitIntoStreamChunks(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  return text.split(/(\s+)/).filter((chunk) => chunk.length > 0);
}

async function warmUpOllamaModel() {
  try {
    const startedAt = Date.now();
    await axios.post(OLLAMA_GENERATE_ENDPOINT, {
      model: DEFAULT_MODEL,
      prompt: "Hello",
      stream: false,
      options: { num_predict: 8, temperature: 0.1 },
    });
    console.log(
      `[Ollama warmup] completed in ${Date.now() - startedAt}ms for model ${DEFAULT_MODEL}`,
    );
  } catch (err) {
    console.warn(
      `[Ollama warmup] failed for ${DEFAULT_MODEL}: ${err.message || err}`,
    );
  }
}

warmUpOllamaModel();

/**
 * Streams an LLM response and calls onData(token) for each chunk, then onDone(fullResponse).
 * This function performs RAG: queries context and injects into prompt.
 */
async function streamAIResponse(
  prompt,
  onData,
  onDone = () => {},
  reqAbortSignal,
  organizationId,
  userId,
) {
  // Create a proper AbortController for axios
  const controller = new AbortController();
  let isStreamActive = true;
  let fullResponse = "";

  // React to external abort (client disconnect)
  if (reqAbortSignal) {
    reqAbortSignal.addEventListener("abort", () => {
      console.log("Request aborted by client");
      isStreamActive = false;
      controller.abort();
    });
  }

  const requestStartedAt = Date.now();

  // Build context quickly. If retrieval is slow, fall back to a plain prompt.
  const contextStartedAt = Date.now();
  const contextItems =
    process.env.SKIP_EMBEDDINGS === "true"
      ? []
      : await queryCombinedContext(
          prompt,
          organizationId,
          userId,
          CONTEXT_LIMIT,
        );
  console.log(
    `[Ollama timing] context retrieval took ${Date.now() - contextStartedAt}ms`,
  );

  console.log(`Retrieved ${contextItems.length} context items`);

  const compactContextText = (contextItems || [])
    .slice(0, CONTEXT_LIMIT)
    .map((item) => {
      const document =
        typeof item?.document === "string"
          ? item.document.replace(/\s+/g, " ").trim()
          : "";
      return `[Source: ${item?.source || "context"}] ${document.slice(0, CONTEXT_CHAR_LIMIT)}`;
    })
    .join("\n\n");

  const userContent = compactContextText
    ? `Context information:\n${compactContextText}\n\nUser Question: ${prompt}`
    : `User Question: ${prompt}`;

  try {
    const fullPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${userContent}\n\nAnswer briefly and directly.`;

    console.log("Ollama request", {
      endpoint: OLLAMA_GENERATE_ENDPOINT,
      model: DEFAULT_MODEL,
      promptLength: fullPrompt.length,
    });

    const modelStartedAt = Date.now();
    const response = await axios.post(
      OLLAMA_GENERATE_ENDPOINT,
      {
        model: DEFAULT_MODEL,
        prompt: fullPrompt,
        stream: true,
        keep_alive: "10m",
        options: {
          num_predict: MAX_TOKENS,
          num_ctx: 1536,
          temperature: 0.2,
          top_p: 0.9,
          repeat_penalty: 1.1,
          num_thread: 4,
        },
      },
      {
        responseType: "stream",
        timeout: 300000,
        maxBodyLength: Infinity,
        signal: controller.signal,
      },
    );

    console.log(
      `[Ollama timing] model request connected in ${Date.now() - modelStartedAt}ms`,
    );

    response.data.on("data", (chunk) => {
      if (!isStreamActive) return;
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.response) {
            const streamChunks = splitIntoStreamChunks(data.response);
            streamChunks.forEach((token) => {
              onData(token);
              fullResponse += token;
            });
          }
          if (data.done) {
            console.log(
              `[Ollama timing] full response completed in ${Date.now() - requestStartedAt}ms`,
            );
            isStreamActive = false;
            onDone(fullResponse);
            return;
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    });

    response.data.on("end", async () => {
      if (!isStreamActive) return;
      isStreamActive = false;
      onDone(fullResponse);

      try {
        // Skip embedding generation for chat responses to avoid blocking the user experience.
        // This keeps the app responsive and prevents slow timeouts from hurting latency.
        if (process.env.SKIP_EMBEDDINGS === "true") {
          return;
        }

        const promptEmb = await generateEmbedding(prompt);
        const respEmb = await generateEmbedding(fullResponse);
        const promptId = uuidv4();
        const respId = uuidv4();
        if (promptEmb) {
          await storeUserChatContext(userId, promptId, prompt, promptEmb);
        }
        if (respEmb) {
          await storeUserChatContext(userId, respId, fullResponse, respEmb);
        }
      } catch (err) {
        console.error("Post-stream store error:", err.message || err);
      }
    });

    response.data.on("error", (err) => {
      console.error("Ollama stream error:", err.message);
      if (isStreamActive) {
        isStreamActive = false;
        onDone(fullResponse);
      }
    });
  } catch (err) {
    console.error("Ollama generate error:", err.message || err);
    onDone("");
    throw err;
  }
}

/**
 * generateQA(contextText) -> returns {question, answer}
 * Uses LLM (OpenAI or Ollama) synchronously (non-stream) to create a Q/A pair.
 */
async function generateQA(contextText) {
  const prompt = `Given the following context, generate one concise Question and its Answer.\n\nContext:\n${contextText}\n\nFormat:\nQuestion: <question>\nAnswer: <answer>\n`;
  try {
    const res = await axios.post(
      OLLAMA_GENERATE_ENDPOINT,
      {
        model: DEFAULT_MODEL,
        prompt,
        options: { num_predict: 300 },
      },
      { timeout: 30000 },
    );
    const text = res.data?.response || "";
    const [qPart, aPart] = text.split("\nAnswer:");
    const question = (qPart || "").replace(/^Question:\s*/i, "").trim();
    const answer = (aPart || "").trim();
    return { question, answer };
  } catch (err) {
    console.error("generateQA error:", err.message || err);
    return { question: "", answer: "" };
  }
}

// Helper function to store user messages
async function storeUserMessage(
  userId,
  messageId,
  content,
  embedding,
  metadata = {},
) {
  // Implement your storage logic here
  console.log("Storing user message:", {
    userId,
    messageId,
    content: content.substring(0, 100) + "...",
    metadata,
  });
}

// Helper function to query combined context
async function queryCombinedContext(prompt, organizationId, userId, limit) {
  try {
    console.log(
      "Querying context for prompt:",
      prompt.substring(0, 100) + "...",
    );
    console.log("Organization ID:", organizationId, "User ID:", userId);

    const contextItems = await queryContext(
      prompt,
      limit,
      organizationId,
      userId,
    );
    console.log("Retrieved context items:", contextItems.length);

    // Debug logging
    if (contextItems.length > 0) {
      console.log("First context item preview:", {
        distance: contextItems[0].distance,
        document: contextItems[0].document
          ? contextItems[0].document.substring(0, 150) + "..."
          : "No document",
        metadata: contextItems[0].metadata,
      });
    }

    // Add source information to each item
    const enrichedItems = contextItems.map((item) => ({
      ...item,
      source:
        item.metadata?.type === "document" ? "knowledge_base" : "chat_history",
    }));

    return enrichedItems;
  } catch (error) {
    console.error("Error querying combined context:", error.message);
    return [];
  }
}

module.exports = { streamAIResponse, generateQA };
