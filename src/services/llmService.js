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
const MAX_TOKENS = 2000;

// Improved system prompt that handles both context and general knowledge
const DEFAULT_SYSTEM_PROMPT = `You are an intelligent assistant. Follow these guidelines:
1. Use the provided context to answer questions when relevant information is available
2. If the context doesn't contain the answer, use your general knowledge to provide a helpful response
3. Never say "this does not exist in the context" or similar phrases
4. Always provide the most accurate answer you can, whether from context or general knowledge`;

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

  // Build context (RAG) - Get all context without filtering
  const contextItems = await queryCombinedContext(
    prompt,
    organizationId,
    userId,
    5,
  );

  console.log(`Retrieved ${contextItems.length} context items`);

  // Prepare the context text - use ALL context items without filtering
  const contextText = contextItems
    .map((i, idx) => `[Source: ${i.source}] ${i.document}`)
    .join("\n\n");

  // Always include context in the prompt, but with clear instructions
  const userContent = contextText
    ? `Context information:\n${contextText}\n\nUser Question: ${prompt}`
    : `User Question: ${prompt}`;

  try {
    const fullPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${userContent}`;

    const response = await axios.post(
      OLLAMA_GENERATE_ENDPOINT,
      {
        model: DEFAULT_MODEL,
        prompt: fullPrompt,
        stream: true,
        options: { num_predict: MAX_TOKENS },
      },
      {
        responseType: "stream",
        timeout: 120000,
        signal: controller.signal,
      },
    );

    response.data.on("data", (chunk) => {
      if (!isStreamActive) return;
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.response) {
            onData(data.response);
            fullResponse += data.response;
          }
          if (data.done) {
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
