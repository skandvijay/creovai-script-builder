const STOP_WORDS = new Set([
  "a", "an", "and", "are", "be", "for", "from", "has", "have", "how", "i",
  "if", "in", "is", "it", "let", "me", "my", "of", "on", "or", "our",
  "please", "so", "that", "the", "their", "them", "there", "this", "to",
  "us", "we", "what", "when", "with", "would", "you", "your",
]);

function tokenizePhrase(phrase) {
  return String(phrase || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function getContentTokens(tokens) {
  const content = tokens.filter((token) => !STOP_WORDS.has(token));
  return content.length ? content : tokens;
}

function inferIntent(tokens) {
  if (!tokens.length) return "other";
  const joined = ` ${tokens.join(" ")} `;

  if (/(^|\s)(can|could|would|will|may|shall)\s+(i|we)\b/.test(joined) || joined.includes(" let me ")) {
    return "offer";
  }
  if (/(^|\s)(can|could|would|will|may)\s+you\b/.test(joined)) {
    return "request";
  }
  if (tokens[0] === "how" || tokens[0] === "what" || tokens[0] === "when" || tokens[0] === "why" || tokens[0] === "who") {
    return "question";
  }
  if (tokens.includes("confirm") || tokens.includes("confirmed") || tokens.includes("confirming") || joined.includes(" just to confirm ")) {
    return "confirm";
  }
  if (tokens.includes("not") || tokens.includes("dont") || tokens.includes("don't") || tokens.includes("isnt") || tokens.includes("isn't") || tokens.includes("wasnt") || tokens.includes("wasn't")) {
    return "negation";
  }
  if (tokens.includes("need") || tokens.includes("want") || tokens.includes("wanna")) {
    return "request";
  }
  if (tokens.includes("have") || tokens.includes("has") || tokens.includes("had") || tokens.includes("is") || tokens.includes("are")) {
    return "state";
  }
  return "statement";
}

function buildAnchorSignature(tokens) {
  return getContentTokens(tokens).slice(0, 4).join(" ");
}

export function buildPhraseClusters(items) {
  const clusters = new Map();

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const tokens = tokenizePhrase(item.phrase);
    const intent = inferIntent(tokens);
    const anchors = buildAnchorSignature(tokens);
    const key = `${item.expectedStatus || "unknown"}::${intent}::${anchors || tokens.slice(0, 4).join(" ")}`;

    if (!clusters.has(key)) {
      clusters.set(key, {
        id: `cluster-${clusters.size + 1}`,
        expectedStatus: item.expectedStatus || "unknown",
        intent,
        anchors: anchors ? anchors.split(" ") : [],
        items: [],
        firstIndex: index,
      });
    }

    clusters.get(key).items.push(item);
  });

  return Array.from(clusters.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((cluster) => ({
      ...cluster,
      samplePhrases: cluster.items.slice(0, 3).map((item) => item.phrase),
      count: cluster.items.length,
    }));
}

export function formatClusterSummary(clusters) {
  return (Array.isArray(clusters) ? clusters : [])
    .map((cluster, index) => {
      const anchors = cluster.anchors.length ? cluster.anchors.join(", ") : "none";
      const samples = cluster.samplePhrases.map((phrase) => `  - ${phrase}`).join("\n");
      return [
        `Cluster ${index + 1}`,
        `Status: ${cluster.expectedStatus}`,
        `Intent: ${cluster.intent}`,
        `Count: ${cluster.count}`,
        `Anchors: ${anchors}`,
        "Samples:",
        samples,
      ].join("\n");
    })
    .join("\n\n");
}
