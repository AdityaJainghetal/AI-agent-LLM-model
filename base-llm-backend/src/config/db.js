// db.js
const mongoose = require("mongoose");
const { MONGO_URI } = require("./server-config");

const options = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected successfully!");
    return true;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    return false;
  }
};

const startDBConnectionWithRetry = async (retries = 5, delayMs = 5000) => {
  const connected = await connectDB();
  if (connected) {
    return;
  }

  if (retries <= 0) {
    console.warn(
      "MongoDB connection unavailable. Continuing without DB for now.",
    );
    return;
  }

  setTimeout(() => {
    startDBConnectionWithRetry(retries - 1, delayMs);
  }, delayMs);
};

module.exports = {
  connectDB,
  startDBConnectionWithRetry,
};
