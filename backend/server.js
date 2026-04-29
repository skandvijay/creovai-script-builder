// Tethr Script Builder — local-dev Express proxy for the Anthropic Claude API.
// Used by `npm run dev`. In production on Vercel, requests go to
// frontend/api/messages.js instead (this file is NOT deployed to Vercel).
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(express.json({ limit: "10mb" }));

const allowedOrigin = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    env: process.env.NODE_ENV || "development",
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
});

app.post("/api/messages", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  }

  try {
    // Use global fetch on Node 18+; fall back to node-fetch otherwise.
    const fetchFn =
      typeof fetch === "function"
        ? fetch
        : (...args) => import("node-fetch").then(({ default: f }) => f(...args));

    const upstream = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: String(err && err.message) });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[tethr-backend] listening on http://localhost:${PORT} (${process.env.NODE_ENV || "development"})`);
});
