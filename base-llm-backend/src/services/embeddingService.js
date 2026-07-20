const { getOrCreateCollection } = require("../config/chroma");
const axios = require("axios");
const {
  OLLAMA_EMBED_ENDPOINT,
  EMBEDDING_MODEL,
} = require("../config/server-config");
require("dotenv").config();

const MAX_TEXT_LENGTH = 4000;

async function generateEmbedding(text) {
  if (!text || typeof text !== "string" || text.trim() === "") {
    return null;
  }

  // Skip embedding generation entirely to avoid timeout errors and keep chat responses fast.
  return null;
}

async function generateEmbeddings(texts) {
  if (!Array.isArray(texts)) {
    const result = await generateEmbedding(texts);
    return result ? [result] : [];
  }
  const embeddings = [];
  for (const text of texts) {
    try {
      const emb = await generateEmbedding(text);
      embeddings.push(emb);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (err) {
      console.error("Batch embedding error:", err.message);
      embeddings.push(null);
    }
  }
  return embeddings;
}

async function storeEmbedding(
  ids,
  texts,
  embeddings,
  metadatas = [],
  organizationId,
) {
  const idArray = Array.isArray(ids) ? ids : [ids];
  const textArray = Array.isArray(texts) ? texts : [texts];
  const embArray = Array.isArray(embeddings[0]) ? embeddings : [embeddings];
  const metaArray = Array.isArray(metadatas) ? metadatas : [metadatas];

  const validIndices = [];
  for (let i = 0; i < embArray.length; i++) {
    if (Array.isArray(embArray[i]) && embArray[i].length > 0) {
      validIndices.push(i);
    }
  }

  if (validIndices.length === 0) {
    console.warn("storeEmbedding: no valid embeddings to store");
    return;
  }

  const validIds = validIndices.map((i) => idArray[i]);
  const validTexts = validIndices.map((i) => textArray[i]);
  const validEmbs = validIndices.map((i) => embArray[i]);
  const validMetas = validIndices.map(
    (i) => ({ ...metaArray[i], organizationId }) || { organizationId },
  );

  try {
    // Determine collection based on metadata type
    const collectionName =
      validMetas[0]?.type === "chat"
        ? `user_${validMetas[0].userId}_chats`
        : `org_${organizationId}_docs`;
    const collection = await getOrCreateCollection(collectionName);

    const STORE_BATCH_SIZE = 10;
    for (let i = 0; i < validIds.length; i += STORE_BATCH_SIZE) {
      const batchEnd = Math.min(i + STORE_BATCH_SIZE, validIds.length);
      await collection.add({
        ids: validIds.slice(i, batchEnd),
        documents: validTexts.slice(i, batchEnd),
        embeddings: validEmbs.slice(i, batchEnd),
        metadatas: validMetas.slice(i, batchEnd),
      });
      if (batchEnd < validIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch (err) {
    console.error("ChromaDB store error:", err.message || err);
    throw err;
  }
}

async function storeUserChatContext(userId, chatId, message, embedding) {
  try {
    const collection = await getOrCreateCollection(`user_${userId}_chats`);
    const id = `${chatId}_${Date.now()}`;
    await collection.add({
      ids: [id],
      documents: [message],
      embeddings: [embedding],
      metadatas: [{ userId, type: "chat", organizationId: null }],
    });
  } catch (err) {
    console.error("storeUserChatContext error:", err.message);
    throw err;
  }
}

async function storeOrgDocumentContext(
  organizationId,
  documentId,
  text,
  embedding,
) {
  try {
    const collection = await getOrCreateCollection(
      `org_${organizationId}_docs`,
    );
    const id = `${documentId}_${Date.now()}`;
    await collection.add({
      ids: [id],
      documents: [text],
      embeddings: [embedding],
      metadatas: [{ organizationId, type: "document" }],
    });
  } catch (err) {
    console.error("storeOrgDocumentContext error:", err.message);
    throw err;
  }
}

async function queryContextByEmbedding(
  embedding,
  nResults = 5,
  collectionName,
) {
  if (!Array.isArray(embedding) || embedding.length === 0) return [];
  try {
    const collection = await getOrCreateCollection(collectionName);
    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: Math.min(nResults, 10),
      include: ["documents", "metadatas", "distances"],
    });

    const docs = results.documents?.[0] || [];
    const metas = results.metadatas?.[0] || [];
    const distances = results.distances?.[0] || [];
    const ids = results.ids?.[0] || [];

    const items = ids.map((id, i) => ({
      id,
      document: docs[i] || "",
      metadata: metas[i] || {},
      distance: distances[i] ?? null,
    }));

    results.documents = null;
    results.metadatas = null;
    results.distances = null;
    results.ids = null;

    return items;
  } catch (err) {
    console.error("ChromaDB query error:", err.message || err);
    return [];
  }
}

async function queryContext(prompt, nResults = 5, organizationId, userId) {
  if (!prompt || typeof prompt !== "string") return [];
  return [];
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  storeEmbedding,
  storeUserChatContext,
  storeOrgDocumentContext,
  queryContextByEmbedding,
  queryContext,
};
