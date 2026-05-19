function isStandaloneBridgeLine(line) {
  return /^\{[^{}]+\}$/.test(String(line || "").trim());
}

function getLineWords(line) {
  return String(line || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function hasBalancedSyntax(line) {
  const stack = [];
  const pairs = { "]": "[", ")": "(", "}": "{" };
  let inQuote = false;

  for (const ch of String(line || "")) {
    if (ch === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === "[" || ch === "(" || ch === "{") stack.push(ch);
    if (ch === "]" || ch === ")" || ch === "}") {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }

  return !stack.length && !inQuote;
}

function sanitizeBridgeWords(line, prevLine, nextLine, label) {
  const inner = String(line || "").trim().slice(1, -1);
  const bridgeWords = inner.split(/\s+/).map((word) => word.trim()).filter(Boolean);
  const neighboringWords = new Set([...getLineWords(prevLine), ...getLineWords(nextLine)]);
  const keptWords = [];
  const warnings = [];

  for (const word of bridgeWords) {
    if (!/^[a-z0-9']+$/i.test(word)) {
      warnings.push(`${label}: removed invalid bridge token ${word}`);
      continue;
    }
    if (neighboringWords.has(word.toLowerCase())) {
      warnings.push(`${label}: removed duplicate bridge token ${word}`);
      continue;
    }
    keptWords.push(word);
  }

  if (!keptWords.length) {
    warnings.push(`${label}: removed bridge line because no valid optional words remained`);
    return { line: null, warnings };
  }

  return { line: `{${keptWords.join(" ")}}`, warnings };
}

function repairScriptLines(lines, label) {
  let repaired = Array.isArray(lines)
    ? lines.map((line) => String(line ?? "").trim()).filter(Boolean)
    : [];
  const warnings = [];

  while (repaired.length && isStandaloneBridgeLine(repaired[0])) {
    warnings.push(`${label}: removed leading bridge line ${repaired[0]}`);
    repaired = repaired.slice(1);
  }
  while (repaired.length && isStandaloneBridgeLine(repaired[repaired.length - 1])) {
    warnings.push(`${label}: removed trailing bridge line ${repaired[repaired.length - 1]}`);
    repaired = repaired.slice(0, -1);
  }

  const normalized = [];
  for (let i = 0; i < repaired.length; i++) {
    const line = repaired[i];

    if (!hasBalancedSyntax(line)) {
      warnings.push(`${label}: possible unbalanced syntax in line ${i + 1}: ${line}`);
    }

    if (!isStandaloneBridgeLine(line)) {
      normalized.push(line);
      continue;
    }

    const prevLine = normalized[normalized.length - 1];
    const nextLine = repaired[i + 1];
    if (!prevLine || !nextLine || isStandaloneBridgeLine(prevLine) || isStandaloneBridgeLine(nextLine)) {
      warnings.push(`${label}: removed misplaced bridge line ${line}`);
      continue;
    }

    const bridgeResult = sanitizeBridgeWords(line, prevLine, nextLine, label);
    warnings.push(...bridgeResult.warnings);
    if (bridgeResult.line) normalized.push(bridgeResult.line);
  }

  return { lines: normalized, warnings };
}

function sanitizeScriptList(scripts, listLabel) {
  const warnings = [];
  const sanitized = [];

  for (const script of Array.isArray(scripts) ? scripts : []) {
    const label = `${listLabel} ${script?.letter || "?"}`;
    const { lines, warnings: lineWarnings } = repairScriptLines(script?.lines, label);
    warnings.push(...lineWarnings);
    if (!lines.length) {
      warnings.push(`${label}: removed script because no valid anchor lines remained after repair`);
      continue;
    }
    sanitized.push({ ...script, lines });
  }

  return { scripts: sanitized, warnings };
}

export function sanitizeBuildResult(result) {
  if (!result || !Array.isArray(result.scripts)) return result;
  const { scripts, warnings } = sanitizeScriptList(result.scripts, "Script");
  return {
    ...result,
    scripts,
    warnings: [...(Array.isArray(result.warnings) ? result.warnings : []), ...warnings],
  };
}

export function sanitizeCompareResult(result) {
  if (!result || !Array.isArray(result.improvedScripts)) return result;
  const { scripts, warnings } = sanitizeScriptList(result.improvedScripts, "Improved script");
  return {
    ...result,
    improvedScripts: scripts,
    warnings: [...(Array.isArray(result.warnings) ? result.warnings : []), ...warnings],
  };
}

export function sanitizeCustomResult(result) {
  if (!result) return result;
  const updated = sanitizeScriptList(result.updatedScripts || [], "Updated script");
  const added = sanitizeScriptList(result.newScripts || [], "New script");
  return {
    ...result,
    updatedScripts: updated.scripts,
    newScripts: added.scripts,
    warnings: [...(Array.isArray(result.warnings) ? result.warnings : []), ...updated.warnings, ...added.warnings],
  };
}
