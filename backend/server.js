// Tethr Script Builder — local-dev Express proxy for OpenAI and Claude.
// Used by `npm run dev`. In production on Vercel, requests go to
// frontend/api/messages.js instead (this file is NOT deployed to Vercel).
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

function extractOpenAIText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts = [];
  for (const item of data?.output || []) {
    for (const contentItem of item?.content || []) {
      if (typeof contentItem?.text === "string" && contentItem.text) {
        parts.push(contentItem.text);
      }
    }
  }

  return parts.join("\n").trim();
}

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
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
});

app.post("/api/messages", async (req, res) => {
  try {
    const fetchFn =
      typeof fetch === "function"
        ? fetch
        : (...args) => import("node-fetch").then(({ default: f }) => f(...args));
    const { provider = "openai", model, system, content, maxTokens } = req.body || {};

    if (!system || !Array.isArray(content)) {
      return res.status(400).json({ error: "Expected system string and content array." });
    }

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "OPENAI_API_KEY is not set on the server." });
      }

      const upstream = await fetchFn("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4.1",
          instructions: system,
          input: [
            {
              role: "user",
              content: content.map((item) => {
                if (item.type === "text") {
                  return { type: "input_text", text: item.text || "" };
                }
                if (item.type === "image" && item.source?.type === "base64") {
                  return {
                    type: "input_image",
                    image_url: `data:${item.source.media_type || "image/png"};base64,${item.source.data}`,
                    detail: "auto",
                  };
                }
                throw new Error(`Unsupported content item type: ${item.type}`);
              }),
            },
          ],
          max_output_tokens: maxTokens || 8000,
        }),
      });

      const data = await upstream.json();
      if (!upstream.ok) {
        return res.status(upstream.status).json(data);
      }
      const outputText = extractOpenAIText(data);
      return res.json({
        outputText,
        provider: "openai",
        model: model || "gpt-4.1",
        rawResponse: outputText ? undefined : data,
      });
    }

    if (provider === "claude") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
      }

      const upstream = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-sonnet-4-20250514",
          max_tokens: maxTokens || 8000,
          system,
          messages: [{ role: "user", content }],
        }),
      });

      const data = await upstream.json();
      if (!upstream.ok) {
        return res.status(upstream.status).json(data);
      }
      const outputText = (data.content || []).map((b) => b.text || "").join("");
      return res.json({ outputText, provider: "claude", model: model || "claude-sonnet-4-20250514" });
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed", detail: String(err && err.message) });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[tethr-backend] listening on http://localhost:${PORT} (${process.env.NODE_ENV || "development"})`);
});
