const IRREGULAR_NORMALIZATIONS = new Map([
  ["had", "have"],
  ["has", "have"],
  ["having", "have"],
  ["booked", "book"],
  ["booking", "book"],
  ["books", "book"],
  ["confirmed", "confirm"],
  ["confirming", "confirm"],
  ["requested", "request"],
  ["requesting", "request"],
  ["scheduled", "schedule"],
  ["scheduling", "schedule"],
  ["valuations", "valuation"],
  ["evaluations", "evaluation"],
]);

function normalizeToken(token) {
  const raw = String(token || "").toLowerCase();
  const compact = raw.replace(/'/g, "");
  if (IRREGULAR_NORMALIZATIONS.has(compact)) return IRREGULAR_NORMALIZATIONS.get(compact);
  if (compact.endsWith("ies") && compact.length > 4) return `${compact.slice(0, -3)}y`;
  if (compact.endsWith("ing") && compact.length > 5) return compact.slice(0, -3);
  if (compact.endsWith("ed") && compact.length > 4) return compact.slice(0, -2);
  if (compact.endsWith("s") && compact.length > 3 && !compact.endsWith("ss")) return compact.slice(0, -1);
  return compact;
}

function tokenizePhrase(phrase) {
  return (String(phrase || "").toLowerCase().match(/[a-z0-9']+/g) || []).map(normalizeToken);
}

function chooseBetterMatch(current, candidate) {
  if (!candidate?.matched) return current;
  if (!current) return candidate;
  if (candidate.count !== current.count) return candidate.count > current.count ? candidate : current;
  const currentSpan = current.end >= current.start ? current.end - current.start + 1 : Number.MAX_SAFE_INTEGER;
  const candidateSpan = candidate.end >= candidate.start ? candidate.end - candidate.start + 1 : Number.MAX_SAFE_INTEGER;
  if (candidateSpan !== currentSpan) return candidateSpan < currentSpan ? candidate : current;
  return candidate.end < current.end ? candidate : current;
}

function parseExpression(text) {
  const source = String(text || "").trim();
  let index = 0;

  function skipSpaces() {
    while (index < source.length && /\s/.test(source[index])) index++;
  }

  function parseSequence(stopChar) {
    const items = [];
    skipSpaces();
    while (index < source.length) {
      if (stopChar && source[index] === stopChar) break;
      items.push(parseAtom());
      skipSpaces();
    }
    if (stopChar && source[index] === stopChar) index++;
    if (items.length === 1) return items[0];
    return { type: "seq", items };
  }

  function parseQuoted() {
    index++;
    let value = "";
    while (index < source.length && source[index] !== '"') {
      value += source[index++];
    }
    if (source[index] === '"') index++;
    const words = (value.toLowerCase().match(/[a-z0-9']+/g) || []).map(normalizeToken);
    return { type: "exact", words };
  }

  function parseOptional() {
    index++;
    let value = "";
    while (index < source.length && source[index] !== "}") {
      value += source[index++];
    }
    if (source[index] === "}") index++;
    return {
      type: "optional",
      words: (value.toLowerCase().match(/[a-z0-9']+/g) || []).map(normalizeToken),
    };
  }

  function parseWord() {
    let value = "";
    while (index < source.length && !/[\s\[\](){}"]/.test(source[index])) {
      value += source[index++];
    }
    return { type: "word", value: normalizeToken(value) };
  }

  function parseAtom() {
    skipSpaces();
    const ch = source[index];
    if (ch === "[") {
      index++;
      const options = [];
      skipSpaces();
      while (index < source.length && source[index] !== "]") {
        options.push(parseAtom());
        skipSpaces();
      }
      if (source[index] === "]") index++;
      return { type: "alt", options };
    }
    if (ch === "(") {
      index++;
      return parseSequence(")");
    }
    if (ch === "{") {
      return parseOptional();
    }
    if (ch === '"') {
      return parseQuoted();
    }
    return parseWord();
  }

  return parseSequence();
}

function findWord(tokens, word, startIndex) {
  for (let i = startIndex; i < tokens.length; i++) {
    if (tokens[i] === word) return i;
  }
  return -1;
}

function findExact(tokens, words, startIndex) {
  if (!words.length) return -1;
  for (let i = startIndex; i <= tokens.length - words.length; i++) {
    let ok = true;
    for (let j = 0; j < words.length; j++) {
      if (tokens[i + j] !== words[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function matchNode(node, tokens, startIndex) {
  if (!node) return { matched: false, count: 0, start: -1, end: -1 };

  if (node.type === "word") {
    const position = findWord(tokens, node.value, startIndex);
    if (position === -1) return { matched: false, count: 0, start: -1, end: -1 };
    return { matched: true, count: 1, start: position, end: position };
  }

  if (node.type === "exact") {
    const position = findExact(tokens, node.words, startIndex);
    if (position === -1) return { matched: false, count: 0, start: -1, end: -1 };
    return {
      matched: true,
      count: node.words.length,
      start: position,
      end: position + node.words.length - 1,
    };
  }

  if (node.type === "optional") {
    let cursor = startIndex;
    let first = -1;
    let last = -1;
    let count = 0;

    for (const word of node.words) {
      const position = findWord(tokens, word, cursor);
      if (position === -1) continue;
      if (first === -1) first = position;
      last = position;
      count++;
      cursor = position + 1;
    }

    return {
      matched: true,
      count,
      start: first === -1 ? startIndex : first,
      end: last,
    };
  }

  if (node.type === "alt") {
    let best = null;
    for (const option of node.options) {
      const result = matchNode(option, tokens, startIndex);
      best = chooseBetterMatch(best, result);
    }
    return best || { matched: false, count: 0, start: -1, end: -1 };
  }

  if (node.type === "seq") {
    let cursor = startIndex;
    let totalCount = 0;
    let first = -1;
    let last = -1;

    for (const item of node.items) {
      const result = matchNode(item, tokens, cursor);
      if (item.type !== "optional" && !result.matched) {
        return { matched: false, count: 0, start: -1, end: -1 };
      }
      if (result.count > 0) {
        if (first === -1) first = result.start;
        last = result.end;
        totalCount += result.count;
        cursor = result.end + 1;
      }
    }

    return {
      matched: true,
      count: totalCount,
      start: first === -1 ? startIndex : first,
      end: last,
    };
  }

  return { matched: false, count: 0, start: -1, end: -1 };
}

function compileLine(line) {
  const trimmed = String(line || "").trim();
  const negativeMatch = trimmed.match(/:-\d+\s*$/);
  const negative = Boolean(negativeMatch);
  const expression = negative ? trimmed.replace(/:-\d+\s*$/, "").trim() : trimmed;
  return {
    raw: trimmed,
    negative,
    optional: /^\{[^{}]+\}$/.test(expression),
    node: parseExpression(expression),
  };
}

function calibrateLocalThreshold(threshold) {
  const parsed = Number.parseFloat(threshold || "0.95");
  if (!Number.isFinite(parsed)) return 0.55;
  return Math.max(0.48, Math.min(0.62, 0.5 + ((parsed - 0.5) * 0.12)));
}

export function scorePhraseAgainstScript(phrase, script, threshold) {
  const tokens = tokenizePhrase(phrase);
  const lines = (script?.lines || []).map(compileLine).filter((line) => line.raw);
  if (!tokens.length || !lines.length) {
    return { matched: false, score: 0, scriptLetter: script?.letter, reason: "empty" };
  }

  let cursor = 0;
  let matchedCount = 0;
  let first = -1;
  let last = -1;
  let requiredMatches = 0;

  for (const line of lines) {
    const result = matchNode(line.node, tokens, cursor);

    if (line.negative) {
      if (result.matched && result.count > 0) {
        return { matched: false, score: 0, scriptLetter: script?.letter, reason: "negative-hit" };
      }
      continue;
    }

    if (!line.optional && !result.matched) {
      return { matched: false, score: 0, scriptLetter: script?.letter, reason: "required-miss" };
    }

    if (result.count > 0) {
      if (first === -1) first = result.start;
      last = result.end;
      matchedCount += result.count;
      cursor = result.end + 1;
      if (!line.optional) requiredMatches++;
    }
  }

  if (first === -1 || last === -1) {
    return { matched: false, score: 0, scriptLetter: script?.letter, reason: "no-anchor" };
  }

  const spanLength = Math.max(1, last - first + 1);
  const densityScore = matchedCount / spanLength;
  const structureBonus = Math.min(0.35, requiredMatches * 0.12);
  const score = Math.min(1, densityScore + structureBonus);
  const localThreshold = calibrateLocalThreshold(threshold);

  return {
    matched: score >= localThreshold && requiredMatches > 0,
    score,
    localThreshold,
    scriptLetter: script?.letter,
    reason: score >= localThreshold ? "matched" : "low-score",
  };
}

export function assignPhrasesToScripts(analysisItems, scripts, threshold) {
  return (Array.isArray(analysisItems) ? analysisItems : []).map((item) => {
    const matches = (Array.isArray(scripts) ? scripts : [])
      .map((script) => scorePhraseAgainstScript(item.phrase, script, threshold))
      .filter((result) => result.matched)
      .sort((a, b) => b.score - a.score);

    const best = matches[0];
    if (item.expectedStatus === "nonrelevant") {
      return {
        phrase: item.phrase,
        status: best ? "pending" : "nonrelevant",
      };
    }

    if (best) {
      return {
        phrase: item.phrase,
        status: "relevant",
        scriptLetter: best.scriptLetter,
      };
    }

    return {
      phrase: item.phrase,
      status: "pending",
    };
  });
}
