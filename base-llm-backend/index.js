// backend-server.js
const express = require("express");
const cors = require("cors");

const path = require("node:path");
// const mongoose = require("mongoose");
// const morgan = require("morgan");
const dns = require("node:dns");

const bcrypt = require("bcryptjs");
const Organization = require("./src/models/Organization");
const User = require("./src/models/User");
const { aiRoutes, authRoutes } = require("./src/routes");
const organizationRoutes = require("./src/routes/organizationRoutes");
const chatRoutes = require("./src/routes/chatRoutes");
const { startDBConnectionWithRetry } = require("./src/config/db");
const { PORT } = require("./src/config/server-config");
const morgan = require("morgan");
dns.setServers(["8.8.8.8", "1.1.1.1", "0.0.0.0"]);

const app = express();

// CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3008",
      "http://localhost:5173",
      "http://localhost:3009",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

app.use(express.json());
const seedDefaultData = async () => {
  try {
    const defaultOrgEmail =
      process.env.DEFAULT_ORG_EMAIL || "default-org@example.com";
    const defaultOrgName =
      process.env.DEFAULT_ORG_NAME || "Default Organization";
    const defaultAdminEmail =
      process.env.DEFAULT_ADMIN_EMAIL || "admin@example.com";
    const defaultAdminPassword =
      process.env.DEFAULT_ADMIN_PASSWORD || "Password123!";

    let organization = await Organization.findOne({ email: defaultOrgEmail });
    if (!organization) {
      organization = await Organization.create({
        name: defaultOrgName,
        email: defaultOrgEmail,
      });
      console.log("Created default organization:", defaultOrgEmail);
    }

    let user = await User.findOne({ email: defaultAdminEmail });
    if (!user) {
      const passwordHash = await bcrypt.hash(defaultAdminPassword, 12);
      user = await User.create({
        email: defaultAdminEmail,
        passwordHash,
        role: "admin",
        organizationId: organization._id,
      });
      console.log("Created default admin user:", defaultAdminEmail);
      console.log("Admin password:", defaultAdminPassword);
    }
  } catch (err) {
    console.error("Error seeding default data:", err);
  }
};

startDBConnectionWithRetry();
app.use(morgan("dev"));

// Actual route handlers
app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/ai/organizations", organizationRoutes);
app.use("/api/ai/chats", chatRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "Backend server is running",
    timestamp: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Actual backend running on http://localhost:${PORT}`);
});
