// Tethr Script Builder — Express proxy for the Anthropic Claude API.
// Sole purpose: keep ANTHROPIC_API_KEY off the client.
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

// Vercel's @vercel/node runtime parses JSON for us, but locally we still need it.
app.use(express.json({ limit: "10mb" }));

const allowedOrigin = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// All real handlers live on one router so we can mount it at multiple paths.
// This lets the service answer whether or not Vercel's experimentalServices
// route prefix (`/_/backend`) is stripped before the request reaches us.
const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
});

router.post("/api/messages", async (req, res) => {
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

app.use("/", router);
app.use("/_/backend", router);

const PORT = process.env.PORT || 3001;

// Only listen when run directly (e.g. `node server.js` locally).
// On Vercel the file is imported as a serverless function and the export below is used.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[tethr-backend] listening on http://localhost:${PORT} (${process.env.NODE_ENV || "development"})`);
  });
}

module.exports = app;
