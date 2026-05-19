import { buildPhraseClusters } from "./clusterPhrases.js";

export const parseLines = (text) =>
  String(text || "")
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.)]\s*/, "").trim())
    .filter(Boolean);

export const normalizePhrase = (text) => String(text || "").replace(/\s+/g, " ").trim();

export function dedupeBy(items, keyFn) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

export function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const ratioString = (num, den) => (den ? (num / den).toFixed(2) : "1.00");

export function parseCSV(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }

    cols.push(cur.trim());
    return {
      def: cols[0] || "",
      phrase: cols[1] || "",
      status: (cols[2] || "").toLowerCase().replace(/[\s-]/g, ""),
      notes: cols[3] || "",
    };
  }).filter((row) => row.phrase);
}

export function collectPhraseInputs({ inputMode, relText, nonText, csvRows }) {
  if (inputMode === "csv" && Array.isArray(csvRows)) {
    const analysisItems = dedupeBy(
      csvRows.map((row) => {
        const phrase = normalizePhrase(row.phrase);
        const status = row.status === "relevant"
          ? "relevant"
          : row.status === "nonrelevant" || row.status === "non-relevant"
          ? "nonrelevant"
          : "pending";
        return { phrase, expectedStatus: status, notes: row.notes || "" };
      }),
      (item) => `${item.expectedStatus}::${item.phrase}`
    );

    const approved = dedupeBy(
      analysisItems.filter((item) => item.expectedStatus === "relevant"),
      (item) => item.phrase
    ).map((item) => item.phrase);
    const pending = dedupeBy(
      analysisItems.filter((item) => item.expectedStatus === "pending"),
      (item) => item.phrase
    ).map((item) => item.phrase);
    const nonRelevant = dedupeBy(
      analysisItems.filter((item) => item.expectedStatus === "nonrelevant"),
      (item) => item.phrase
    ).map((item) => item.phrase);

    return {
      approved,
      pending,
      nonRelevant,
      generationRelevant: dedupeBy([...approved, ...pending], (item) => item),
      analysisItems,
      clusters: buildPhraseClusters(analysisItems),
    };
  }

  const approved = dedupeBy(parseLines(relText).map(normalizePhrase), (item) => item);
  const nonRelevant = dedupeBy(parseLines(nonText).map(normalizePhrase), (item) => item);
  const analysisItems = [
    ...approved.map((phrase) => ({ phrase, expectedStatus: "relevant" })),
    ...nonRelevant.map((phrase) => ({ phrase, expectedStatus: "nonrelevant" })),
  ];

  return {
    approved,
    pending: [],
    nonRelevant,
    generationRelevant: approved,
    analysisItems,
    clusters: buildPhraseClusters(analysisItems),
  };
}
