export default async function handler(req, res) {
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

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let body = req.body;
  if (body == null || (typeof body === "string" && body.length === 0)) {
    body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  try {
    const { provider = "openai", model, system, content, maxTokens } = body || {};

    if (!system || !Array.isArray(content)) {
      return res.status(400).json({ error: "Expected system string and content array." });
    }

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "OPENAI_API_KEY is not set on the server." });
      }

      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4.1",
          instructions: system,
          text: {
            format: {
              type: "json_object",
            },
          },
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
      return res.status(200).json({
        outputText,
        provider: "openai",
        model: model || "gpt-4.1",
        status: data.status,
        incompleteDetails: data.incomplete_details,
        rawResponse: outputText ? undefined : data,
      });
    }

    if (provider === "claude") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
      }

      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
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
      return res.status(200).json({ outputText, provider: "claude", model: model || "claude-sonnet-4-20250514" });
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (err) {
    res.status(502).json({
      error: "Upstream request failed",
      detail: String(err && err.message),
    });
  }
}
