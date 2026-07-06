require("dotenv").config();

const PORT = process.env.PORT || 3008;
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "mxbai-embed-large:latest";
const OLLAMA_EMBED_ENDPOINT =
  process.env.OLLAMA_EMBED_ENDPOINT || "http://localhost:11434/api/embeddings";
const DEFAULT_MODEL_LOCAL =
  process.env.DEFAULT_MODEL_LOCAL || "llama3.1:latest";
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chatbot";
const OLLAMA_GENERATE_ENDPOINT =
  process.env.OLLAMA_GENERATE_ENDPOINT || "http://localhost:11434/api/generate";

module.exports = {
  PORT,
  EMBEDDING_MODEL,
  OLLAMA_EMBED_ENDPOINT,
  DEFAULT_MODEL_LOCAL,
  OLLAMA_GENERATE_ENDPOINT,
  CHROMA_URL,
  MONGO_URI,
};
