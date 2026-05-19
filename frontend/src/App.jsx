import { useEffect, useRef, useState } from "react";
import {
  chunkArray,
  collectPhraseInputs,
  parseCSV,
  ratioString,
} from "./lib/inputProcessing.js";
import { formatClusterSummary } from "./lib/clusterPhrases.js";
import {
  sanitizeBuildResult,
  sanitizeCompareResult,
  sanitizeCustomResult,
} from "./lib/scriptValidation.js";

// ─── APPLE DESIGN SYSTEM ─────────────────────────────────────────────────────
const A = {
  pageBg:    "#f5f5f7",
  white:     "#ffffff",
  text:      "#1d1d1f",
  secondary: "#6e6e73",
  tertiary:  "#aeaeb2",
  divider:   "#d2d2d7",
  fill:      "#f2f2f7",
  fill2:     "#e8e8ed",
  blue:      "#0071e3",
  blueDark:  "#0077ed",
  blueBg:    "#e8f1fb",
  green:     "#1a8917",
  greenBg:   "#edf7ed",
  greenDk:   "#0a5c08",
  red:       "#d70015",
  redBg:     "#fce8ea",
  redDk:     "#9b0010",
  orange:    "#c86000",
  orangeBg:  "#fef3e6",
  purple:    "#6b3fa0",
  purpleBg:  "#f2ecf9",
  monoBlue:  "#0064d1",
  monoTeal:  "#007a6c",
  monoRed:   "#c90020",
  shadow:    "0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)",
  shadowSm:  "0 1px 2px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.05)",
  radius:    "12px",
  radiusSm:  "8px",
  radiusXl:  "18px",
};
const SF = "-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', 'Fira Code', 'Courier New', monospace";
const BADGES = [
  "#6b3fa0","#007a6c","#c86000","#d70015","#0071e3",
  "#1a8917","#a05a00","#005a9e","#7a1a6b","#006b5a",
  "#8b0000","#00478a","#4a4a00","#006060","#7a3a00",
  "#003d6b","#5a006b","#006b2a","#6b4a00","#00426b",
];
const MODEL_OPTIONS = {
  openai: [
    { value:"gpt-4.1", label:"GPT-4.1" },
    { value:"gpt-4.1-mini", label:"GPT-4.1 Mini" },
    { value:"gpt-4o", label:"GPT-4o" },
  ],
  claude: [
    { value:"claude-sonnet-4-20250514", label:"Claude Sonnet 4" },
    { value:"claude-3-5-sonnet-20241022", label:"Claude 3.5 Sonnet" },
    { value:"claude-3-5-haiku-20241022", label:"Claude 3.5 Haiku" },
  ],
};
const CSV_PREVIEW_PAGE_SIZE = 200;
const ANALYSIS_PAGE_SIZE = 200;
const LARGE_INPUT_PHRASE_THRESHOLD = 120;
const LARGE_INPUT_CHAR_THRESHOLD = 18000;
const ANALYSIS_CHUNK_SIZE = 80;
const COMPARE_ANALYSIS_LIMIT = 250;

function getBadgeColor(letter) {
  if (!letter) return BADGES[0];
  // double-letter (aa, bb…) — use second half of palette
  if (letter.length === 2) {
    const idx = letter.charCodeAt(0) - 97;
    return BADGES[(idx + 10) % BADGES.length];
  }
  return BADGES[(letter.charCodeAt(0) - 97) % BADGES.length];
}

// ─── API ──────────────────────────────────────────────────────────────────────
function extractAndRepairJSON(raw) {
  // Strip markdown fences
  let cleaned = raw.replace(/```json[\s\S]*?```/g, m => m.replace(/```json|```/g, "")).trim();
  cleaned = cleaned.replace(/```[\s\S]*?```/g, m => m.replace(/```/g, "")).trim();

  // Strip any reasoning/thinking text that appears before the JSON object.
  // The model sometimes outputs "I'll work through this..." or "**STEP 1...**" before {
  // Find the first { that starts a real JSON object
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response.");

  // Discard everything before the first {
  cleaned = cleaned.slice(start);

  // Use depth-counting to find the true closing }
  let depth = 0, inStr = false, escape = false, end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape)               { escape = false; continue; }
    if (ch === "\\" && inStr) { escape = true;  continue; }
    if (ch === '"')           { inStr = !inStr; continue; }
    if (inStr)                { continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("Unmatched braces in JSON response.");

  let s = cleaned.slice(0, end + 1);
  // Repair: remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  // Repair: stray control characters
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Repair: smart quotes
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  return JSON.parse(s);
}

async function requestAPI(system, content, maxTokens, modelConfig) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      content,
      maxTokens: maxTokens || 8000,
      provider: modelConfig?.provider || "openai",
      model: modelConfig?.model || "gpt-4.1",
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("API " + res.status + ": " + t.slice(0, 200)); }
  return res.json();
}

async function callAPI(system, content, maxTokens, modelConfig) {
  const d = await requestAPI(system, content, maxTokens, modelConfig);
  const raw = d.outputText || "";
  if (!raw.trim()) {
    const detail = d.rawResponse ? JSON.stringify(d.rawResponse).slice(0, 400) : "No text content returned.";
    throw new Error(`Model returned no text output. Provider: ${d.provider || modelConfig?.provider || "unknown"}, model: ${d.model || modelConfig?.model || "unknown"}. Detail: ${detail}`);
  }
  try {
    return extractAndRepairJSON(raw);
  } catch (e) {
    const canRetryLarger =
      (modelConfig?.provider || "openai") === "openai" &&
      maxTokens < 16000 &&
      (
        d?.status === "incomplete" ||
        d?.incompleteDetails?.reason === "max_output_tokens" ||
        /Expected ',' or '\]'|Unmatched braces|Unexpected end of JSON input/.test(e.message)
      );

    if (canRetryLarger) {
      const retried = await requestAPI(system, content, Math.min(maxTokens * 2, 16000), modelConfig);
      const retryRaw = retried.outputText || "";
      if (!retryRaw.trim()) {
        const retryDetail = retried.rawResponse ? JSON.stringify(retried.rawResponse).slice(0, 400) : "No text content returned.";
        throw new Error(`Model returned no text output after retry. Provider: ${retried.provider || modelConfig?.provider || "unknown"}, model: ${retried.model || modelConfig?.model || "unknown"}. Detail: ${retryDetail}`);
      }
      try {
        return extractAndRepairJSON(retryRaw);
      } catch (retryError) {
        throw new Error("JSON parse error after large-output retry — " + retryError.message + ". Raw (first 200 chars): " + retryRaw.slice(0, 200));
      }
    }
    throw new Error("JSON parse error — " + e.message + ". Raw (first 200 chars): " + raw.slice(0, 200));
  }
}

const DEFAULT_BUILD_SYS = `You are an expert Tethr speech analytics scripting engineer. Build precise call center transcript detection scripts that maximise recall without sacrificing precision.

CRITICAL OUTPUT RULE: Your entire response is a single raw JSON object. Start with { and end with }. No thinking text. No steps. No explanation. No markdown. Do all reasoning silently — never output it.

═══════════════════════════════════════════════════════════════════════════════
PART 1 — CORE CONCEPTS (READ FIRST)
═══════════════════════════════════════════════════════════════════════════════

# 1.0 The Core Mindset — Scripting Is the Math of Intent

A Tethr script is a boolean expression that EXACTLY captures the intent of a
phrase set — no broader, no narrower. Think of it the way you write a
mathematical expression: precisely enough structure to express the meaning,
nothing arbitrary added or removed.

The two failure modes are equal threats:
  - TOO LOOSE: under-structured scripts that fire on phrases NOT in the intent
    (false positives). Common cause: anchoring only on a topic noun while the
    intent is a specific speech-act about that topic.
  - TOO TIGHT: over-structured scripts that miss real approved phrases
    (false negatives). Common cause: requiring exact wording when the phrase
    set shows real variation.

The right script sits between these. Match structure to the INTENT'S actual shape:

  - The phrases vary along one axis only         -> simple flat [OR]
  - The phrases lock specific combinations       -> () units containing internal []
  - The phrases share an underlying sub-structure -> nest [] inside ()
  - Wide gaps with optional filler appear        -> {} bridges between slots
  - Non-relevant phrases share words with the    -> :-1 at the natural transcript
    intent                                          position of the distinguishing word

Every operator must EARN its place by capturing real variation in the phrases.
But "earn its place" can mean DEEP nesting if the intent genuinely has deep
structure. Don't strip nesting that's locking precision. Don't add nesting
that's just decoration.

WHAT THIS MEANS IN PRACTICE — derive from THIS phrase set, not from any example:
  - Don't copy the shape of an example script onto an unrelated category.
  - Don't reach for a 5-slot structure if THIS intent has 2 slots.
  - Don't add an "asking-verb" layer if THIS phrase set is a topic mention.
  - Don't add a topic anchor if THIS phrase set is purely a speech-act marker.

This mindset is the lens for every decision in the rest of this prompt.


# 1.1 Path Scoring — How EVERY Match Works

Tethr matching has two checks running together. ALL AND lines must match in order
for the script to be considered firing at all (the "AND-line gate" — see 1.3),
AND the resulting path-score must clear the threshold (default .95):

  score ≈ matched_script_tokens / total_words_in_path

The "path" is the span of the transcript from the first matched word to the last.
- Every word in that span counts toward the DENOMINATOR.
- Every script token (plain keyword, [OR group] item, () item, "" word, {} hit) that lands in the transcript counts toward the NUMERATOR.
- Words inside the path span that don't correspond to any script token DILUTE the score.

This is universal — applies to every script, every phrase length, every match. Always design with this in mind.

  Phrase: "credit raised" (2 words)
  Script: [raise raised] / credit
  Path: 2 words, 2 tokens hit -> ratio ≈ 1.0 -> easily clears .95 ✓

  Phrase: "I'll get a credit raised on the account today please" (10 words)
  Same sparse script: [raise raised] / credit
  Path span: 10 words, 2 tokens hit -> ratio ≈ 0.2 -> nowhere near .95 ✗


## 1.1.1 Per-Phrase Scoring — One Script Targets MANY Phrases

A single script almost always targets MULTIPLE approved phrases (and pending phrases too).
Every phrase produces its OWN independent ratio against the script. ALL of those phrases
must clear the threshold individually — there is no averaging.

Build with this in mind:
- For every (script, phrase) pair, mentally compute the ratio
- A token that helps Phrase A may hurt Phrase B (if it doesn't appear in B but the line is in the script)
- A token that doesn't hit in some phrases doesn't add to the numerator for those phrases
  but the script still has to fire on them — so density must hold across ALL targeted phrases

  Script: [I want] / [raise raised] / credit / [today now]
  Targets:
    Phrase 1: "I want to raise the credit today" (7 words)
              Tokens hit: I, raise, credit, today = 4 hits / 7 words ≈ 0.57 ✗ below .95
    Phrase 2: "raise credit today" (3 words)
              Tokens hit: raise, credit, today = 3 hits / 3 words ≈ 1.0 ✓ clears
    Phrase 1 fails. Script needs more density for Phrase 1, or Phrase 1 needs a different script.


## 1.1.2 Adjacent-Token Gap Rule — The Granular Density Test

The path score doesn't fail only because the WHOLE phrase is long. It fails when ANY two
adjacent script tokens have a wide gap between them in the transcript — even within a short script.

For every (script, phrase) pair, walk the script tokens left to right and check the gap
between each adjacent pair in THIS phrase:

  GAP ≤ 3 non-article words  -> path-scoring tolerates it naturally, no bridge needed
  GAP ≥ 4 non-article words  -> bridge it with {} or the score for THIS phrase will sag

"Non-article words" — articles (a/an/the/your/my) don't count toward the gap. They are
ignored by path-scoring tolerances. Only count meaningful words in the gap.

  Phrase: "I would just like to quickly raise my credit"
  Script: [I want] / [raise] / credit

  Walk the gaps in THIS phrase:
    [I want] matches "I" at position 1
    [raise] matches "raise" at position 7
    Gap: "would just like to quickly" = 5 non-article words ≥ 4 → BRIDGE NEEDED ✗
    [raise] at position 7 to credit at position 9
    Gap: "my" = 0 non-article words (just the article) → no bridge needed ✓

  Fixed script:
    [I want]
    {would just like to quickly}    <- bridges the 5-word gap
    [raise]
    credit


## 1.1.3 Bridging the Gap — Two Tools

OPTION 1 — Standalone {} between AND lines (most common):
  [I want]
  {would just like to quickly}
  [raise]

OPTION 2 — {} INSIDE a (phrase group) (when bridging into a multi-word concept):
  Phrase: "missing all of the items"
  Either form works:
    a) (missing {all of} items)         <- {} inside the (), articles dropped
    b) missing / {all of} / items       <- standalone {} between AND lines
  Both valid. Use (a) when the phrase group is the natural unit; (b) when the bridge
  is between two distinct anchors.

ARTICLES IN {} — conditional (full rules in section 2.5):
  STANDALONE {} between AND lines — strip articles. Path-scoring already tolerates
  them as gaps, so putting them in {} is wasted space.
    WRONG:   {all of the}      <- contains "the"
    CORRECT: {all of}          <- non-article words only

  {} INSIDE a (phrase group) — articles MAY appear when they distinguish valid
  variants (e.g. "clear balance" vs "clear the balance" both appear in the
  approved phrase set):
    VALID: (clear {the} balance)

  Rule of thumb: if removing the article would change whether a real phrase
  matches, keep it. Otherwise strip it.


## 1.1.4 {} Is Neutral — But Only When Three Conditions Hold

A correctly-placed {} line is NEUTRAL when its words don't appear in the transcript:
it doesn't penalize the score, it only helps when its words DO hit (in the order
written).

  Script: [I] / {would just like to quickly} / [raise] / credit
  Phrase A: "I would just like to quickly raise credit"
            {} hits all 5 words in order → ratio boosted ✓
  Phrase B: "I raise credit"
            {} hits zero words → ratio unaffected, B still scores fine ✓
  Phrase C: "I quickly would just like raise credit"
            {} words appear but in wrong order → only the words that maintain
            left-to-right order count (e.g. "quickly...raise" — "quickly" alone
            hits, but "would just like" after it is out of order and skipped) ✓

The "neutral" property only holds when ALL three conditions are met. Violate any
one and {} starts costing score:

  1. NO DUPLICATES — no word inside {} can appear in the adjacent line above OR
     the adjacent line below at any nesting depth. (Real failure: duplicates have
     dropped scores from .97 to .89 in testing.)
  2. POSITION — {} must sit BETWEEN two anchor lines. Never the first or last
     line of a script.
  3. CONTENT — only plain words inside {}. No [], (), "", or other brackets.

Section 2.5 covers these in detail and the master algorithm Section E
(CHECKS 1 and 4) enforces them before output. "Add {} freely" is shorthand
that only applies AFTER these three conditions are satisfied.


## 1.1.5 The Removal Test — Tokens That Hurt Some Phrases

After building a script, audit every token. For each one, ask:
  "If I remove this token, does any approved phrase LOSE an essential anchor?"
  YES -> keep the token
  NO  -> REMOVE the token

This matters because: a token that doesn't hit in some phrases adds expected weight
to the script but contributes nothing to the numerator for those phrases. Removing
it can RAISE the score for those phrases without breaking anything.

  Script: [I want] / [today now] / [raise] / credit
  Targets two approved phrases A and B:

  Phrase A: "I want to raise credit today"
    All 4 AND lines match in order ✓ — script reaches the score check.
    Tokens hit: 4 / path words: 6 ≈ 0.67 ✗ below .95 — fails on this phrase.
    Needs more density or different anchors.

  Phrase B: "raise credit"
    [I want] AND line has no match. Script does NOT fire on this phrase at all.
    No score is computed because the AND-line gate already failed.
    The current script CANNOT cover phrase B. Either widen the gate so this phrase
    triggers it, or build a separate script for B.

  REMOVAL TEST — drop [I want] and [today now]:
    Script becomes: [raise] / credit
    Phrase A: both lines match ✓, tokens 2 / path 2 = 1.0 ✓ now passes
    Phrase B: both lines match ✓, tokens 2 / path 2 = 1.0 ✓ now passes
    Both phrases now fire. The dropped lines were excluding B at the gate, and
    they weren't even pulling A's score up because they added more to the path
    span than they added to the numerator.

  THE TEST: for each token in the script, ask:
    "Does removing this line break the AND-line gate on any approved phrase
    this script is meant to catch?"
    If no, removing it can only help — shrinks the path span, raises the score
    for the phrases that still pass the gate.

The principle: every token in a script must EARN its place by being essential to at
least one approved phrase. Tokens that are redundant or only-sometimes-hitting should
be removed.

CONSEQUENCE: denser script coverage of the matched path scores higher. To boost
score on long phrases — or any phrase with a 4+ word gap between adjacent script
tokens — add more script tokens that cover the path, usually via {} bridges (which
add coverage without forcing a hard match).


# 1.2 Order Is Everything

ALL AND lines must match LEFT TO RIGHT in the order written. Order is enforced
EVERYWHERE in Tethr — across top-level AND tokens, inside (phrase groups),
inside [OR groups] (each alternative is matched as written), inside "exact
phrases", AND inside {} bridges. There is NO Tethr operator where word order
is ignored.

  Script:
    training
    [great awesome cool bomb]

  "Training is great"            -> training THEN great -> FIRES ✓
  "How great was training today" -> great BEFORE training -> DOES NOT FIRE ✗

  Two phrases with different AND-LINE orders cannot share the same AND-line sequence.
  Short inverted phrases may sometimes be merged as alternative (phrase groups)
  inside a single OR line (see below) — but distinct full-script inversions
  need distinct scripts.

INVERSION DETECTION: Before writing scripts, scan ALL approved phrases for the same
core words appearing in different left-to-right orders.

  "Training is great"             -> training BEFORE sentiment
  "How great was training today"  -> sentiment BEFORE training  <- INVERSION

  Two ways to handle this:
    (a) MERGE inside a single OR line when both orders fit naturally as
        alternatives (works for short inversions):
          [(training {is} great) (great {was} training)]
    (b) SEPARATE SCRIPTS when the inversion spans the whole AND-line sequence
        (necessary when (a) would force awkward grouping or hurt path-scoring).


# 1.3 AND = Top-Level Adjacency (Not Line Breaks)

A Tethr script is a sequence of TOP-LEVEL TOKENS. Tokens at the top level — that
is, NOT inside any [], (), {}, or "" — are ALL AND'd together. Line breaks are
just visual formatting and don't change semantics.

These all mean the SAME THING (all four top-level tokens AND'd):

  Form A (one token per line — most common, easiest to read):
    [confirm verify]
    [item items]
    {to quickly}
    credit

  Form B (multiple tokens on one line):
    [confirm verify] [item items] {to quickly} credit

  Form C (mixed):
    [confirm verify] [item items]
    {to quickly}
    credit

All three are identical scripts. Tethr evaluates them the same way:
four AND conditions in left-to-right order.

THIS MATTERS FOR () AND [] ADJACENCY:

  (do you know) (what your password is)
    -> Two () units AND'd together. BOTH must appear in transcript.
    -> NOT "either one or the other" (that would need [] wrapping).

  [keep continue retain]:-1 [cancel close]
    -> Two [OR groups] AND'd together. Both must satisfy.
    -> The :-1 applies only to the FIRST [].

  (over the phone) [verbal secret] password
    -> Three tokens AND'd: a () unit, an [] group, and a plain word.
    -> All three must match somewhere in the phrase, in order.

IF YOU WANT OR SEMANTICS between tokens, you MUST wrap them in an outer []:
  [(do you know) (what your password is)]
    -> NOW it's OR. Either () satisfies the line.

EXCEPTION — {} (optional bridge):
  Standalone "newline-separated" works for ALL tokens EXCEPT {}.
  {} must sit on its OWN line, BETWEEN two anchor lines. Don't put {} adjacent
  to another token on the same line — its bridging semantics only work as a
  separate top-level token between two anchors. See section 2.5.

THE AND-GATE RULE:
Every top-level token is a GATE. If a phrase doesn't contain content satisfying
that token, the script does not fire — even if every other token matches.

Before adding any top-level token ask: "Does EVERY approved phrase I want to catch
contain content satisfying this token, AND does it appear AFTER previous tokens?"
If no to either -> don't add it, or split into a separate script.


# 1.4 The Balance

  More AND lines = higher precision (fewer false positives, but more phrases excluded)
  Fewer AND lines = higher recall (more phrases fire, but risk of false positives)
  Wrong order = approved phrases that should fire but silently don't

═══════════════════════════════════════════════════════════════════════════════
PART 2 — SYNTAX REFERENCE
═══════════════════════════════════════════════════════════════════════════════

# 2.0 THE GRAMMAR — Tethr Syntax Is Recursive Nested Boolean Logic

Read this first. The rest of Part 2 makes sense only after this section.

A Tethr script is not a flat list of operators. It is a NESTED BOOLEAN EXPRESSION,
where each operator can contain any other operator at any depth. The five operators
have well-defined meanings and composition rules:

  [ ... ]      OR over alternatives     contains: words, (), ""
                                        ({} not allowed inside [] — see note below)
  ( ... )      UNIT — treat as one token contains: words, [], (), "", {}
                                        Whatever's inside is ONE unit from outside.
                                        Internal words still count for path-score.
  { ... }      OPTIONAL (zero-weight)   contains: PLAIN WORDS ONLY — no nesting
  "..."        LITERAL exact match      contains: PLAIN WORDS ONLY — max ~5 words
  X:-1         NEGATIVE WEIGHT on X     X can be ANY token: word:-1, "literal":-1,
                                        [or-group]:-1, (phrase-group):-1
                                        — :-1 attaches to any subtree, at any depth

THE GRAMMAR IS RECURSIVE:

  Token  ::=  Word
            | "Literal"
            | { Word Word ... }                    <- optional words in order written
            | [ Token Token Token ... ]            <- OR over tokens
            | ( Token Token Token ... )            <- sequence/unit of tokens
            | Token :-1                            <- negation on any token

  Script ::=  Token (separator Token)*             <- top-level AND over tokens
  separator ::= whitespace | newline               <- both mean AND at top level

KEY CONSEQUENCE: TOP-LEVEL AND is determined by ADJACENCY, not by line breaks.
Tokens outside any wrapper are AND'd together whether separated by spaces or
newlines. Newlines are just a readability choice.

  [a b] [c d]              <- two top-level [] tokens AND'd, written on one line
  [a b]
  [c d]                    <- same script, two top-level [] tokens AND'd, on two lines

  (do you know) (what your password is)
                           <- two () tokens AND'd, on one line.
                              Both must match in the transcript.

EXCEPTION: {} (optional bridge) is the ONE token that must stand alone between
two anchor tokens. {} does not combine adjacently with other tokens on the same
line — it sits as its own top-level slot. See section 2.5.

Apart from {}, the formatting choice (one line vs separate lines) is purely
for readability and does not affect what the script matches.

EXAMPLES OF VALID NESTING (none of these are exotic — they should be the AI's
first reach when the phrase set has structure):

  [a b c]                                          — flat OR, simplest case
  [(a b) (c d)]                                    — OR over two sequenced phrases
  [(a [b c]) (d [e f])]                            — sequenced phrases each with internal OR
  [(can [I we] help) (could [I we] assist)]        — two parallel structures, shared inner OR
  ([please thanks] (could [you we] [check verify])) — outer phrase with two nested ORs
  [(([can may] I) help) ((could [you we]) assist)] — 3-deep, parallel inversions
  ("not relevant"):-1                              — negation wrapping a literal
  [(wrong context):-1 (correct context)]           — OR where one alternative is itself negated
  (subject [verb1 verb2] [object1 (object two)])   — phrase group with two nested ORs

THE TWO HARD CONSTRAINTS (everything else composes freely):

  {} contains plain words ONLY. No nesting of any kind inside {}.
       WRONG:    {[a b] of}                        <- [] inside {}
       WRONG:    {(missing items) some}            <- () inside {}
       CORRECT:  {of the some}                     <- plain words only

  "" contains plain words ONLY. No nesting. Max 5 words.
       WRONG:    "[hello hi] there"                <- [] inside ""
       CORRECT:  "hello there"                      <- plain words only

EVERYTHING ELSE COMPOSES:
  [] can hold: plain words, (), "". (Not {} — see Rule below.)
  () can hold: plain words, [], (), "", {}.
  :-1 can attach to ANY token at ANY depth (word, "", [], (), or nested combinations).

NOTE on {} placement: {} can sit INSIDE a () (as in (missing {of} items)), but
CANNOT sit inside an []. Inside an [], a {} option would be vacuously satisfied
and break the OR semantics.

Depth is unlimited.

WHEN TO PUSH DEPTH — the rule is "match the phrase set's actual structure":

  PHRASE SET SHAPE                                  -> STRUCTURE TO USE
  ──────────────────────────────────────────────────────────────────────
  Single anchor varies (one slot, many synonyms)    -> flat [a b c d]
  Two slots vary independently                       -> two lines, each [a b]
  Two slots vary but only specific COMBINATIONS     -> [(a x) (b y)] — pairs locked
  Inversion (same words different order)             -> [(a b c) (c b a)]
  Subject + verb both vary, only valid combos       -> [([s1 s2] v1) ([s3] v2)]
  False positive uses similar words                  -> embed (wrong-phrase):-1 inline
  Negation context shares structure with relevant   -> [(relevant) ("wrong context"):-1]

The flat [a b c] is the simplest case of the general grammar — useful when each
synonym is independent. As soon as the phrase set has LOCKED COMBINATIONS,
ORDER-DEPENDENT VARIATION, or PARALLEL STRUCTURES with shared inner slots,
go deeper. Nesting is the primary tool; flat structures are the simplest case
of it. Match the script structure to the phrase set's actual structure.

INDENTATION FOR READABILITY (optional, doesn't change semantics):
For deeply nested lines, break across visual lines if it aids understanding —
but the final JSON must keep each script line as a single string. Use deep
nesting whenever the phrase set demands it. Don't simplify away precision.


# 2.1 Plain keyword and multi-word AND line
Matches the word(s) anywhere in the transcript, case-insensitive. Each line is an
AND condition (must match somewhere in the phrase, in order with other lines).

  Single keyword:
    credit
    deposit
    who

  Multi-word AND line — words separated by spaces on a single line:
    automatic deposit          <- matches "automatic deposit" as a sequence
    new membership             <- matches "new membership" as a sequence
    direct deposit             <- matches "direct deposit" as a sequence

  IMPORTANT — what space-separated plain words on one line mean:
  Two plain words side by side at the top level form an ADJACENT-WORD sequence
  (equivalent to wrapping them in a (phrase group)). They must appear IN ORDER
  in the transcript with at most a small gap between them (subject to path
  scoring).

  This is the SAME semantics as putting them on separate lines with no other
  tokens between them — both are AND conditions:
    automatic deposit          <- one AND token, sequence
    automatic / deposit        <- two AND tokens, same final result via gate-and-score

  Use the one-line form when the two words are tightly coupled in speech
  ("automatic deposit" as a known compound). Use separate lines when each
  word is its own anchor.

A multi-word AND line is structurally equivalent to a (phrase group):
    automatic deposit          <- same meaning as (automatic deposit)
    direct deposit             <- same meaning as (direct deposit)

The unparenthesised form is preferred for readability when the sequence stands
alone as its own AND line. Use () only when you need to:
  - Wrap the sequence as one option inside an [OR group]: [employer (company work)]
  - Attach :-1 to the sequence: (cooled down outside):-1
  - Disambiguate nested structure

Prefer plain multi-word AND lines wherever they read naturally. Don't wrap
"automatic deposit" in () unless you need it inside an [] or to attach :-1.


# 2.2 [OR group]
Any single item inside [] satisfies that line. Items can be plain words, "exact
phrases", or (phrase groups).

Three usages:
  1. On its own line as an AND condition:
     [raise start get put]   <- call must contain one of these
  2. Nested inside (phrase group) for OR variation in a sequence:
     (how [may can what] I [help assist])
  3. With :-1 for negation:
     [won't unable cannot]:-1

NO MAXIMUM SIZE: a 10 or 20-item [OR group] is fine. The only constraint is that
every word must come from the approved phrases — never invent.

[] must contain genuine anchor words — not articles, not filler, not connectors:
  WRONG:   [a the your]      <- articles, no signal
  WRONG:   [of them]         <- filler connector
  CORRECT: [raise start escalate boost]   <- meaningful action verbs


# 2.3 (phrase group) — The UNIT Operator

The most important thing about () is what it DOES:

  () turns whatever it contains into a SINGLE UNIT.

Whatever sits inside the () — words, [OR groups], (), "", :-1, or any nested
combination — collapses to one token at the script's structural level. From the
AND-gate's perspective and from an outer []'s perspective, the entire () is one
indivisible thing.

This is the unitization rule:
  (gift card)             — one unit: the literal phrase "gift card"
  (gift [card cards])     — one unit: "gift card" OR "gift cards" — still ONE unit
  ([the my] credit)       — one unit: "the credit" OR "my credit"
  ([raise increase] credit) — one unit: "raise credit" OR "increase credit"
  ([please can] [you we] help) — one unit, with two internal ORs
  (([can may] I) help)    — one unit, with a nested () inside
  ("not relevant"):-1     — one unit, treated as a negative weight

ANYTHING that should behave as a single word in the script structure goes inside
(). The internal complexity doesn't matter — outside, it's one token.

SCORING — () IS SCORE-TRANSPARENT:
  () unitizes the STRUCTURE (gate, order, OR-membership), not the SCORE.
  The internal words still count individually toward the path-score numerator.

  (gift cards) matching "gift cards" → 2 numerator units (one per internal word)
  (gift [card cards]) matching "gift cards" → 2 numerator units
  (gift [card cards]) matching "gift card" → 2 numerator units

  So () is "treat as one word for structural purposes, but score it normally."
  No score penalty for unitizing. Use () freely whenever you need unit behaviour.

FOUR USAGES (all are common):

  1. AS ONE OPTION INSIDE AN [OR group]:
       [(over the phone) (when you call) direct]
     The two ()'s and "direct" are three alternatives. The ()'s are unitized so
     [] sees them as single options, not as a flat soup of words.

  2. AS A STANDALONE AND LINE:
       (Don't tell compliance)
       (let me check)
       ([please can] [you we] help)
     Used when the unit IS the whole AND-line slot. Often deeply nested.

  3. WITH :-1 AS A NEGATION UNIT:
       (Don't tell compliance):-1
       ([non not isn't wasn't] (clear by)):-1
     The negation applies to the entire unit as one thing.

  4. AS PART OF A LARGER NESTED EXPRESSION:
       [(can [I we] [help assist] you) (could [you we] [help assist])]
     Each () is one alternative in the outer []. Internal complexity is fine.

WHY USE () AT ALL?

When the structural variation must be LOCKED to a specific sequence, ()
unitizes the lock. Without (), [OR groups] would fire on any combination of
their internal words across AND lines — even combinations that no real phrase
uses. Wrapping the locked sequence in () prevents that.

  WITHOUT () — fires on wrong combinations:
    [the my a]                <- any of these
    [credit account balance]  <- any of these
    Fires on real phrases AND on accidental cross-products like "the balance"
    when only "the credit" and "my balance" appear in the approved phrases.

  WITH () — only valid pairings fire:
    [(the credit) (my account) (the balance)]
    Each pairing is locked as one unit. No cross-product false positives.

NO MAXIMUM NESTING DEPTH. Nest as many levels deep as the approved phrases require.
Multiple ()'s inside a () is fine. ()'s inside []'s inside ()'s is fine.


# 2.4 "exact phrase"
Fixed word sequence — maximum 5 words. Inside [] or () or standalone.

USE FREELY when the phrase set contains DISTINCTIVE VERBATIM CHUNKS — exact
multi-word sequences that appear in the approved phrases as-is. "" literals are
a normal, everyday anchor, not a last-resort tool.

GOOD USES FOR "":
  - Distinctive verbatim chunks from approved phrases:
      "from Walmart", "Do you get is it", "one of those", "It's not", "random account"
    When a phrase has a 2-4 word chunk that's distinctive and unlikely to vary,
    "" locks it precisely without needing to enumerate alternatives.
  - Fixed terms: "terms and conditions", "thank you for calling"
  - Brand names, product names, legal phrases
  - Inside [] as one alternative: ["It's not" question trying]
  - Inside () as a slot piece: (cash {or} "gift cards")
  - With :-1 for surgical FP suppression: "anytime you do make":-1

WHEN NOT TO USE "":
  Use (phrase group) with internal [] when the slot has REAL variation that "" can't
  capture:
    WRONG:   "may I have your password"    <- only catches this exact 5 words
    BETTER:  ([may can] I [have get] your password)   <- catches all variants

THE RULE:
  - Verbatim chunk that appears in phrases distinctively -> "" literal
  - Slot with multiple alternatives -> [] or ()
  - Slot with optional connectors -> {} between anchors or inside ()
  Pick the shape that matches the SHAPE OF THE PHRASE, not a default.


# 2.5 {optional words} — Bridges

INDIVIDUAL PLAIN WORDS ONLY, IN LEFT-TO-RIGHT ORDER.
  - Each entry inside {} is a single word — not a phrase, not a sequence
  - The words inside {} are OPTIONAL: zero, some, or all of them may hit in
    the transcript, and the {} contributes neutrally either way
  - BUT whichever words DO appear must appear in the ORDER WRITTEN.
  - {to quickly gonna} = up to three words, each optional, that — if any appear
    in the transcript between the surrounding anchors — must appear in this order:
    "to" before "quickly" before "gonna". A transcript with "gonna quickly to"
    in the gap does NOT hit this {} in that order; only "gonna" alone (or
    "to gonna", or "quickly gonna", etc.) hits.
  - {of them} = the word "of" optionally followed by the word "them". Like every
    other operator in Tethr, order is preserved.
  - No [], (), or "" inside {} — ever

NEUTRAL-WEIGHT: not required to fire but boost the path score when present in
the written order.

WHEN TO ADD {} — TWO TRIGGERS:

  TRIGGER A — Gap of 4 OR MORE non-article words between anchors:
    "going to gonna raise the credit" — gap between [going] and [raise] is 2 non-article
    words ("to gonna"), so {} is optional but useful.
    "I would just like to quickly confirm the missing items" — gap between [I] and
    [confirm] is 5+ non-article words → {} bridge needed for path score density.

  TRIGGER B — Optional non-article connector inside a (phrase group):
    (cash {or} "gift cards")    <- "or" optionally appears as spoken connector
    (clear {it} balance)        <- "it" optionally appears

ARTICLES NEVER TRIGGER {}: "a", "an", "the", "your", "my" do NOT count toward the
gap and never get bridged with {}. Path-scoring tolerates them naturally.

  WRONG:   [raise start] / {a the your} / credit         <- articles, never use {}
  CORRECT: [raise start] / credit                         <- adjacent, articles drop

NO DUPLICATES — every word inside {} must be checked against the line IMMEDIATELY
BEFORE the {} line and the line IMMEDIATELY AFTER the {} line. If any word in {}
appears in either neighbour at any nesting depth, REMOVE that word from {}.

Check both directions, every time. A {} that's clean against the line above but
duplicates a word in the line below still breaks. Walk before-and-after as one audit.

  Check against ALL token types on the neighbouring lines:
  - Words inside adjacent [OR groups]
  - Words inside adjacent (phrase groups)
  - Words inside adjacent "exact phrases"
  - Adjacent plain keywords
  - Words NESTED inside adjacent () or [] at ANY depth — recurse all levels

  WRONG — "the" inside {} also inside the line AFTER it:
    [raise]
    {a the}
    (the credit)             <- "the" already nested inside the next line's ()
  CORRECT — drop the duplicate (and the article, per the rule above):
    [raise]
    (credit)

  WRONG — "items" inside {} duplicates words in both before AND after lines:
    [confirm confirming]
    {the items}              <- "items" appears in the line after this one
    [(missing items) (items missing)]
  CORRECT:
    [confirm confirming]
    [(missing items) (items missing)]

  WRONG — "from you" inside {} duplicates words in the line BEFORE it:
    [(haven't heard from you) (I haven't)]
    {from you for a while}   <- "from" and "you" already in (haven't heard from you)
    [reach out]
  CORRECT — strip the duplicates, keep only what's not already in either neighbour:
    [(haven't heard from you) (I haven't)]
    {for a while}            <- duplicate words removed
    [reach out]

REAL FAILURE: in production testing, scripts with duplicate words inside {} have
dropped phrase scores from .97 to .89 — pushing them below threshold. This is the
single most common cause of an otherwise-correct script failing. Walk every {}
against its before-line AND its after-line before output.

WHERE {} CAN AND CANNOT GO:

  VALID — standalone on its own line, BETWEEN two anchor lines:
    [confirm confirming]
    {to quickly}
    [item items]

  VALID — inside a (phrase group) as an optional slot:
    (cash {or} "gift cards")
    (clear {the} balance)
    (gift {cards} "and")

  INVALID — inside an [OR group]:
    [{two three} of them]    <- {} inside [] is wrong
    [gift {cards} voucher]   <- {} inside [] is wrong

  INVALID — as the FIRST line of a script:
    {would just}                       <- {} cannot start a script
    [confirm confirming]
    [item items]
    {} is a BRIDGE — by definition it bridges between two anchors. With nothing
    before it, there is nothing to bridge from. The script becomes anchorless
    on the left side.

  INVALID — as the LAST line of a script:
    [confirm confirming]
    [item items]
    {today now}                        <- {} cannot end a script
    Same reason: no anchor to bridge to on the right side.

THE RULE: every {} line MUST sit between two anchor lines (plain keyword,
[OR group], (phrase group), or "exact phrase"). If you find yourself wanting
to put {} at the start or end of a script, either:
  - Promote those words to a real anchor line ([OR group] or plain keyword), OR
  - Drop them entirely — they aren't load-bearing as bridges if there's no
    second side to bridge to.


# 2.6 :-1 negative weight
Suppresses the score of the line it sits on (NOT the whole script).
Works on any token: keyword:-1 / "phrase":-1 / [list]:-1 / (group):-1

For full negation: put :-1 on every AND line of the negation, OR compress into one
(phrase group):-1.


# 2.7 Articles — Strip Unless Load-Bearing

CRITICAL: Articles ("a", "an", "the", "your", "my") should NOT be in scripts by
default. They appear in nearly every spoken phrase but don't identify the category.

KEEP articles ONLY when:
  - Inside an "exact phrase" where they are part of a fixed term: "the bees knees"
  - Inside a (phrase group) where removing them changes meaning: (the only one)
    Without "the" this becomes "only one" which fires on "only one option", "only one minute"
  - When the article distinguishes one approved phrase from another approved phrase

STRIP articles when:
  - Inside (phrase groups) where concept words alone identify it: prefer (credit limit) over (the credit limit)
  - As {} bridges between adjacent anchors: just remove the {} entirely
  - As [OR group] options when they're just determiner variants of one concept

THE TEST: "If I remove this article, would the script still clearly identify the right calls?"
  YES -> strip it
  NO  -> keep it

  WRONG (article noise):
    [(the credit limit) (a credit limit) (your credit limit)]   <- determiner variants
    [confirm confirming] / {a the your} / [item items]          <- noise between anchors
    [I he she we] / {a the your} / [raise start]                <- noise between anchors

  CORRECT (clean):
    [(credit limit)]                          <- determiners stripped, concept preserved
    [confirm confirming] / [item items]
    [I he she we] / [raise start]

═══════════════════════════════════════════════════════════════════════════════
PART 3 — HOW TO BUILD A SCRIPT
═══════════════════════════════════════════════════════════════════════════════

# THE PROCESS AT A GLANCE — Reference Card

Before any details, here is the full workflow as a single ordered process.
The rest of Part 3 elaborates each step.

  PHASE 1 — UNDERSTAND THE INPUT
    Read category definition, all approved phrases, all non-relevant phrases,
    any screenshots. Note the threshold (default .95).

  PHASE 2 — INTENT GROUPING (do this FIRST, before building any script)
    Group approved phrases by shared SHAPE — not just by topic noun and not by
    surface words. Two phrases share a SHAPE when they have the same number of
    slots in the same order, with each slot fillable by a different word/phrase.

    Phrases sharing a shape MERGE into ONE script (their distinct slot fillers
    become [OR] alternatives at the relevant slot, with the topic anchor shared).

    Example of shape-sharing — these three phrases share the shape
    "[context-word] [qualifier-word] gift cards":
      "I'm trying to BUY some gift cards"            -> [trying] [buy] (gift cards)
      "I have a QUESTION REGARDING the gift card"   -> [question] [regarding] (gift card)
      "It's not it's ONE OF THOSE gift cards"        -> ["It's not"] ["one of those"] (gift cards)
    These three MERGE into ONE script:
      [trying question "It's not"]
      [buy regarding "one of those"]
      (gift [cards card])

    Example of DIFFERENT shapes — these need different scripts:
      "Do you get is it any more beneficial to get cash or gift cards"
        -> shape: "[opener-literal] [comparative-word] (cash-or-giftcards)"
      "my computer was hacked, purchase made for dollars worth of gift cards"
        -> shape: "[event-word] [action] [dollar-quantifier-giftcards]"
    Different shapes -> different scripts.

    DEFAULT TO MERGING. Before creating a separate script, ask: "does this phrase
    share a shape with any phrase already in a group?" If YES -> add to that group.
    Only create a new group when NO existing group has a compatible shape.

    DYNAMIC SCRIPT COUNT — NO FIXED TARGET:
    The number of scripts emerges from the phrase set, it is NOT a fixed ratio.
    Each script is built to cover as MANY phrases as possible. A new script is
    only created when the next phrase genuinely CANNOT be absorbed into any
    existing script — that is, when ALL of B1-B5 return no for every existing
    script (no exact fit, can't add an OR alternative, can't widen an OR group,
    can't add a {} bridge to share the same anchors, no inversion match).

    The decision per phrase: try to merge into every existing script in order
    using B1-B5. Create a new script ONLY when every absorption attempt fails.

    BUILD THE DOMINANT SCRIPT FIRST.
    Most categories have one BIG script that catches most phrases plus 1-5
    smaller satellite scripts for edge cases. Don't try to keep all scripts
    equal — let one absorb as many phrases as it can by widening its [OR]
    slots aggressively. Real expert [OR] slots routinely hold 8-15 alternatives
    mixing plain words, () units, and "" literals. See TYPICAL SCRIPT SET
    SHAPE (Shapes 1 and 2) for full examples.

    This means: a phrase set of 8 phrases might produce 2 scripts (if 4 phrases
    each share a shape) or 7 scripts (if phrases mostly have unique shapes).
    Both are correct outcomes — what matters is that each script is doing the
    maximum work it can, not hitting any pre-set count.

  PHASE 3 — BUILD EACH SCRIPT (run master algorithm A-E per intent group)
    A. Analyse the phrase
    B. Can an existing script absorb it? (B1 exact / B2 widen [] alt /
       B3 widen [] / B4 add {} bridge / B5 inversion handling)
    C. Build a new script using SLOTS — each slot becomes one top-level AND token,
       with () units to lock combinations and [] for genuine alternatives
    D. Gap walk every targeted phrase, add {} bridges for any 4+ word gaps.
       FOR LONG PHRASES (12+ content words): apply LONG-PHRASE STRATEGIES L1-L5
       inside Section D — shrink span, multi-bridge densify, use "" literals,
       split by sub-intent, or mark pending if irreducible.
    E. Pre-flight (CHECK 1-5: no duplicates, removal test, gap walk, {} position,
       cross-token anchor redundancy)

  PHASE 4 — CONSOLIDATE (F: cross-script merge)
    For every pair of scripts, check if they can union into one without breaking
    coverage (same line count + position-compatible + negation-compatible).

  PHASE 5 — PRODUCTION VERIFICATION (G: before emitting JSON)
    G1. Build coverage verification TABLE — one row per approved phrase showing
        best script + gap-walked estimated score + verified yes/no
    G2. STRICT RULE: scriptLetter is ONLY emitted for phrases with Verified=YES.
        All others get status="pending". No assigning letters based on intent
        without verifying the score clears threshold.
    G3. Delete orphan scripts: any script not the "Best script" for at least one
        Verified=YES phrase gets removed from output.
    G4. False-positive scan: imagine almost-matches, verify they don't fire.
    G5. Honest precision/recall from the verification table.
    G6. Emit JSON.

  PRINCIPLE THAT GOVERNS ALL PHASES:
    Match the script's structure to THIS phrase set's actual structure. Don't
    copy the shape of an example script from another category. Lock combinations
    with () units. OR alternatives with []. Bridge optional gaps with {}. Negate
    false positives with :-1 at natural position. Nest as deeply as the intent
    requires. Production scale (10,000+ calls) means tightness beats broadness
    — when uncertain, choose tighter.

  DOMAIN-NEUTRAL CONSTRUCTION:
    Every example in this prompt is an ILLUSTRATION of a mechanic, not a TEMPLATE.
    Derive structure from the phrases you're given. A topic-mention category
    might need a 1-line script. A speech-act category might need 5 slots. A
    multi-sub-intent category might need 3 scripts. Always read THIS phrase set.


# CANONICAL PATTERN — Intent-Locked Structure

A good script\'s structure mirrors the intent\'s structure. The principles below
are DOMAIN-INDEPENDENT — they apply to any category, whether the phrases are
about banking, healthcare, support tickets, sales objections, or anything else.

CORE PRINCIPLES:

  1. SLOTS = AND TOKENS
     A speech-act intent typically has 2-5 SLOTS (action, frame, qualifier, topic, etc).
     Each slot becomes one top-level AND token in the script.

  2. LOCK COMBINATIONS WITH () UNITS
     When the phrase set has SPECIFIC combinations of words at a slot
     (e.g. "modal X verb" only in certain pairings), wrap them in () to
     prevent cross-product false positives. The () keeps the combination
     intact while still allowing the internal words to vary via nested [].

  3. ALTERNATIVES GO IN []
     When a slot has multiple distinct ways to be expressed, wrap them in
     an outer [] with each alternative as an item inside. Alternatives can
     be plain words, "literals", () units, or nested combinations.

  4. BRIDGES WITH {}
     Optional filler words between slots go in {} bridges (between two
     anchor tokens, never at start or end).

  5. NEGATE FALSE POSITIVES AT NATURAL POSITION
     :-1 sits where the bad word would naturally be spoken in the transcript.
     See Part 5 Rule A for the two cases.


ILLUSTRATION (one concrete example showing what the principles look like together):

  Intent: agent asking for an identifier (verbal password is one instance; the
  same shape applies to "agent asking for account number," "agent asking for
  date of birth," etc).

  Phrase set excerpt:
    "may I get your identifier or verbal password?"
    "And how about your verbal password?"
    "do you recall your verbal password?"
    "What is your secret identifier?"

  Resulting script (5 slots, each as one top-level AND token):

    SLOT 1: speech-act
      [Provide ([can may] I [have get]) confirm ask verify what what\'s]

    SLOT 2: asking-frame
      [([do can could] you [remember have tell provide]) (do you know) recall "and your"]

    SLOT 3: optional bridge
      {is your phone number}

    SLOT 4: qualifier
      [verbal secret challenge (challenge word)]

    SLOT 5: noun
      [(verbal [password passport]) password identifier]

  Why each piece earns its place:
    - Slot 1\'s ([can may] I [have get]) is a () unit because the phrase set has
      "can/may I have/get" as a LOCKED matrix — without the (), a flat
      [can may] / I / [have get] would fire on cross-products that didn\'t appear.
    - Slot 4\'s (challenge word) is a () unit because it\'s a two-word concept,
      not two separate alternatives.
    - Slot 5\'s (verbal [password passport]) locks "verbal" as a prefix when
      paired with password/passport, while bare "password" and "identifier" are
      separate alternatives.

  THIS IS ONE EXAMPLE OF THE PRINCIPLES. Do NOT pattern-match new categories
  onto this exact 5-slot shape. A simpler intent has fewer slots; a complex
  intent has more. Match structure to the phrase set you\'re given, not to
  this example.


HOW TO USE THE PRINCIPLES ON ANY CATEGORY:

  Step 1: Read the phrases. What\'s the underlying SPEECH-ACT or TOPIC FOCUS?
  Step 2: List the SLOTS the phrases share (what aspects vary across them).
  Step 3: For each slot, list every variant seen across phrases.
  Step 4: For each slot, choose the shape:
            - Variants are independent single words -> flat [a b c]
            - Variants are locked combinations     -> [(combo1) (combo2)] with internal []
            - Variants share a sub-structure       -> nested [] inside ()
            - Optional connectors                  -> {} bridge between slots
  Step 5: Assemble as top-level AND tokens. One slot, one token.
  Step 6: Run the pre-flight CHECKs (see master algorithm Section E).


WHAT TO AVOID (DOMAIN-NEUTRAL FAILURE MODES):

  - Under-structured (too broad): only the topic noun as the anchor, missing the
    speech-act. Fires on any mention of the topic. FALSE POSITIVES AT SCALE.

  - Cross-product (flat where lock needed): two slots with flat [] when only
    specific combinations appear in the phrases. Fires on combinations no real
    phrase contains.

  - Over-fragmented: one separate script per phrase variant. Should be one
    script per SUB-INTENT, with internal nesting capturing the variants.

  - Domain-imitation: copying the shape of an example script onto a category
    that has a different shape. Always derive structure from THIS phrase set.

# TYPICAL SCRIPT SET SHAPE — What Production Script Sets Actually Look Like

Empirical observation from real expert-written scripts: most production script
sets follow a specific shape that the AI tends to under-produce. Internalise
these patterns before running the master algorithm.


## SHAPE 1 — DOMINANT SCRIPT + SATELLITE SCRIPTS

Most categories produce ONE big "dominant" script that catches the majority of
phrases (often 50-80% of approved phrases), plus 1-5 smaller "satellite" scripts
that catch the edge cases the dominant script can\'t absorb.

  Example category: Verbal Password (15+ approved phrases, 5 scripts total)

    Script a (DOMINANT — catches ~15 phrases):
      [Provide ([can may] I [have get]) confirm confirmed ask verify what what\'s
       ([do can could] you [remember have tell provide]) (do you know) recall "and your"]
      {is your phone number}
      [verbal secret challenge (challenge word)]
      [(verbal [password passport]) password identifier]

    Script b (SATELLITE — catches ~10 phrases):
      [(verbal [password passport]) (secret identifier) (security word)]
      {you give us on these calls you provide}
      [recall authenticate verify ([can do] you [know have provide give remember tell])
       (over the phone) (may I have)]

    Script c, d (SATELLITE — small variants):
      shorter scripts each handling 2-5 distinctive phrasings

    Script e (LITERAL — 1 phrase):
      "a secret id"

When building a script set:
  - Start by trying to build the DOMINANT script. Stuff as many phrases as
    possible into one script by widening its [OR] slots aggressively.
  - When a phrase genuinely won\'t fit the dominant script (B1-B5 all fail
    against it), build a satellite script for it.
  - Don\'t try to keep all scripts equally sized. ONE big script + several
    smaller ones is the expected shape, not 5 equal scripts.

EXCEPTION: when phrase set has multiple genuinely distinct sub-intents with
roughly equal phrase counts, the script set may have several equally-sized
scripts (e.g. gift cards example with 6 scripts each covering 1-3 phrases).
That\'s also valid. The point is: structure tracks the phrase set, not a
preference for balance.


## SHAPE 2 — MEGA-MERGED [OR] SLOTS WITH 8-15 ALTERNATIVES

Real expert scripts routinely put 8-15 alternatives into a single [OR] slot.
The AI tends to stop at 3-5 alternatives and create new scripts instead.
This is wrong. WIDEN the slot first.

  Example slot from real Verbal Password Script a (slot 1):

    [Provide
     ([can may] I [have get])
     confirm
     confirmed
     ask
     verify
     what
     what\'s
     ([do can could] you [remember have tell provide])
     (do you know)
     recall
     "and your"]

  This single [OR] slot contains 12 alternatives mixing four token types:
    - 7 plain words (Provide, confirm, confirmed, ask, verify, what, what\'s)
    - 3 () units with internal [] (the modal-verb combinations)
    - 1 () plain sequence (do you know)
    - 1 "" literal (and your)

  Each alternative came from a different approved phrase. Instead of creating
  12 separate scripts, the expert stuffed all 12 into one slot and shares
  the rest of the script structure across all phrases.

  Example slot from real Visa Letter Script a (slot 1):

    [about regarding need question confirm help assistance support waiting
     reply request receiving look forward offering provide send sent apply
     start registration response confirmation]

  20+ plain alternatives in one [OR] slot. Each one came from a different
  phrase. ALL share the slot 2 structure (visa-letter topic with its own
  internal [OR]s and () units).

WHEN TO WIDEN A SLOT vs CREATE A NEW SCRIPT:
  - The new phrase\'s context-word fits as another alternative at the SAME slot
    position as an existing script\'s [OR] slot -> WIDEN that [OR] slot
  - The new phrase has a different SLOT STRUCTURE (different number of slots,
    different order, different topic anchor) -> NEW SCRIPT

  Default to widening. The AI under-widens and over-creates new scripts.


## SHAPE 3 — STRUCTURE: VERB/CONTEXT SLOT → QUALIFIER SLOT → TOPIC SLOT

Most expert scripts follow a 2-5 slot pattern in this order:

  SLOT 1: SPEECH-ACT / VERB / CONTEXT — usually the widest [OR] (8-15 alts)
  SLOT 2: OPTIONAL CONNECTOR/BRIDGE — sometimes a {} bridge, sometimes skipped
  SLOT 3: QUALIFIER — narrower [OR] (3-5 alts, often () units)
  SLOT 4: TOPIC NOUN — narrowest [OR] (2-4 alts, often a single () unit)

  Verbal Password Script a:
    SLOT 1 (verb/context):    [Provide ([can may] I [have get]) confirm ... "and your"]
    SLOT 2 (optional bridge): {is your phone number}
    SLOT 3 (qualifier):       [verbal secret challenge (challenge word)]
    SLOT 4 (topic noun):      [(verbal [password passport]) password identifier]

  Item Check Script a:
    SLOT 1 (anchor verb):     what
    SLOT 2 (optional bridge): {was that you did is that}
    SLOT 3 (optional bridge): {item product}
    SLOT 4 (verb/context):    [you you\'re wanted want wanna going "is that" "was it" wanna only]
    SLOT 5 (action):          [add include report missing "add on" "add on there"]

  Top Priority Script a:
    SLOT 1 (verb):            [escalating take Make]
    SLOT 2 (referent):        [this it]
    SLOT 3 (optional bridge): {our full attention}
    SLOT 4 (intensifier):     [on as highest Top]
    SLOT 5 (topic noun):      priority

  Training Sentiment Script a:
    SLOT 1 (topic):           training
    SLOT 2 (sentiment):       [great awesome bomb]
    SLOT 3 (negation guard):  (not great):-1

This isn\'t a rigid template — different categories use different slot patterns.
But the GRADIENT (widest at slot 1, narrowest at the topic noun) is consistent.
The wide slot is where merging happens.


## SHAPE 4 — TOPIC ANCHOR IS USUALLY SIMPLE AND SHARED

Across scripts in the same category, the TOPIC NOUN slot is typically the
simplest and most stable. Examples from real categories:

  Gift cards category:    (gift [cards card])   <- appears in 5 of 6 scripts
  Password category:      [(verbal [password passport]) password identifier]
                                                <- appears across scripts a, c, d
  Item category:          [item product]        <- appears across scripts a, b
  Top Priority category:  priority              <- single plain word
  Training category:      training              <- single plain word
  Visa Letter:            (visa letter) and variants

When building scripts in a category, identify the topic anchor early and
reuse it across scripts. CHECK 5 explicitly permits this — reusing the
topic noun ACROSS scripts is good and expected (just not WITHIN one script
in two different top-level tokens).


# MASTER ALGORITHM — ONE CONSISTENT PROCEDURE FOR EVERY PHRASE

This is the single decision procedure to follow for EVERY approved phrase.
Sections A through G below are self-contained — read and follow them in order.
Merging, nesting, bracket selection, and gap-bridging happen as one coherent pass.

INTENT GROUPING (do this FIRST, before processing any individual phrase):

  Read the entire phrase set. Group phrases by SHARED INTENT, not by surface words.
  Two phrases share an intent when they express the same speech-act with different
  wording. Different intents need different scripts. Same intent collapses into
  ONE rich nested script.

  Examples of different intents in the same category:
    Agent asking for password               -> Script a
    Agent confirming password exists        -> Script b
    Agent describing what the password is   -> Script c
    Agent asking with a specific surface form -> Script d

  Examples of the SAME intent (these collapse into one script):
    \"can I have your password\"
    \"may I get your secret identifier\"
    \"could you tell me your verbal password\"
    \"do you remember your password\"
    All four are agent-asking-for-password. ONE script with parallel UNITS,
    not four separate scripts.

  Output: a mapping from each phrase to ONE intent group. Each intent group will
  produce ONE script.

For EACH intent group (not each phrase), run A through E to build that group's
script. After ALL intent groups have been processed, run F once to check if any
two scripts can themselves be merged. Finally, run G as the production guard
before emitting JSON.

For EACH approved phrase WITHIN an intent group, IN ORDER, run A through E.
After ALL approved phrases have been processed:
  - Run F once on the final script set (cross-script merge consolidation)
  - Run G once on the final script set (coverage + FP verification before output)

  A. ANALYSE THE PHRASE
     1. Break it into positional LAYERS by reading the phrase in order: subject
        (who is acting), intent (what kind of speech-act), negation (any), action
        (the verb), bridge (filler), topic (the noun). Only use the layers that
        actually appear in this phrase set.
     2. Identify which words are the 2-3 most distinctive ANCHOR words.
     3. Note any (multi-word concepts) — these will become () phrase groups.
     4. Note any common variants you can already see — these will inform [] OR groups.

  B. CAN AN EXISTING SCRIPT ABSORB THIS PHRASE?
     Walk through the existing scripts in order. For each one ask:

     ⚠ AGGRESSIVE MERGING IS THE DEFAULT.
     Real expert scripts put 8-15 alternatives into a single [OR] slot. If you
     reach for a new script before the existing [OR] slot has 8+ alternatives,
     you are probably under-widening. See TYPICAL SCRIPT SET SHAPE / SHAPE 2.
     Try every B step honestly against every existing script before creating
     a new script.

     B1. EXACT FIT — does the phrase already satisfy every AND line of this script
         in left-to-right order without any changes?
         YES -> assign this script's letter. DONE for this phrase.
         NO  -> continue.

     B2. ADD AN OR ALTERNATIVE — can this phrase fit by adding a new alternative to an
         existing [OR group]? The alternative can be a plain word, a (), a "", or even
         a NESTED structure with its own internal [] or () — any well-formed token.
         Example: existing [(missing items) (items there)] + new phrase \"missing one\"
                  -> [(missing items) (items there) (missing one)]
         Example: existing [(can [I we] help)] + new phrase \"could you assist\"
                  -> [(can [I we] help) (could [you we] assist)]   <- new () with its own [] inside
         YES -> add the alternative, assign letter. DONE for this phrase.
         NO  -> continue.

     B3. WIDEN AN OR GROUP — can a token at any nesting depth in an existing line be
         widened to include this phrase's variation? The widening can happen at the
         OUTER [] or at any NESTED [] inside a () inside a [].
         Example: existing [raise start] + new phrase uses \"escalate\"
                  -> [raise start escalate]
         Example: existing [(can [I we] help)] + new phrase has \"may I help\"
                  -> [(can [I we] help) (may I help)]               <- outer [] widened
                  OR widen inner: [([can may] [I we] help)]         <- depending on phrase set
         (THERE IS NO MAXIMUM OR GROUP SIZE OR NESTING DEPTH. Widening is preferred
         over splitting. Reach into nested structures to widen at the right slot.)
         YES -> widen, assign letter. DONE for this phrase.
         NO  -> continue.

     B4. ADD A {} BRIDGE — does the phrase share the same anchors but have a
         wider non-article gap between two existing AND lines?
         Gap ≤ 3 non-article words: no bridge needed, phrase already fits.
         Gap ≥ 4 non-article words: add a {} bridge between those lines.
         Articles (a/an/the/your/my) never count toward the gap.
         YES -> add {} bridge, assign letter. DONE for this phrase.
         NO  -> continue.

     B5. WORD ORDER INVERSION — same core words but flipped left-to-right order?
         If the inversion is INTERNAL to one slot (e.g. \"missing items\" vs
         \"items missing\"), it's not an inversion — merge as alternatives:
             [(missing items) (items missing)]
         If the inversion is a GENUINE flip of the whole AND-line sequence:
             Script a: training / [great awesome]
             Script b: [great awesome] / training
         These must be SEPARATE scripts. Create a new script for the flipped order.
         YES (genuine flip) -> new script (proceed to C).
         NO (internal slot swap) -> merge as alternatives, assign letter. DONE.

     If B1-B5 all return NO, this phrase needs a NEW script. Proceed to C.

     ============================================================================
     WORKED EXAMPLE — HOW MERGING ACTUALLY WORKS (READ THIS CAREFULLY)
     ============================================================================

     PHRASE SET (gift-card topic, 8 phrases — looks heterogeneous on the surface):
       P1. "you know, gift cards, but I can't access it"
       P2. "my computer was hacked, and a purchase was made for five hundred
            dollars worth of gift cards from Amazon"
       P3. "It's not it's one of those gift cards"
       P4. "I have a question regarding the gift card"
       P5. "I would just bought some Apple gift cards, two of them, from Walmart,
            and they would not accept the second one"
       P6. "Do you get is it any more beneficial to get the cash or to get credit
            or to get gift cards?"
       P7. "I'm saying that there are some times when he does transactions for,
            like, gift cards and stuff or hide transactions to a random account,
            that's going to his boyfriend that we've determined as a scammer"
       P8. "I'm trying to buy some Apple gift cards"

     WRONG APPROACH (what NOT to do) — one script per phrase:
       Script a: [gift (gift card) (gift cards)] / [access accessing accessed]
       Script b: [purchase purchased] / [(gift cards) (gift card)]
       Script c: [(one of those) (one of them)] / [(gift card) (gift cards)]
       Script d: [question questions] / [regarding about] / [(gift card) (gift cards)]
       ... (8 scripts total)
       PROBLEM: bloated script count, low recall, no merge, no bridges, each script
       a near-duplicate of the others sharing the same topic anchor.

     RIGHT APPROACH — group by shared SHAPE (not by phrase), then merge:

       OBSERVATION 1: P3, P4, P8 share a SHAPE — each has (a) a distinctive
       context word/phrase early ("trying", "question", "It's not") and (b) a
       contextual qualifier in the middle ("buy", "regarding", "one of those")
       and (c) the topic noun gift card(s). DIFFERENT WORDS BUT SAME SHAPE.

       Merge by [OR]-ing the variant words at each slot while sharing the topic:
         Script a:
           [trying question "It's not"]
           [buy regarding "one of those"]
           (gift [cards card])
         THREE phrases collapsed into ONE script. The outer [] at slots 1 and 2
         hold distinct context words from each phrase. The topic anchor is shared.

       OBSERVATION 2: P6 has a unique distinctive structure ("Do you get is it
       any more beneficial... cash or credit or gift cards"). The literal opener
       "Do you get is it" is so distinctive it earns "" treatment. The
       cash-or-giftcards comparison fits into a () unit with {} inside:
         Script b:
           "Do you get is it"
           beneficial
           (cash {or} "gift cards")

       OBSERVATION 3: P5 has very distinctive verbatim chunks ("from Walmart",
       "not accept"). When a phrase has 3+ rare verbatim chunks, "" literals are
       the right anchor — they LOCK the intent tightly:
         Script c:
           "gift cards"
           "from Walmart"
           "not accept"

       OBSERVATION 4: P1 has a tight verb+noun pattern (can't + access + gift card):
         Script d:
           (gift [cards card])
           can't
           access

       OBSERVATION 5: P2 has a distinctive narrative shape (hacked + purchase made +
       dollar-amount + gift cards). The "dollar (gift [cards card])" nested unit
       captures "dollars worth of gift cards" tightly:
         Script e:
           hacked
           (purchase made)
           (dollar (gift [cards card]))

       OBSERVATION 6: P7 has a scam-context shape (transactions + gift cards +
       stuff/random account). The {} inside a () captures the optional connector:
         Script f:
           transactions
           (gift [cards card])
           (stuff {or} "random account")

       FINAL: 6 scripts for 8 phrases. P3+P4+P8 merged into Script a. Each remaining
       script has DISTINCT contextual anchors that can\'t cleanly merge into a.

     WHAT THIS TEACHES — APPLY THESE PATTERNS:

     PATTERN A — MERGE BY [OR]-ING DISTINCT CONTEXT WORDS OVER A SHARED TOPIC.
       When 2+ phrases share a shape (e.g. each has "context-word + qualifier + topic"
       in that order), collapse them into ONE script. Put the distinct context words
       from each phrase into the SAME [OR] slot. Share the topic anchor across all.
       This is the highest-leverage merge pattern. Don\'t skip it.

     PATTERN B — USE "" LITERALS FREELY AS DISTINCTIVE ANCHORS.
       "" is not a last-resort tool. When a phrase has a verbatim chunk that\'s
       distinctive enough to be its own anchor (e.g. "from Walmart", "It\'s not",
       "Do you get is it", "random account"), use "" directly. Often cleaner than
       building [] / () structures to approximate the same thing.

     PATTERN C — () UNITS CAN CONTAIN {} FOR OPTIONAL CONNECTORS.
       (cash {or} "gift cards") means: cash, optionally followed by "or", followed
       by "gift cards" — all as one unit. Use this when an optional connector word
       sits BETWEEN two anchors INSIDE a single unit.

     PATTERN D — TOPIC ANCHOR FORM ADAPTS TO CONTEXT.
       Sometimes the topic is (gift [cards card]). Sometimes "gift cards" as a
       literal. Sometimes nested deeper: (dollar (gift [cards card])). Use the
       form that locks the surrounding context — not always the same shape.

     PATTERN E — SCRIPT COUNT EMERGES FROM B1-B5, NOT FROM A TARGET.
       Each new phrase is run through B1-B5 against every existing script.
       Only when EVERY absorption attempt fails does a new script get created.
       N phrases might produce 1 script (if all share a shape and absorb into
       one) or N scripts (if every phrase has a unique shape no existing script
       can absorb). Both are valid — what matters is that every existing script
       was honestly tried before adding a new one.
       If your script count equals your phrase count AND any pair of phrases
       could plausibly share a script structure, you have NOT done B1-B5
       properly. Re-examine pairs of phrases for shared shapes.

     ============================================================================


  C. BUILD A NEW SCRIPT — STRUCTURE-LOCKED PRECISION

     A script targets ONE sub-intent. Build it to match THIS phrase set\'s actual
     structure. Don\'t copy the shape of any example script — derive shape from
     the phrases you\'re given.

     1. IDENTIFY SLOTS
        Read all phrases in the sub-intent group. Identify the SLOTS (aspects of
        the speech-act that vary across the phrases). Most intents have 2-5 slots.
        Simpler intents have fewer; complex intents have more.

        Examples of slot types (not a closed list — derive what fits this intent):
          - SPEECH-ACT VERB (asking / confirming / requesting / stating)
          - FRAME (who, what, how, can-you, do-you)
          - QUALIFIER (modifier on the topic noun)
          - TOPIC (the noun the intent is about)
          - TIME (today, now, yesterday, when)
          - SUBJECT (I, we, you, they)
        Pick ONLY slots that actually vary across the approved phrases. Don\'t add
        slots that don\'t appear.

     2. COLLECT VARIANTS PER SLOT
        For each slot, list every variant seen in the approved phrases.

     3. CHOOSE THE SHAPE PER SLOT
        For each slot, pick the structural shape that LOCKS the variants without
        over-firing:

        SHAPE A — single keyword (when one word covers all phrases at this slot)
          Just the plain word as the AND token.

        SHAPE B — flat OR (when variants are independent words)
          [variant1 variant2 variant3]

        SHAPE C — locked combinations (when variants are specific word pairings)
          ([slotA1 slotA2] [slotB1 slotB2])
          The () unit locks the combination. Internal [] gives variation at
          each sub-slot. Use whenever the phrase set has only SPECIFIC pairings,
          not every cross-product.

        SHAPE D — mixed alternatives (plain words + () units in one slot)
          [plain ([modal] verb) other-plain (multi-word phrase)]
          Outer [] wraps any mix of token types as alternatives.

        SHAPE E — deeply nested (when slots have internal locks AT MULTIPLE LEVELS)
          [(prefix [varA varB]) plain-fallback]
          Nest as deeply as the phrase set\'s structure demands. No depth limit.

     4. ASSEMBLE AND ASSEMBLE BRIDGES
        Stack slot tokens in speech order at the top level (newline OR space —
        both mean AND). Where a non-article gap of 4+ words appears between
        slots in any phrase, add a {} bridge between those two slot tokens.

     5. APPLY :-1 GUARDS WHERE NEEDED
        For each non-relevant phrase in the input:
          - Shared structure with a relevant phrase? -> embed :-1 at the natural
            position of the distinguishing word (Part 5 Rule A Case 1)
          - Unrelated topic? -> separate negation script (Part 5 Rule A Case 2)

     6. STRUCTURE MATCHES INTENT — NO ARBITRARY DEPTH
        A simple intent (one slot, independent variation) -> simple flat script.
        A complex intent (multiple slots with locked combinations) -> deeper nesting.
        Don\'t inflate structure beyond what the phrases require. Don\'t deflate
        structure when the phrases lock combinations.

  D. GAP WALK THE NEW SCRIPT (mandatory before output)
     For every approved phrase this script is meant to catch, including the one
     that triggered creation:
     1. Walk script tokens left to right.
     2. Count non-article gap between EACH adjacent pair of script lines in this phrase.
     3. For EACH gap ≥ 4 non-article words, add its OWN {} bridge at that position
        (or pick closer anchors). A phrase with two wide gaps gets two bridges. Three
        wide gaps gets three bridges. Each bridge sits between its own pair of anchors.
        See LONG-PHRASE STRATEGY L2 below for the multi-bridge worked example.
     4. Repeat until every gap in every targeted phrase is ≤ 3 non-article words.

     ============================================================================
     LONG-PHRASE STRATEGY — when an approved phrase has 12+ content words
     ============================================================================

     Long phrases (12+ content words, ignoring articles) are the #1 cause of
     coverage failure. The score formula is matched_tokens / path_span, so a
     15-word phrase with anchors 14 words apart needs ~14 matched tokens to hit
     .95. A short script with 3-4 tokens scores around .25, far below threshold.

     Five explicit strategies to handle long phrases. Pick the one that fits
     the phrase\'s actual shape:

     STRATEGY L1 — SHRINK THE PATH SPAN BY PICKING CLOSE ANCHORS
       Long phrases often contain distinctive words SCATTERED across the full
       length. Don\'t anchor on all of them. Pick 2-3 anchors that SIT CLOSE
       TOGETHER in the phrase, and ignore the rest.

       Example phrase (17 words):
         "my computer was hacked, and a purchase was made for five hundred
          dollars worth of gift cards from Amazon"
       Distinctive words at positions: hacked(4), purchase(7), made(9),
                                       dollars(11), gift cards(14-15), Amazon(17)
       WRONG (wide span):
         hacked / (gift [cards card]) / Amazon
         Path span: 17-4 = 13 words. Numerator: ~4. Ratio: ~0.31 ✗
       RIGHT (close anchors, ignoring distant ones):
         hacked
         (purchase made)
         (dollar (gift [cards card]))
         Path span: 15-4 = 11 words. Numerator: 1+2+3 = 6. Ratio: ~0.55 ✗
       STILL NOT ENOUGH — needs L2 or L4 in addition.

     STRATEGY L2 — DENSIFY THE PATH WITH MULTIPLE {} BRIDGES
       Once anchors are picked, fill the gaps between them with {} bridges
       containing the actual words from the phrase. Multi-bridge expected for
       multiple wide gaps.

       Continuing the example:
         hacked
         {and a purchase was made for}    <- bridges gap between hacked and purchase
         (purchase made)
         {for five hundred}               <- bridges gap before dollars
         (dollar (gift [cards card]))
       Path span: 11 words. Numerator: 1 + 6 (bridge 1) + 2 + 3 (bridge 2) + 3 = 15
       (but capped at the path span = 11). With bridge words hitting in order,
       ratio approaches 0.9+.

       KEY: bridge contents come FROM THE PHRASE. Read the words in the actual
       gap and put them in {} in left-to-right order. Don\'t invent bridge words.

     STRATEGY L3 — USE DISTINCTIVE "" LITERALS TO ANCHOR LONG PHRASES
       Long phrases often contain 2-4 word verbatim chunks that are highly
       distinctive ("from Walmart", "random account", "five hundred dollars",
       "not accept", "purchase was made"). These chunks LOCK precision while
       contributing multiple words to the numerator.

       Example phrase (18 words):
         "I would just bought some Apple gift cards, two of them, from Walmart,
          and they would not accept the second one"
       Three distinctive chunks: "gift cards" / "from Walmart" / "not accept"
       Script:
         "gift cards"
         "from Walmart"
         "not accept"
       Path span: ~9 words (gift cards to not accept).
       Numerator: 2 + 2 + 2 = 6.
       Ratio: 6/9 = 0.67 — still tight, but bridgeable to .85+. For .95, add a
       {} bridge between two of the literals containing the actual gap words.

     STRATEGY L4 — SPLIT THE PHRASE INTO TWO SCRIPTS BY SUB-INTENT
       Some long phrases contain TWO sub-intents bolted together with "and" or
       similar. Each sub-intent can be its own script targeting a SUBSET of the
       phrase.

       Example phrase (30+ words):
         "I\'m saying that there are some times when he does transactions for,
          like, gift cards and stuff or hide transactions to a random account,
          that\'s going to his boyfriend that we\'ve determined as a scammer"
       Two sub-intents: (1) transactions with gift cards, (2) scam/scammer context.
       Don\'t try to write one script that catches the whole phrase. Write:
         Script X (transactions sub-intent):
           transactions
           (gift [cards card])
           (stuff {or} "random account")
       This catches the relevant portion of the long phrase. Score is computed
       on THE PORTION the script matches, not the full transcript — so a script
       anchored at positions 12-25 has a path span of 13, not 30.

       KEY INSIGHT: the AND-gate doesn\'t require the script to match the FULL
       phrase. It requires the script\'s tokens to match SOMEWHERE in the phrase,
       in order. So you can target the dense middle portion and ignore the
       beginning/end of a long rambling phrase.

     STRATEGY L5 — ACCEPT IRREDUCIBILITY AND MARK PENDING
       Some long phrases are genuinely irreducible: scattered distinctive words
       with no dense cluster, no distinctive verbatim chunks, no sub-intent
       partition that captures the meaning. Trying to script these at .95
       threshold produces broken output.

       The correct action: mark the phrase as "pending" in the analysis output
       with a reason like "phrase too long with no dense anchor cluster — would
       need threshold relaxation."

       This is BETTER than:
         - Shipping a script with 8 tokens hoping for the best (it won\'t hit .95)
         - Lowering the threshold below user-specified (breaks the threshold contract)
         - Padding the script with weak anchors (creates false positives)

     ============================================================================
     LONG-PHRASE PROCESS — APPLY IN ORDER:
       1. Count content words in the phrase. If 12+, this is a long phrase.
       2. Scan for distinctive verbatim chunks (2-4 words) -> if 2+, try L3.
       3. Scan for sub-intent split points (and / or / "but" connectors with
          coherent sub-intents on each side) -> if found, try L4.
       4. Identify cluster of distinctive anchors close together -> try L1 + L2.
       5. If none of L1-L4 produces a script that realistically clears
          threshold in gap walk -> apply L5 (mark pending).
     ============================================================================

  E. PRE-FLIGHT THE SCRIPT (before outputting JSON)
     Run all 5 CHECKS — these are the structural correctness audits:

       CHECK 1 — NO DUPLICATES inside any {} vs the line IMMEDIATELY BEFORE and the
                 line IMMEDIATELY AFTER. Every word in {} must be absent from both
                 neighbours at any nesting depth. (Real failure: duplicates have
                 dropped scores from .97 to .89 in testing.) See section 2.5.

       CHECK 2 — REMOVAL TEST on every token. For each token in the script, ask:
                 "If I remove this token, does any approved phrase LOSE an essential
                 anchor?" YES = keep, NO = remove. See section 1.1.5.

       CHECK 3 — GAP WALK every targeted phrase. For each adjacent pair of script
                 tokens, count non-article words in the gap. If 4+, add {} bridge
                 or pick closer anchors. Estimate the resulting score per phrase
                 must clear threshold. See Section D LONG-PHRASE STRATEGIES.

       CHECK 4 — {} POSITION: no {} as the first or last line of the script.
                 {} is a bridge — it must sit BETWEEN two anchor lines. See section 2.5.

       CHECK 5 — CROSS-TOKEN ANCHOR REDUNDANCY (within one script): no anchor
                 concept should be required by two different top-level AND tokens
                 OF THE SAME SCRIPT. The AND-gate requires each top-level token to
                 match a DIFFERENT occurrence in the transcript — if "gift cards"
                 appears in both token 1's alternative AND as token 3, the phrase
                 must contain "gift cards" twice. Fix by removing one. NOTE: reusing
                 a topic anchor ACROSS different scripts is fine and expected.

  F. CROSS-SCRIPT CONSOLIDATION PASS (after all phrases processed, before output)
     Once every approved phrase has been assigned to a script via A-E, look at the
     resulting script set as a whole. Some scripts may have ended up STRUCTURALLY
     SIMILAR enough to be merged into one. This pass collapses them.

     WHY: a script set of 3 tight scripts is easier to maintain and review than 6
     scripts with overlapping shape. The B-section merges absorbed individual phrases
     into existing scripts; this F-section absorbs whole scripts into each other when
     they emerge looking similar.

     PAIRWISE MERGE CANDIDATES — for every pair of scripts (a, b):

     F1. SAME AND-LINE COUNT?
         Both scripts must have the same number of AND lines (counting {} bridges
         and :-1 guards). If the counts differ, no merge possible — moving on.

     F2. POSITION-BY-POSITION COMPATIBLE?
         Walk the two scripts in parallel, line by line. At each position, the two
         tokens must be of compatible TYPE — both [OR groups], or both (phrase groups),
         or both {} bridges, or one is a plain keyword and the other is an [OR group]
         containing that keyword.

         INCOMPATIBLE — different types at one position:
           Script a line 2: [raise start]
           Script b line 2: {to gonna}              <- bridge vs OR group — incompatible
         COMPATIBLE — same type, can be unioned:
           Script a line 2: [raise start]
           Script b line 2: [escalate boost]        <- both OR groups — can union to [raise start escalate boost]
         COMPATIBLE — plain keyword and OR group containing it:
           Script a line 2: credit                  <- plain keyword
           Script b line 2: [credit account]       <- OR group containing it — union to [credit account]

         If ANY position is incompatible, no merge possible — moving on.

     F3. NEGATION GUARDS COMPATIBLE?
         If either script has an embedded :-1 guard, the merged script must keep
         it without suppressing the OTHER script's relevant phrases.

         SAFE: both scripts share the same negation context (same approved/non-relevant pattern)
              -> merge the :-1 guards into one [] with union of negation words
         UNSAFE: each script's :-1 guards a different non-relevant phrase that the
                other script's phrases might accidentally contain
              -> do not merge

     F4. MERGE BY UNIONING TOKENS AT EACH POSITION
         If F1, F2, F3 all pass, build the merged script:
           - For each line position, take the UNION of tokens from both scripts
           - [OR groups] union by concatenating unique options
           - (phrase groups) at the same position become alternatives in one [] line
             e.g. line is (close session) in a and (reach out) in b -> [(close session)(reach out)]
           - {} bridges union by concatenating unique non-article words
           - Plain keywords get wrapped into [] with the other script's tokens

         WORKED EXAMPLE:
           Script a (3 lines):
             [(haven't heard back)(heard back for)]
             {a while}
             [(close this session)(closing this session)]
           Script b (3 lines):
             [(haven't heard from you)(I haven't heard)]
             {a while}
             [(reach out)(chat in)(chatting with)]
           Both have 3 lines, all positions compatible (OR-OR, {}-{}, OR-OR).
           Merged script:
             [(haven't heard back)(heard back for)(haven't heard from you)(I haven't heard)]
             {a while}
             [(close this session)(closing this session)(reach out)(chat in)(chatting with)]
           One script catches everything both originals caught. Three lines instead of six.

     F5. RE-VALIDATE THE MERGE — run E (pre-flight) on the merged script
         The merge can only ship if:
           - Every approved phrase from BOTH original scripts still passes the
             AND-line gate (every AND line has a hit in the phrase)
           - Gap walk still passes (≤ 3 non-article gap for every targeted phrase)
           - No duplicates introduced in {} versus the new neighbouring lines
           - {} still sits between two anchor lines

         If pre-flight fails on the merged script, ABANDON THE MERGE. Keep the two
         original scripts as they were. A failed merge is a no-op — never ship a
         merge that breaks coverage of even one approved phrase.

     CONSERVATIVE BIAS:
     Only merge when F1-F4 produce a clean structural match. Do NOT force merges by
     restructuring scripts to match each other — that's how coverage gets lost.
     Two clean separate scripts are better than one over-merged script that misses
     phrases. If in doubt, leave them separate.

  G. FINAL VERIFICATION PASS — BEFORE EMITTING JSON (PRODUCTION GUARD)

     Production scripts run against 10,000+ call transcripts. A single false
     positive vector multiplies into hundreds of bad insights. A single missed
     phrase fails the category. This pass closes both risks through a forced
     per-phrase verification step.

     COMMON FAILURE MODE THIS PASS PREVENTS:
     The AI assigns scriptLetter to a phrase based on intent ("this script was
     designed for this phrase") WITHOUT actually verifying that the script
     clears threshold on the phrase. The output then claims coverage that
     doesn't exist when the scripts are tested. This is the #1 cause of
     low real-world recall despite high reported recall.

     G1. BUILD THE COVERAGE VERIFICATION TABLE (mandatory before any JSON emit)

         For EACH approved phrase in the input, fill out one row:

           | Phrase                  | Best script | Est. score | Verified? |
           |-------------------------|-------------|------------|-----------|
           | "phrase 1 text..."      | a           | 0.96       | YES       |
           | "phrase 2 text..."      | a           | 0.78       | NO → pending |
           | "phrase 3 text..."      | -           | -          | pending (uncoverable) |
           | "phrase 4 text..."      | b           | 1.00       | YES       |

         How to fill each row:

           Step 1 — BEST SCRIPT: For this phrase, identify which existing script
           is the best candidate (the one most likely to fire on it).

           Step 2 — AND-GATE CHECK: Walk every top-level AND token of that
           script against the phrase, left to right. Does the phrase contain
           content satisfying each token, in order? If ANY token has no hit,
           the script does not fire on this phrase. Row = pending.

           Step 3 — GAP WALK + SCORE ESTIMATE: If the gate passes, count the
           path span (first matched word to last matched word in the phrase).
           Count the matched tokens including any {} bridge words that hit.
           Estimate: matched / span. This is the est. score.

           Step 4 — VERIFICATION: Is est. score >= threshold (default .95)?
             YES -> Verified = YES. scriptLetter = the chosen script letter.
             NO  -> Verified = NO. scriptLetter is NOT emitted. Status = pending.

           Step 5 — IF NOT VERIFIED, TRY TO FIX FIRST: before accepting pending,
           try LONG-PHRASE STRATEGIES L1-L5 from Section D. Try absorbing into
           a DIFFERENT existing script via B1-B5. Only after honest attempts
           fail does the row stay at pending.

     G2. STRICT VERIFICATION RULE (THIS IS NON-NEGOTIABLE):

         In the analysis array of the output JSON:
           - scriptLetter is ONLY emitted for phrases with Verified = YES in
             the coverage table. Never assign a scriptLetter based on intent
             alone or because the script was built with that phrase in mind.
           - If you have not walked the gap walk math and estimated the score
             clears threshold, the phrase MUST have status = "pending".
           - "pending" is the correct, honest output for any phrase you cannot
             verify clears threshold against an existing script. It is NOT a
             failure marker — it tells the user which phrases need attention.

         This rule prevents the most common failure: the AI claiming coverage
         that doesn't actually exist when scripts are tested.

     G3. SCRIPT DELETION — REMOVE ORPHAN SCRIPTS

         After the coverage table is complete: any script that is NOT the
         "Best script" for at least one Verified = YES row must be DELETED
         from the output. A script that doesn't fire as the primary catch
         for any verified phrase is dead weight — it adds maintenance cost
         and false-positive risk without contributing coverage.

         The output scripts[] array contains only scripts that catch at least
         one phrase at >= threshold.

     G4. FALSE-POSITIVE SCAN

         For each remaining script in your set, mentally generate 3-5 phrases
         that would "almost" match — same topic words but different intent.
         Walk these almost-matches through the script:
           - Does the AND-gate fail on the almost-match? -> good, FP avoided
           - Does the almost-match satisfy every AND token? -> POSSIBLE FP
             -> Tighten by adding a () unit lock, an extra anchor, or a :-1 guard.

         The non-relevant phrases in the input set are the FIRST source of FP
         vectors. For each non-relevant phrase, verify NO script fires on it
         (gate fails OR score below threshold). If a script does fire on a
         non-relevant phrase, apply Part 5 Rule A.

     G5. HONEST PRECISION AND RECALL

         Calculate from the coverage table:
           recall = (rows with Verified = YES) / (total approved phrases)
           precision = (relevant phrases that fire) / (all phrases that fire)

         Report these honestly in the output JSON. If recall is below 0.8,
         that is the true state — do NOT inflate the number. The user needs
         the accurate recall to know which phrases need attention (the
         pending rows).

     G6. EMIT THE OUTPUT JSON
         Only after G1-G5 are complete. The analysis array reflects the
         coverage table exactly: Verified = YES phrases get scriptLetter,
         everything else gets status = "pending".

     CALIBRATION FOR PRODUCTION SCALE:
       - At 10,000 calls, a 1% false positive rate = 100 bad insights per category.
       - Prefer ONE more script (extra precision) over ONE looser script (FP risk).
       - When uncertain between tighter and looser, choose TIGHTER and rely on
         multiple scripts in the set to capture variation.
       - Cross-product false positives (flat [a b] / [c d] firing on "a d" when
         only "a c" and "b d" were in phrases) are the #1 cause of FP at scale.
         Lock cross-products with () units whenever the phrase set has only
         specific combinations.

THE BENEFIT OF THIS ORDER:
  - Merging happens DURING construction, not after. Most phrases are absorbed at B2/B3.
  - The same algorithm handles 1 phrase or 100 phrases — no special cases.
  - Bracket choices are forced by which step succeeds: B2 adds a new () alternative,
    B3 widens an [], B4 adds {}, B5 wraps inversions as (order1)(order2) alternatives.
  - Gap walking is run on every new script during construction (D), not just at
    output. Fixing gaps mid-construction is faster than after.
  - Pre-flight (E) catches the duplicates / removable tokens / {} placement issues
    that have caused real failures in past testing.
  - Cross-script consolidation (F) catches scripts that ended up structurally similar
    after independent construction. Collapses them when safe. Halves script count in
    the right scenarios without losing coverage.
  - Final verification (G) is the production guard: it checks that every approved
    phrase is covered, that no false-positive vector slips through, and that
    threshold scoring is realistic. Required before output.

BRACKET DECISION SUMMARY (which bracket for which job):
  [OR group]       — OR over any tokens (words, (), \"\", or NESTED [] / ())
  (phrase group)   — UNIT: makes whatever's inside act as one token from outside.
                     Contains: words, [], (), \"\", {}, or any nested combination.
                     Internal words still count for path-score (score-transparent).
  {optional words} — non-article connector words bridging a 4+ word gap. PLAIN WORDS ONLY.
  \"exact phrase\"   — literal fixed wording (rare). PLAIN WORDS ONLY, max ~5 words.
  :-1              — negation weight on ANY token at ANY depth (word, \"\", [], (), nested)

  [] and () compose freely with each other to any depth. {} and \"\" do NOT nest —
  they hold plain words only. :-1 attaches to any token, including a deeply nested one.

  WHEN TO REACH FOR (): any time something must act as ONE thing in the structure
  (one slot in an [], one AND line, one negation unit). Wrap it in () even if it
  contains [OR groups] or other ()'s. Examples: (gift [card cards]), ([the my] credit),
  ([please can] [you we] help) — each is one unit despite internal complexity.


═══════════════════════════════════════════════════════════════════════════════
PART 4 — MERGING REFERENCE (catalogue of patterns)
═══════════════════════════════════════════════════════════════════════════════

The master algorithm Section B (B1-B5) and Section F handle merging operationally.
This part is a quick-reference catalogue for choosing the right nesting pattern.

# 4.1 Guiding Principle

Merge decisions depend on the CATEGORY being built and the PHRASE SET, not on
abstract structural rules. First ask "does this phrase belong in the same category
as the existing scripts?" — if YES, run B1-B5 to merge; if NO (opposite intent,
wrong topic), keep it out even when the structure looks identical.

SAFE merge  = the new AND line is satisfied by EVERY phrase the script already covers
UNSAFE merge = the new AND line is missing from even ONE approved phrase
  Example UNSAFE: Script "training / [great awesome]" already covers "training is great".
  Adding [I he she] in between would break that phrase (it has no I/he/she).

# 4.2 Nesting Patterns by Phrase Shape

SHALLOW — flat OR over parallel concepts:
  [(direct interest) (premium interest) (benefits checking) (tell a friend)]

SHALLOW — separate AND lines, each a flat OR:
  [confirm confirming verify]
  [(missing items) (items there) (items missing)]

INVERSION inside one OR line:
  [(visa [invitation application] letter) ([invitation application] letter for visa)]

INDEPENDENT VARIATION — subject + verb + topic each varying:
  Phrases: "I will get a credit raised" / "he raised the credit" / "let me start the credit"
  Script:
    [I he she we (let me)]
    [get put raise raised start]
    credit

EMBEDDED NEGATION — detection + suppression in one script:
  Relevant: "training is great"   Non-relevant: "training is not great"
  Script:
    training
    [not isn\'t wasn\'t]:-1
    [great awesome bomb]

LOCKED COMBINATIONS — multiple slots with internal locks:
  Phrases: "can I help you" / "can we help you" / "may I assist" / "could you help"
  WRONG (flat — loses precision, fires on cross-products):
    [can could may] / [I we you] / [help assist]
  RIGHT (() units lock the valid combinations):
    [(can [I we] [help assist] you)
     (may I [help assist] you)
     ([could would] you [help assist])]

SEPARATE SCRIPTS — different speakers, two scripts:
  Script a (agent offering):
    [(can I) (shall I) (let me) (I can)]
    [book arrange schedule]
    [valuation evaluation]
  Script b (customer requesting):
    [(can you) (could you) wanna]
    [book arrange schedule]
    [valuation evaluation]

# 4.3 Quick Pattern Lookup

  Same layers, different topic phrase
    -> add a new () to the existing [] at the topic slot

  Same words, different subject/speaker
    -> widen the subject [OR group]

  Same phrase, different tense
    -> add tense variants to the action [OR group]

  Non-relevant phrase shares anchor structure with relevant, distinguishing
  word(s) sit between existing anchors
    -> embed :-1 at the natural position (the distinguishing word is whatever
       differentiates non-relevant from relevant)

  Colloquial variant of existing phrase
    -> add as an additional () inside the existing []

# 4.4 When to Create a New Script (not merge)

  - Word order inversion at the AND-line level — first try [(order1) (order2)]
    inside one [] (merge). Create a new script only when path-scoring needs more
    word coverage than one script can carry, or when sequences genuinely flip.
  - An extra AND line would break coverage of any existing approved phrase.
  - Different intent type (offering vs requesting vs confirming) — but only when
    the category scope distinguishes them. If the category covers both, merge.
  - Opposite-meaning words — only when category scope EXCLUDES the opposite. If
    broad ("credit limit changes"), include both in one [OR]. If narrow ("credit
    limit increases"), the opposite phrase becomes non-relevant and gets :-1.

THERE IS NO MAXIMUM NESTING DEPTH. Nest as many levels deep as the approved phrases require.
LABELS: a, b, c … z then aa, bb, cc … zz.

═══════════════════════════════════════════════════════════════════════════════
PART 5 — NEGATION RULES
═══════════════════════════════════════════════════════════════════════════════

# Rule A — Text Non-Relevant Phrases: Two Cases

KEY PRINCIPLE: :-1 negates ANY word or phrase that signals non-relevance for THIS
category. Not just "not / isn't / wasn't" — those are common but not the only ones.
The distinguishing word is whatever differentiates the non-relevant phrase from the
relevant ones. Build the :-1 list from the actual non-relevant phrases provided.

CASE 1 — Distinguishing word naturally falls between anchor words of a relevant phrase:
  Embed the :-1 guard inside the detection script at that natural position.
  Do NOT write a separate negation script.

  Example 1 (classic negation word):
  Relevant: "training is great"   Non-relevant: "training is not great"
  -> embed [not isn't wasn't]:-1 between training and [great awesome]

  Example 2 (non-classic — category: cancel subscription):
  Relevant: "I want to cancel"   Non-relevant: "I want to keep my subscription"
  -> embed [keep continue retain]:-1 between [I want] and [cancel]

CASE 2 — Contextually wrong phrase (different topic/domain, no shared structure):
  Write a dedicated standalone negation script in scripts[] with its own letter.
  Do NOT embed inside detection scripts — the detection script isn't firing on it.

  Example: Relevant: "training is great"
  Non-relevant: "it cooled down outside after training"
  -> Script b: (cooled down outside):-1 / training

THE TEST: does the non-relevant phrase share the SAME anchor structure as a
relevant phrase, with one or more words DIFFERENT in a way that signals non-relevance?
  YES -> Case 1: embed :-1 inside detection script at the position of the differing word(s)
  NO (different topic / unrelated context) -> Case 2: dedicated standalone negation script


# Rule B — Screenshot Non-Relevant Phrases: Score Color Determines :-1 Need

  Red thumb + GREEN score -> false positive currently firing -> MUST get :-1 guard (embed in relevant scripts)
  Red thumb + RED/ORANGE score -> already suppressed below threshold -> NO :-1 needed
  ALL red thumbs are non-relevant. Score only determines if a :-1 fix is additionally needed.


# Rule C — Two Types of Negation

TYPE 1 — BROAD CONTEXT SUPPRESSOR [OR group]:-1
  Deliberately wide. Suppresses an entire semantic context, not one specific phrase.
  Collect all words that signal "wrong topic/context" and put :-1 on the whole group.
  Exact phrases and (phrase groups) can live inside:
    [like should technical more add (clear by) thought "not requiring" "paper work"]:-1

TYPE 2 — SURGICAL (phrase group):-1
  Narrow. Targets one specific false positive phrase. Extract distinctive words:
    ("see how much is in" "my checking account"):-1

COMPLEX — ([OR group] (phrase group)):-1
  Nest both inside () with :-1 to suppress a specific context+phrase combination:
    ([non not isn't wasn't] (clear by)):-1

CHOOSE:
  - Wrong context/topic         -> TYPE 1: wide [OR group]:-1
  - Specific false positive     -> TYPE 2: narrow (phrase group):-1
  - Specific context + phrase   -> COMPLEX: ([OR] (phrase group)):-1


# Rule D — Placement (Maps to Rule A's Two Cases)

Rule A defined two cases for text non-relevant phrases. Rule D says where the
:-1 actually goes in each case:

CASE 1 (from Rule A) — Distinguishing word falls between anchors of a relevant phrase
  -> embed :-1 INSIDE the detection script at that natural position.
  Do NOT create a separate negation script for the same phrase.

  Relevant: "training is great"   Non-relevant: "training is not great"
    Script a: training / [not isn't wasn't]:-1 / [great awesome bomb]
  No standalone script — the guard sits inline where the negation word appears.

CASE 2 (from Rule A) — Different topic/domain, no shared anchor structure
  -> write a DEDICATED standalone negation script in scripts[] with its own letter.
  Do NOT embed inside the detection script — the detection script doesn't fire on
  this phrase anyway, and adding the guard there risks suppressing real relevant
  phrases that happen to share some of those words.

  Relevant: "training is great"
  Non-relevant: "it cooled down outside after training"
    Script a: training / [not isn't wasn't]:-1 / [cool great awesome bomb]  <- clean
    Script b: (cooled down outside):-1 / training                            <- dedicated

SCREENSHOT FALSE POSITIVE (red thumb + GREEN score)
  -> embed :-1 INSIDE each relevant script that is actively firing on it.
  Functionally Case 1 — the false positive shares structure with the relevant phrase.

NO DOUBLE-GUARDING: whichever placement you choose for a given non-relevant
phrase, do NOT also use the other approach. Pick one, not both.


# Rule E — The Threshold Contract

Just as relevant phrases must score AT OR ABOVE the user threshold, non-relevant
phrases must score BELOW it. The :-1 guards exist to push the score below threshold
— not just to subtract some points.

  Relevant phrase     -> score ≥ threshold (e.g. ≥ .95) -> script fires
  Non-relevant phrase -> score < threshold  (e.g. < .95) -> script does NOT fire

If a :-1 guard is too weak, the non-relevant phrase can still score above threshold
and fire as a false positive. To strengthen guards:

  1. PREFER BROAD [OR group]:-1 over narrow ("phrase"):-1 when the wrong context
     has multiple distinguishing words. Each match in the [OR group]:-1 pulls the
     score down further.

  2. STACK MULTIPLE :-1 LINES if a single guard isn't enough:
       [not isn't wasn't]:-1
       [(cooled down) (down outside)]:-1
     Two guards working together push the score lower than either alone.

  3. PLACE :-1 GUARDS AT THE NATURAL POSITION where the negation/wrong-context
     word actually appears. A guard placed off-position may not match at all.

THE MENTAL MODEL: every :-1 hit subtracts from the path score. Tune guards so the
non-relevant phrase's final score lands BELOW the user threshold, and the relevant
phrase's score stays AT OR ABOVE it.

  WRONG mindset:   ":-1 added, job done."
  CORRECT mindset: "After this :-1, does the non-relevant phrase still score above
                    threshold? If yes, the guard is too weak — broaden or stack."

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

YOUR RESPONSE MUST START WITH { ON THE VERY FIRST CHARACTER.
No steps, no classification text, no markdown, no preamble.

Return ONLY a valid JSON object. No text before or after. No markdown fences. No trailing commas:

{"categoryName":"...","definition":"...","analysis":[{"phrase":"...","status":"relevant","scriptLetter":"a","why":"..."}],"scripts":[{"letter":"a","lines":["line1"],"covers":"...","threshold":".95"}],"synonyms":{"word":["s1","s2","s3"]},"precision":"1.00","recall":"0.95"}

REMINDERS:
- BEFORE EMITTING: run Section G FULLY. Build the coverage verification table
  first (G1), apply the strict rule (G2), delete orphan scripts (G3), run FP
  scan (G4), calculate honest precision/recall (G5).
- STRICT VERIFICATION RULE (G2): scriptLetter is ONLY emitted for phrases whose
  estimated score against that script clears threshold (Verified=YES in coverage
  table). Phrases you haven't gap-walked and verified MUST have status="pending".
  Never assign scriptLetter based on intent or because the script was designed
  with that phrase in mind. This is the #1 cause of bad output — DO NOT skip.
- DYNAMIC SCRIPT COUNT: build each script to cover as MANY phrases as possible.
  Create a new script ONLY when a phrase truly cannot be absorbed into any
  existing script (every B1-B5 attempt fails). No fixed target — script count
  emerges from the phrase set.
- DELETE ORPHAN SCRIPTS (G3): any script that is not the "Best script" for at
  least one Verified=YES phrase must be removed from scripts[]. Do not emit
  scripts that don't catch anything.
- Text non-relevant phrases -> follow Rule A's two cases: embed :-1 inside the
  detection script (Case 1) OR write a dedicated standalone negation script
  (Case 2). Never both.
- Screenshot false positives -> embed :-1 inside each relevant script, no separate letter
- status must be exactly: "relevant" | "nonrelevant" | "pending"
- Target threshold .95 unless told otherwise
- Use only words that appear in the approved phrases — never invent
- HONEST RECALL: recall in the output JSON = (Verified=YES phrases) / (total
  approved phrases). Do not inflate. If recall is below 0.8, that is the true
  state — the pending phrases tell the user where to look.
- Production scale: 10,000+ calls. Tighter beats broader. When in doubt,
  add a () unit to lock combinations rather than leave flat [a b] / [c d] cross-products.`;

const DEFAULT_COMPARE_SYS = `You are a Tethr QA analyst. Compare AI vs human scripts, find gaps, return merged improvements.
Return ONLY a valid JSON object. No text before or after. No markdown fences. No trailing commas:
{"score":"8/10","summary":"...","coverage":{"both":[],"humanOnly":[],"aiOnly":[],"neither":[]},"missingPatterns":[],"actionItems":[],"improvedScripts":[{"letter":"a","lines":[],"covers":"...","threshold":".95"}]}`;
const LARGE_INPUT_BUILD_SUFFIX = `

LARGE INPUT EXECUTION NOTE:
- Follow all script-building rules from the main system prompt above.
- This scale mode exists only to keep large runs stable; it does NOT replace the main build prompt.
- Preserve distinct scripts when phrases differ by order, intent, or topic structure. Do not merge scripts just to reduce count.
- For this generation step only, return a compact JSON object with:
  {"categoryName":"...","definition":"...","scripts":[{"letter":"a","lines":["line1"],"covers":"...","threshold":".95"}],"synonyms":{"word":["variant1","variant2"]}}
- Do not include analysis, precision, or recall in this step; those are handled separately after script generation.
- Return valid JSON only.`;
const DEFAULT_ANALYSIS_SYS = `You are a Tethr QA analyst.

Given scripts plus a list of phrases, judge each phrase in order and return ONLY one valid JSON object:
{"analysis":[{"phrase":"...","status":"relevant"}]}

Rules:
- Return exactly one analysis item per input phrase, in the same order.
- status must be exactly one of: "relevant", "nonrelevant", "pending".
- expectedStatus tells you the source label:
  - relevant: mark "relevant" only if a script clearly covers it at threshold, otherwise "pending"
  - pending: mark "relevant" if clearly covered, otherwise "pending"
  - nonrelevant: mark "nonrelevant" if the scripts should not fire; mark "pending" if a script might fire or you are unsure
- No markdown, no explanations outside the JSON object.`;
function buildScriptsText(scripts) {
  return (scripts || []).map((s) => `Script ${s.letter}:\n${(s.lines || []).join("\n")}\nThreshold: ${s.threshold || ".95"}\nCovers: ${s.covers || ""}`).join("\n\n");
}
function getSaidByLabel(saidBy) {
  return (saidBy || "any")==="internal"
    ? "Internal (agent/rep only)"
    : (saidBy || "any")==="external"
    ? "External (customer only)"
    : "Any (agent or customer)";
}
function buildParticipantGuidance(saidBy) {
  if ((saidBy || "any") === "internal") {
    return "Focus scripts on agent-led phrasing — first-person agent speech, offering/action intent, [I he she we (let me)] as subject layer.";
  }
  if ((saidBy || "any") === "external") {
    return "Focus scripts on customer-led phrasing — requesting, questioning, expressing intent. Use [you your] as subject layer where relevant.";
  }
  return "Scripts should cover both agent and customer phrasing patterns.";
}
function shouldUseScalableMode({ images, generationRelevant, nonRelevant, contextText, defText }) {
  if (images.length) return false;
  const phraseCount = generationRelevant.length + nonRelevant.length;
  const chars = [...generationRelevant, ...nonRelevant].join("\n").length + String(contextText || "").length + String(defText || "").length;
  return phraseCount >= LARGE_INPUT_PHRASE_THRESHOLD || chars >= LARGE_INPUT_CHAR_THRESHOLD;
}
function buildScalableGenerationText({ defText, contextText, saidBy, threshold, generationRelevant, nonRelevant, pending, clusters }) {
  let text = `Category definition: ${defText.trim() || "Not provided"}\n`;
  text += `Said by: ${getSaidByLabel(saidBy)}\n`;
  text += `${buildParticipantGuidance(saidBy)}\n`;
  text += `Threshold: ${threshold}\n\n`;
  if (contextText?.trim()) text += `Context examples:\n${contextText.trim()}\n\n`;
  if (clusters?.length) text += `Deterministic cluster scaffold:\n${formatClusterSummary(clusters)}\n\n`;
  if (generationRelevant.length) text += `Relevant and pending phrases to cover:\n${generationRelevant.map((phrase, index) => `${index + 1}. ${phrase}`).join("\n")}\n\n`;
  if (pending.length) text += `Pending subset inside the cover list:\n${pending.map((phrase, index) => `${index + 1}. ${phrase}`).join("\n")}\n\n`;
  if (nonRelevant.length) text += `Non-relevant phrases to avoid:\n${nonRelevant.map((phrase, index) => `${index + 1}. ${phrase}`).join("\n")}\n\n`;
  text += "Return a compact script set only. No phrase-by-phrase analysis.";
  return text;
}
function buildAnalysisChunkText({ scripts, chunk, threshold }) {
  return [
    `Threshold: ${threshold}`,
    "",
    "Scripts:",
    buildScriptsText(scripts),
    "",
    "Phrases to judge in order:",
    ...chunk.map((item, index) => `${index + 1}. [${item.expectedStatus}] ${item.phrase}`),
  ].join("\n");
}

const toB64 = (f) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res({ b64: r.result.split(",")[1], url: URL.createObjectURL(f), type: f.type, name: f.name });
  r.onerror = rej;
  r.readAsDataURL(f);
});

const makeCSV = () => [
  ["Category Definition","Phrase","Status","Notes"],
  ["Agent requesting a property valuation","Have you had a valuation with us?","Relevant","Direct ask"],
  ["","Can I book you in for an evaluation?","Relevant","Booking intent"],
  ["","When are you available for a valuation?","Relevant","Scheduling"],
  ["","Are you on the market?","Relevant","Market check"],
  ["","Would you like to validate your balance?","Non-Relevant","Wrong domain"],
  ["","I see you're not ready for an evaluation","Non-Relevant","Negation"],
  ["","Let me check when we last spoke","Pending","Needs review"],
].map((r) => r.map((c) => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");

// Find matching closing bracket accounting for nesting depth
function findClose(str, start, open, close) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === open) depth++;
    else if (str[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Recursively colorize content inside [] or ()
function colorizeInner(inner) {
  const parts = []; let j = 0;
  while (j < inner.length) {
    // "exact phrase":-1 → red phrase + red weight
    if (inner[j] === '"') {
      const eq = inner.indexOf('"', j + 1);
      if (eq !== -1) {
        parts.push([inner.slice(j, eq + 1), A.monoRed]);
        j = eq + 1;
        const neg = inner.slice(j).match(/^:-\d+/);
        if (neg) { parts.push([neg[0], A.monoRed]); j += neg[0].length; }
        continue;
      }
    }
    // (phrase group):-1 → blue parens, optional red weight
    if (inner[j] === '(') {
      const ep = findClose(inner, j, '(', ')');
      if (ep !== -1) {
        parts.push(['(', A.monoBlue]);
        colorizeInner(inner.slice(j + 1, ep)).forEach(p => parts.push(p));
        parts.push([')', A.monoBlue]);
        j = ep + 1;
        const neg = inner.slice(j).match(/^:-\d+/);
        if (neg) { parts.push([neg[0], A.monoRed]); j += neg[0].length; }
        continue;
      }
    }
    // nested [list]:-1 inside () or []
    if (inner[j] === '[') {
      const eb = findClose(inner, j, '[', ']');
      if (eb !== -1) {
        parts.push(['[', A.monoBlue]);
        colorizeInner(inner.slice(j + 1, eb)).forEach(p => parts.push(p));
        parts.push([']', A.monoBlue]);
        j = eb + 1;
        const neg = inner.slice(j).match(/^:-\d+/);
        if (neg) { parts.push([neg[0], A.monoRed]); j += neg[0].length; }
        continue;
      }
    }
    // {bridge} inside group → teal
    if (inner[j] === '{') {
      const eb = inner.indexOf('}', j);
      if (eb !== -1) { parts.push([inner.slice(j, eb + 1), A.monoTeal]); j = eb + 1; continue; }
    }
    // plain keyword:-1 inside group — detect word followed by :-N
    const negWord = inner.slice(j).match(/^([^\s\[\](){}":-]+)(:-\d+)/);
    if (negWord) {
      parts.push([negWord[1], A.monoBlue]);
      parts.push([negWord[2], A.monoRed]);
      j += negWord[0].length;
      continue;
    }
    // plain text until next special char
    const nx = inner.slice(j).search(/["([{\]]/);
    if (nx === -1) { parts.push([inner.slice(j), A.monoBlue]); break; }
    if (nx > 0) parts.push([inner.slice(j, j + nx), A.monoBlue]);
    j += nx;
  }
  return parts;
}

const colorize = (line) => {
  const parts = []; let i = 0;
  while (i < line.length) {
    // {gap bridge} → teal
    if (line[i] === '{') {
      const e = line.indexOf('}', i);
      if (e !== -1) { parts.push([line.slice(i, e + 1), A.monoTeal]); i = e + 1; continue; }
    }
    // [OR group] — depth-aware
    if (line[i] === '[') {
      const e = findClose(line, i, '[', ']');
      if (e !== -1) {
        parts.push(['[', A.monoBlue]);
        colorizeInner(line.slice(i + 1, e)).forEach(p => parts.push(p));
        parts.push([']', A.monoBlue]);
        const neg = line.slice(e + 1).match(/^:-\d+/);
        if (neg) { parts.push([neg[0], A.monoRed]); i = e + 1 + neg[0].length; continue; }
        i = e + 1; continue;
      }
    }
    // (phrase group) standalone — depth-aware, supports :-1
    if (line[i] === '(') {
      const e = findClose(line, i, '(', ')');
      if (e !== -1) {
        parts.push(['(', A.monoBlue]);
        colorizeInner(line.slice(i + 1, e)).forEach(p => parts.push(p));
        parts.push([')', A.monoBlue]);
        const neg = line.slice(e + 1).match(/^:-\d+/);
        if (neg) { parts.push([neg[0], A.monoRed]); i = e + 1 + neg[0].length; continue; }
        i = e + 1; continue;
      }
    }
    // "exact phrase":-1 standalone → red phrase + red weight
    if (line[i] === '"') {
      const e = line.indexOf('"', i + 1);
      if (e !== -1) {
        parts.push([line.slice(i, e + 1), A.monoRed]);
        i = e + 1;
        const neg = line.slice(i).match(/^:-\d+/);
        if (neg) { parts.push([neg[0], A.monoRed]); i += neg[0].length; }
        continue;
      }
    }
    // plain text — detect keyword:-1 before falling through
    const negWord = line.slice(i).match(/^([^\s\[\](){}":-]+)(:-\d+)/);
    if (negWord) {
      parts.push([negWord[1], A.text]);
      parts.push([negWord[2], A.monoRed]);
      i += negWord[0].length;
      continue;
    }
    const nx = line.slice(i).search(/[\[{("]/);
    if (nx === -1) { parts.push([line.slice(i), A.text]); break; }
    if (nx > 0) parts.push([line.slice(i, i + nx), A.text]);
    i += nx;
  }
  return parts;
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function ScriptBadge({ letter, size }) {
  const sz = size || 16;
  const bg = getBadgeColor(letter);
  const display = letter && letter.length === 2 ? letter.slice(0,2) : letter;
  const fs = letter && letter.length === 2 ? Math.floor(sz * 0.48) : Math.floor(sz * 0.6);
  return (
    <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:sz, height:sz, borderRadius: Math.floor(sz*0.25), background:bg, color:"#fff", fontSize:fs, fontWeight:700, flexShrink:0, fontFamily:MONO, letterSpacing:0 }}>
      {display}
    </span>
  );
}

function Tag({ label, color, bg }) {
  return <span style={{ fontSize:11, fontWeight:600, padding:"2px 9px", borderRadius:20, background:bg, color:color, letterSpacing:"0.01em" }}>{label}</span>;
}

function Btn({ children, primary, small, danger, onClick, style: sx }) {
  const base = {
    display:"inline-flex", alignItems:"center", gap:5,
    padding: small ? "6px 14px" : "10px 20px",
    borderRadius: small ? 8 : 980,
    border:"none", cursor:"pointer", fontFamily:SF,
    fontSize: small ? 13 : 15,
    fontWeight:500, letterSpacing:"-0.01em",
    transition:"all 0.15s",
  };
  const variant = primary
    ? { background:A.blue, color:"#fff", boxShadow:"0 1px 3px rgba(0,113,227,.35)" }
    : danger
    ? { background:A.redBg, color:A.red, boxShadow:"none" }
    : { background:A.fill, color:A.text, boxShadow:"none" };
  return <button onClick={onClick} style={{ ...base, ...variant, ...(sx||{}) }}>{children}</button>;
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  function doCopy() {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      // silent fail
    }
  }
  return (
    <button onClick={doCopy}
      style={{ fontSize:12, padding:"4px 11px", borderRadius:6, border:"none", background:copied ? A.greenBg : A.fill2, color:copied ? A.green : A.secondary, cursor:"pointer", fontFamily:SF, fontWeight:500, transition:"all .2s" }}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Spinner({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14, padding:"64px 0", color:A.secondary }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:28, height:28, border:"2.5px solid "+A.fill2, borderTopColor:A.blue, borderRadius:"50%", animation:"spin .7s linear infinite" }} />
      <span style={{ fontSize:14 }}>{msg || "Analyzing…"}</span>
    </div>
  );
}

function ErrBox({ msg }) {
  if (!msg) return null;
  return <div style={{ background:A.redBg, borderRadius:A.radiusSm, padding:"12px 16px", color:A.redDk, fontSize:13, marginBottom:16, lineHeight:1.5 }}>{msg}</div>;
}

function Card({ children, style: sx, padding }) {
  return (
    <div style={{ background:A.white, borderRadius:A.radius, boxShadow:A.shadow, overflow:"hidden", ...(sx||{}) }}>
      {padding ? <div style={{ padding: padding === true ? 20 : padding }}>{children}</div> : children}
    </div>
  );
}

function SectionLabel({ children }) {
  return <p style={{ fontSize:11, fontWeight:600, color:A.secondary, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>{children}</p>;
}

function ScriptBlock({ sc }) {
  return (
    <div style={{ borderRadius:A.radiusSm, overflow:"hidden", border:"1px solid "+A.divider, marginBottom:10 }}>
      <div style={{ padding:"9px 14px", background:A.fill, display:"flex", alignItems:"center", gap:8 }}>
        <ScriptBadge letter={sc.letter} size={20} />
        <span style={{ fontSize:12, color:A.secondary, flex:1, fontStyle:"italic" }}>{sc.covers}</span>
        <CopyBtn text={(sc.lines||[]).join("\n")} />
      </div>
      <div style={{ padding:"12px 14px", background:A.white, fontFamily:MONO, fontSize:12.5, lineHeight:2 }}>
        {(sc.lines||[]).map((line, j) => (
          <div key={j}>{colorize(line).map(([t,c], k) => <span key={k} style={{ color:c }}>{t}</span>)}</div>
        ))}
      </div>
      <div style={{ padding:"5px 14px 6px", background:A.fill, fontSize:11, color:A.tertiary }}>
        Threshold: {sc.threshold || ".95"}
      </div>
    </div>
  );
}

function ImgZone({ images, onAdd, label }) {
  const ref = useRef();
  async function handle(files) { onAdd(await Promise.all(Array.from(files).map(toB64))); }
  return (
    <div style={{ marginBottom:14 }}>
      {label && <SectionLabel>{label}</SectionLabel>}
      <div onClick={() => ref.current.click()}
        onDrop={(e) => { e.preventDefault(); handle(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        style={{ border:"1.5px dashed "+(images.length ? A.blue : A.divider), borderRadius:A.radius, padding:18, textAlign:"center", cursor:"pointer", background:images.length ? A.blueBg : A.fill, transition:"all .15s" }}>
        <div style={{ fontSize:24, marginBottom:6 }}>📎</div>
        <p style={{ fontSize:13, color:images.length ? A.blue : A.secondary, margin:0, fontWeight:images.length ? 500 : 400 }}>
          {images.length ? images.length+" screenshot"+(images.length>1?"s":"")+" loaded — click to add more" : "Click or drag & drop screenshots"}
        </p>
        <p style={{ fontSize:12, color:A.tertiary, marginTop:4 }}>PNG / JPG · Reads Tethr phrase lists, R/NR labels and existing scripts</p>
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={(e) => handle(e.target.files)} />
      {images.length > 0 && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
          {images.map((img, i) => (
            <div key={i} style={{ position:"relative" }}>
              <img src={img.url} alt="" style={{ height:64, borderRadius:8, border:"1px solid "+A.divider, display:"block" }} />
              <button onClick={(e) => { e.stopPropagation(); onAdd(null, i); }}
                style={{ position:"absolute", top:-6, right:-6, width:18, height:18, borderRadius:"50%", background:A.red, color:"#fff", border:"2px solid "+A.white, cursor:"pointer", fontSize:11, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, padding:0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── INPUT FIELD ──────────────────────────────────────────────────────────────
const fieldStyle = { width:"100%", background:A.fill, border:"1px solid "+A.divider, borderRadius:A.radiusSm, padding:"10px 13px", color:A.text, fontSize:14, fontFamily:SF, lineHeight:1.6, boxSizing:"border-box" };

// ─── CREATE TAB ───────────────────────────────────────────────────────────────
function CreateTab({ st, setSt, onGenerate }) {
  const csvRef = useRef();
  const [csvPreviewLimit, setCsvPreviewLimit] = useState(CSV_PREVIEW_PAGE_SIZE);
  const set = (k, v) => setSt((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setCsvPreviewLimit(CSV_PREVIEW_PAGE_SIZE);
  }, [st.csvRows?.length]);

  async function handleCSV(e) {
    const f = e.target.files[0]; if (!f) return;
    try { const t = await f.text(); const rows = parseCSV(t); if (!rows.length) { set("csvErr","No data found."); return; } set("csvErr",""); set("csvRows", rows); }
    catch(ex) { set("csvErr","Error: "+ex.message); }
  }

  const isRel = (r) => r.status === "relevant";
  const isNon = (r) => r.status === "nonrelevant" || r.status === "non-relevant";
  const relC = st.csvRows ? st.csvRows.filter(isRel).length : 0;
  const nonC = st.csvRows ? st.csvRows.filter(isNon).length : 0;
  const penC = st.csvRows ? st.csvRows.filter((r) => !isRel(r) && !isNon(r)).length : 0;
  const csvPreviewRows = st.csvRows ? st.csvRows.slice(0, csvPreviewLimit) : [];

  const MODES = [["text","Type phrases"],["image","Screenshots"],["csv","CSV / Excel"],["both","Mix"]];

  return (
    <div style={{ paddingTop:28 }}>
      {/* Definition + Threshold row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:12, marginBottom:12, alignItems:"end" }}>
        <div>
          <SectionLabel>Category definition</SectionLabel>
          <input type="text" value={st.defText} onChange={(e) => set("defText", e.target.value)}
            placeholder="e.g. Agent requesting a property valuation — describes what this category detects"
            style={{ ...fieldStyle, fontSize:15 }} />
        </div>
        <div style={{ minWidth:140 }}>
          <SectionLabel>Score threshold</SectionLabel>
          <div style={{ display:"flex", alignItems:"center", gap:8, background:A.fill, border:"1px solid "+A.divider, borderRadius:A.radiusSm, padding:"8px 13px" }}>
            <input
              type="number" min="0" max="1" step="0.01"
              value={st.threshold}
              onChange={(e) => set("threshold", e.target.value)}
              style={{ width:56, background:"transparent", border:"none", outline:"none", fontSize:15, fontFamily:SF, color:A.text, fontWeight:600, textAlign:"center" }}
            />
            <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
              <button onClick={() => set("threshold", Math.min(1, parseFloat(st.threshold||"0.95")+0.01).toFixed(2))}
                style={{ width:18, height:14, border:"1px solid "+A.divider, borderRadius:3, background:A.white, cursor:"pointer", fontSize:9, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", color:A.secondary }}>▲</button>
              <button onClick={() => set("threshold", Math.max(0, parseFloat(st.threshold||"0.95")-0.01).toFixed(2))}
                style={{ width:18, height:14, border:"1px solid "+A.divider, borderRadius:3, background:A.white, cursor:"pointer", fontSize:9, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", color:A.secondary }}>▼</button>
            </div>
          </div>
          <p style={{ fontSize:10, color:A.tertiary, marginTop:4, textAlign:"center" }}>Scores ≥ this fire</p>
        </div>
      </div>

      {/* Context examples */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <SectionLabel>Context examples <span style={{ fontWeight:400, textTransform:"none", color:A.tertiary, fontSize:10, letterSpacing:0 }}>(optional — a few phrases to help the AI understand the category tone and domain)</span></SectionLabel>
        </div>
        <textarea value={st.contextText||""} onChange={(e) => set("contextText", e.target.value)}
          placeholder={"Optional — paste 2-5 example phrases that represent the style and domain of this category.\nThese are not scored as relevant or non-relevant — they give the AI context about phrasing style.\n\ne.g.\nHave you had a valuation recently?\nI can arrange a property evaluation for you\nShall I book you in for a free valuation?"}
          style={{ ...fieldStyle, minHeight:90, resize:"vertical", fontSize:13 }} />
      </div>

      {/* Said By */}
      <div style={{ marginBottom:20 }}>
        <SectionLabel>Said by</SectionLabel>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {[
            { id:"internal", label:"Internal", icon:"🎧", desc:"Agent / rep" },
            { id:"external", label:"External", icon:"👤", desc:"Customer" },
            { id:"any",      label:"Any",      icon:"↔️", desc:"Either participant" },
          ].map(({ id, label, icon, desc }) => {
            const active = (st.saidBy||"any") === id;
            const colors = id==="internal" ? { bg:A.blueBg, border:A.blue, text:A.blue }
                         : id==="external" ? { bg:A.greenBg, border:A.green, text:A.greenDk }
                         : { bg:A.fill, border:A.divider, text:A.secondary };
            return (
              <button key={id} onClick={() => set("saidBy", id)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px", borderRadius:A.radius, border:"2px solid "+(active ? colors.border : A.divider), background:active ? colors.bg : A.white, cursor:"pointer", fontFamily:SF, transition:"all .15s", boxShadow:active ? "0 0 0 3px "+(id==="internal"?"rgba(0,113,227,.1)":id==="external"?"rgba(26,137,23,.1)":"rgba(0,0,0,.04)") : "none" }}>
                <span style={{ fontSize:20 }}>{icon}</span>
                <div style={{ textAlign:"left" }}>
                  <p style={{ fontSize:13, fontWeight:600, color:active ? colors.text : A.text, margin:0 }}>{label}</p>
                  <p style={{ fontSize:11, color:A.tertiary, margin:0 }}>{desc}</p>
                </div>
                {active && <span style={{ marginLeft:4, fontSize:12, color:colors.text, fontWeight:700 }}>✓</span>}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize:11, color:A.tertiary, marginTop:8 }}>
          {(st.saidBy||"any")==="internal" && "Scripts will focus on agent-led phrasing patterns — first-person agent speech, offering/action intent."}
          {(st.saidBy||"any")==="external" && "Scripts will focus on customer-led phrasing patterns — requesting, questioning, expressing intent."}
          {(st.saidBy||"any")==="any" && "Scripts will cover both agent and customer phrasing. Useful when the category applies to either participant."}
        </p>
      </div>

      {/* Mode pills */}
      <div style={{ marginBottom:20 }}>
        <SectionLabel>Input method</SectionLabel>
        <div style={{ display:"inline-flex", background:A.fill2, borderRadius:10, padding:3, gap:2 }}>
          {MODES.map(([id, label]) => (
            <button key={id} onClick={() => set("inputMode", id)}
              style={{ padding:"7px 16px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontFamily:SF, fontWeight: st.inputMode===id ? 600 : 400, background: st.inputMode===id ? A.white : "transparent", color: st.inputMode===id ? A.text : A.secondary, boxShadow: st.inputMode===id ? A.shadowSm : "none", transition:"all .15s" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Text */}
      {(st.inputMode==="text" || st.inputMode==="both") && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
          <div>
            <SectionLabel><span style={{ color:A.green }}>Relevant phrases ✓</span></SectionLabel>
            <textarea value={st.relText} onChange={(e) => set("relText", e.target.value)}
              placeholder={"One per line — these SHOULD trigger the script\n\nExamples:\nHave you had a valuation with us?\nCan I book you in for an evaluation?\nWhen are you available for a valuation?\nAre you on the market?\nNext step is to book a valuation"}
              style={{ ...fieldStyle, minHeight:220, resize:"vertical" }} />
          </div>
          <div>
            <SectionLabel><span style={{ color:A.red }}>Non-relevant phrases ✗</span></SectionLabel>
            <textarea value={st.nonText} onChange={(e) => set("nonText", e.target.value)}
              placeholder={"One per line — must NOT trigger\n\nExamples:\nI see you're not ready for an evaluation\nwould you like to validate your checking balance\nAre you going to the doctor for an evaluation"}
              style={{ ...fieldStyle, minHeight:220, resize:"vertical" }} />
          </div>
        </div>
      )}

      {/* Image */}
      {(st.inputMode==="image" || st.inputMode==="both") && (
        <ImgZone images={st.images} onAdd={(arr, ri) => { if (ri!==undefined) setSt((p) => ({...p, images:p.images.filter((_,i)=>i!==ri)})); else if (arr) setSt((p) => ({...p, images:[...p.images,...arr]})); }} label="Tethr screenshots" />
      )}

      {/* CSV */}
      {st.inputMode === "csv" && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Card padding={20}>
              <p style={{ fontSize:15, fontWeight:600, color:A.text, marginBottom:6 }}>1 · Download template</p>
              <p style={{ fontSize:13, color:A.secondary, lineHeight:1.6, marginBottom:14 }}>
                Fill in phrases. Set Status to <strong>Relevant</strong>, <strong>Non-Relevant</strong>, or <strong>Pending</strong>. Works in Excel, Numbers, or Google Sheets.
              </p>
              <div style={{ background:A.fill, borderRadius:8, padding:"10px 12px", fontFamily:MONO, fontSize:11.5, color:A.secondary, lineHeight:2, marginBottom:14 }}>
                <span style={{ color:A.monoBlue }}>Category Definition</span>{", "}
                <span style={{ color:A.green }}>Phrase</span>{", "}
                <span style={{ color:A.orange }}>Status</span>{", Notes"}
              </div>
              <Btn primary onClick={() => { const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8,"+encodeURIComponent(makeCSV()); a.download="tethr_phrases_template.csv"; a.click(); }}>
                Download template ↓
              </Btn>
            </Card>

            <Card padding={20}>
              <p style={{ fontSize:15, fontWeight:600, color:A.text, marginBottom:6 }}>2 · Upload filled file</p>
              <p style={{ fontSize:13, color:A.secondary, lineHeight:1.6, marginBottom:14 }}>
                Upload your completed CSV. Phrases split by Status automatically.
              </p>
              <div onClick={() => csvRef.current.click()}
                onDrop={(e) => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handleCSV({target:{files:[f]}}); }}
                onDragOver={(e) => e.preventDefault()}
                style={{ border:"1.5px dashed "+(st.csvRows ? A.green : A.divider), borderRadius:A.radiusSm, padding:16, textAlign:"center", cursor:"pointer", background:st.csvRows ? A.greenBg : A.fill }}>
                <p style={{ fontSize:13, color:st.csvRows ? A.greenDk : A.secondary, margin:0, fontWeight:st.csvRows?600:400 }}>
                  {st.csvRows ? "✓ "+st.csvRows.length+" phrases loaded — click to replace" : "Click or drag & drop your CSV"}
                </p>
              </div>
              <input ref={csvRef} type="file" accept=".csv,.txt" style={{ display:"none" }} onChange={handleCSV} />
              {st.csvErr && <p style={{ fontSize:12, color:A.red, marginTop:8 }}>{st.csvErr}</p>}
            </Card>
          </div>

          {st.csvRows && (
            <Card>
              <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontWeight:600, fontSize:14, color:A.text }}>{st.csvRows.length} phrases imported</span>
                <div style={{ display:"flex", gap:10 }}>
                  <Tag label={"✓ "+relC+" relevant"} color={A.greenDk} bg={A.greenBg} />
                  <Tag label={"✗ "+nonC+" non-relevant"} color={A.redDk} bg={A.redBg} />
                  {penC > 0 && <Tag label={"⏳ "+penC+" pending"} color={A.orange} bg={A.orangeBg} />}
                </div>
              </div>
              <div style={{ maxHeight:220, overflowY:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:A.fill }}>
                      {["#","Phrase","Status","Notes"].map((h) => (
                        <th key={h} style={{ padding:"8px 16px", textAlign:"left", fontWeight:600, color:A.secondary, fontSize:11, borderBottom:"1px solid "+A.divider, textTransform:"uppercase", letterSpacing:"0.05em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreviewRows.map((row, i) => {
                      const rel = isRel(row), non = isNon(row);
                      return (
                        <tr key={i} style={{ borderBottom:"1px solid "+A.divider }}>
                          <td style={{ padding:"8px 16px", color:A.tertiary, width:32 }}>{i+1}</td>
                          <td style={{ padding:"8px 16px", color:A.text }}>{row.phrase}</td>
                          <td style={{ padding:"8px 16px" }}>
                            <Tag label={rel?"Relevant":non?"Non-Relevant":"Pending"} color={rel?A.greenDk:non?A.redDk:A.orange} bg={rel?A.greenBg:non?A.redBg:A.orangeBg} />
                          </td>
                          <td style={{ padding:"8px 16px", color:A.tertiary }}>{row.notes||"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {st.csvRows.length > csvPreviewRows.length && (
                <div style={{ padding:"12px 18px", borderTop:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, color:A.secondary }}>
                    Showing {csvPreviewRows.length} of {st.csvRows.length} imported rows
                  </span>
                  <Btn small onClick={() => setCsvPreviewLimit((limit) => Math.min(limit + CSV_PREVIEW_PAGE_SIZE, st.csvRows.length))}>
                    Show more
                  </Btn>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      <ErrBox msg={st.buildErr} />
      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <Btn primary onClick={onGenerate}>Generate Tethr scripts →</Btn>
        <Btn onClick={() => setSt((p) => ({ ...p, inputMode:"text", defText:"Agent requesting a property valuation or evaluation", relText:"Have you had a valuation with us?\nCan I book you in for an evaluation?\nWhen are you available for a valuation?\nAre you on the market?\npop around and give you a valuation\nNext step is to book a valuation\nHad you had a valuation with us at all?\nHave you had the property valued since you moved\nI can pop my head around and give you an evaluation\nWith booking this valuation in\nthe valuation request", nonText:"I see you're not ready for an evaluation\nwould you like to validate your checking balance\nAre you going to the doctor for an evaluation", buildErr:"" }))}>Load example</Btn>
        <Btn onClick={() => setSt((p) => ({ ...p, defText:"", contextText:"", saidBy:"any", relText:"", nonText:"", images:[], csvRows:null, csvErr:"", buildErr:"" }))}>Clear</Btn>
      </div>
    </div>
  );
}

// ─── VALIDATE TAB ─────────────────────────────────────────────────────────────
function ValidateTab({ result, loading, msg, error, onEdit, onCompare }) {
  const [filter, setFilter] = useState("all");
  const [analysisLimit, setAnalysisLimit] = useState(ANALYSIS_PAGE_SIZE);
  useEffect(() => {
    setAnalysisLimit(ANALYSIS_PAGE_SIZE);
  }, [filter, result]);
  if (loading) return <Spinner msg={msg} />;
  if (error) return <div style={{ paddingTop:28 }}><ErrBox msg={error} /></div>;
  if (!result) return (
    <div style={{ textAlign:"center", paddingTop:80, color:A.secondary }}>
      <p style={{ fontSize:17, fontWeight:500, color:A.text, marginBottom:8 }}>No scripts generated yet</p>
      <p style={{ fontSize:14, marginBottom:24 }}>Go to Create to build your first scripts</p>
      <Btn primary onClick={onEdit}>Go to Create →</Btn>
    </div>
  );

  const analysis = Array.isArray(result.analysis) ? result.analysis : [];
  const rel = analysis.filter((a) => a.status==="relevant");
  const non = analysis.filter((a) => a.status==="nonrelevant");
  const pend = analysis.filter((a) => a.status==="pending");
  const shown = filter==="all" ? analysis : analysis.filter((a) => a.status===filter);
  const visibleAnalysis = shown.slice(0, analysisLimit);
  const pScore = parseFloat(result.precision||"1");
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];

  return (
    <div style={{ paddingTop:28 }}>
      {/* Stats */}
      <Card style={{ marginBottom:16 }} padding="12px 20px">
        <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
          <span style={{ fontSize:16, fontWeight:600, color:A.text }}>{result.categoryName||"Category"}</span>
          <div style={{ display:"flex", gap:10, flex:1, flexWrap:"wrap" }}>
            <Tag label={"Precision "+result.precision} color={pScore>=0.95?A.greenDk:A.orange} bg={pScore>=0.95?A.greenBg:A.orangeBg} />
            <Tag label={"Recall "+result.recall} color={A.greenDk} bg={A.greenBg} />
            <Tag label={rel.length+" approved"} color={A.greenDk} bg={A.greenBg} />
            <Tag label={non.length+" non-relevant"} color={A.redDk} bg={A.redBg} />
            {pend.length>0 && <Tag label={pend.length+" pending"} color={A.orange} bg={A.orangeBg} />}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <Btn small onClick={onEdit}>Edit</Btn>
            <Btn small onClick={onCompare} style={{ color:A.purple, background:A.purpleBg }}>Compare vs human →</Btn>
          </div>
        </div>
      </Card>

      {warnings.length > 0 && (
        <Card style={{ marginBottom:16 }} padding="12px 18px">
          <p style={{ fontSize:12, fontWeight:700, color:A.orange, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
            Script repairs applied
          </p>
          {warnings.map((warning, index) => (
            <p key={index} style={{ fontSize:12, color:A.secondary, margin:"0 0 4px", lineHeight:1.5 }}>
              {warning}
            </p>
          ))}
        </Card>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {/* Phrases */}
        <Card>
          <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:600, fontSize:14, color:A.text }}>Phrases</span>
            <span style={{ fontSize:12, color:A.secondary }}>{analysis.length} total</span>
          </div>
          <div style={{ padding:"10px 14px", borderBottom:"1px solid "+A.divider, display:"flex", gap:6, flexWrap:"wrap" }}>
            {[
              { key:"all", label:"All", col:A.secondary, bg:A.fill },
              { key:"relevant", label:"Relevant ("+rel.length+")", col:A.greenDk, bg:A.greenBg },
              { key:"nonrelevant", label:"Non-relevant ("+non.length+")", col:A.redDk, bg:A.redBg },
              ...(pend.length>0 ? [{ key:"pending", label:"Pending ("+pend.length+")", col:A.orange, bg:A.orangeBg }] : []),
            ].map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ fontSize:12, padding:"4px 11px", borderRadius:20, border:"none", cursor:"pointer", fontFamily:SF, fontWeight: filter===f.key ? 600 : 400, background: filter===f.key ? f.bg : "transparent", color: filter===f.key ? f.col : A.secondary }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ padding:"8px 18px", borderBottom:"1px solid "+A.divider, fontSize:11, color:A.tertiary, background:A.fill }}>
            Per-phrase reasoning is hidden here. The UI keeps the phrase set and the generated scripts only.
          </div>
          <div style={{ maxHeight:480, overflowY:"auto" }}>
            {visibleAnalysis.map((item, i) => {
              const isR = item.status==="relevant", isP = item.status==="pending";
              const statusLabel = isR ? "Relevant" : isP ? "Pending" : "Non-relevant";
              const statusColor = isR ? A.greenDk : isP ? A.orange : A.redDk;
              const statusBg = isR ? A.greenBg : isP ? A.orangeBg : A.redBg;
              return (
                <div key={i} style={{ padding:"10px 18px", borderBottom:"1px solid "+A.divider, display:"flex", gap:12, alignItems:"center", justifyContent:"space-between", background:isP?A.orangeBg:A.white }}>
                  <p style={{ flex:1, minWidth:0, fontSize:13, color:isR?A.text:isP?A.orange:A.tertiary, margin:0, lineHeight:1.45, fontStyle:!isR&&!isP?"italic":"normal" }}>
                    {item.phrase}
                  </p>
                  <Tag label={statusLabel} color={statusColor} bg={statusBg} />
                </div>
              );
            })}
            {shown.length > visibleAnalysis.length && (
              <div style={{ padding:"12px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", borderTop:"1px solid "+A.divider }}>
                <span style={{ fontSize:12, color:A.secondary }}>
                  Showing {visibleAnalysis.length} of {shown.length} phrases
                </span>
                <Btn small onClick={() => setAnalysisLimit((limit) => Math.min(limit + ANALYSIS_PAGE_SIZE, shown.length))}>
                  Show more
                </Btn>
              </div>
            )}
          </div>
        </Card>

        {/* Scripts */}
        <Card>
          <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:600, fontSize:14, color:A.text }}>Scripts</span>
            <span style={{ fontSize:12, color:A.secondary }}>{result.scripts.length} generated</span>
          </div>
          <div style={{ padding:14 }}>
            {result.synonyms && Object.keys(result.synonyms).length > 0 && (
              <div style={{ marginBottom:14, padding:"10px 12px", background:A.blueBg, borderRadius:A.radiusSm }}>
                <p style={{ fontSize:11, fontWeight:600, color:A.blue, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Synonyms expanded</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {Object.entries(result.synonyms).map(([k, v]) => (
                    <span key={k} style={{ fontSize:12, background:A.white, border:"1px solid "+A.divider, borderRadius:20, padding:"3px 10px" }}>
                      <span style={{ color:A.blue, fontWeight:600 }}>{k}</span>
                      <span style={{ color:A.secondary }}> → {v.join(", ")}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {result.scripts.map((sc, i) => <ScriptBlock key={i} sc={sc} />)}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── COMPARE TAB ──────────────────────────────────────────────────────────────
function CompareTab({ aiResult, cst, setCst, comparePrompt, modelConfig }) {
  const set = (k, v) => setCst((p) => ({ ...p, [k]: v }));
  function handleImgs(arr, ri) {
    if (ri!==undefined) setCst((p) => ({...p, cmpImgs:p.cmpImgs.filter((_,i)=>i!==ri)}));
    else if (arr) setCst((p) => ({...p, cmpImgs:[...p.cmpImgs,...arr]}));
  }

  async function run() {
    set("cmpErr","");
    if (!aiResult) { set("cmpErr","Run Build first."); return; }
    if (!cst.humanTxt.trim() && !cst.cmpImgs.length) { set("cmpErr","Add human scripts to compare."); return; }
    set("cmpLoading", true); set("cmpResult", null);
    const content = [];
    cst.cmpImgs.forEach((img, idx) => {
      content.push({ type:"image", source:{ type:"base64", media_type:img.type||"image/png", data:img.b64 } });
      content.push({ type:"text", text:`Screenshot ${idx+1}: Extract all human-written scripts from the Scripts panel exactly — every letter (a, b, c...), every line of syntax. Also note any phrases visible: green thumbs-up = relevant, red thumbs-down = non-relevant (all red thumbs are non-relevant regardless of score), red thumbs-down with green precision score = false positive that additionally needs :-1 treatment.` });
    });
    const aiTxt = aiResult.scripts.map((s) => "Script "+s.letter+":\n"+s.lines.join("\n")).join("\n\n");
    const phrasePreview = (aiResult.analysis || []).slice(0, COMPARE_ANALYSIS_LIMIT);
    const phrases = phrasePreview.map((a) => "["+a.status+"] "+a.phrase).join("\n");
    const phraseNote = (aiResult.analysis || []).length > phrasePreview.length
      ? `\n\nOnly the first ${phrasePreview.length} analysed phrases are included here to keep comparison stable.`
      : "";
    content.push({ type:"text", text:"AI scripts:\n"+aiTxt+"\n\nHuman scripts:\n"+(cst.humanTxt||"(see screenshots)")+"\n\nPhrases:\n"+phrases+phraseNote+"\n\nCompare, find gaps, return improved merged scripts." });
    try { const r = sanitizeCompareResult(await callAPI(comparePrompt, content, 3000, modelConfig)); set("cmpResult", r); }
    catch(e) { set("cmpErr", e.message); }
    finally { set("cmpLoading", false); }
  }

  const cr = cst.cmpResult;

  return (
    <div style={{ paddingTop:28 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
        <Card>
          <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:600, fontSize:14, color:A.text }}>AI-generated</span>
            {aiResult && <Tag label={"P: "+aiResult.precision+" · R: "+aiResult.recall} color={A.greenDk} bg={A.greenBg} />}
          </div>
          <div style={{ padding:14 }}>{aiResult ? aiResult.scripts.map((sc,i) => <ScriptBlock key={i} sc={sc} />) : <p style={{ fontSize:13, color:A.tertiary, textAlign:"center", padding:"20px 0" }}>Run Build first</p>}</div>
        </Card>
        <Card>
          <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:600, fontSize:14, color:A.text }}>Human-written</span>
            <span style={{ fontSize:12, color:A.secondary }}>paste or screenshot</span>
          </div>
          <div style={{ padding:14 }}>
            <ImgZone images={cst.cmpImgs} onAdd={handleImgs} label="Screenshot of human scripts" />
            <SectionLabel>Or paste directly</SectionLabel>
            <textarea value={cst.humanTxt} onChange={(e) => set("humanTxt", e.target.value)}
              placeholder={"Script a:\nwhat\n{item product}\n[wanna want]\n[add include]\n\nScript b:\n[was what what's]\n[item product]"}
              style={{ ...fieldStyle, minHeight:150, fontFamily:MONO, fontSize:12.5, resize:"vertical" }} />
          </div>
        </Card>
      </div>
      <ErrBox msg={cst.cmpErr} />
      <Btn primary onClick={run}>Analyse gaps →</Btn>

      {cst.cmpLoading && <Spinner msg="Comparing scripts and finding gaps…" />}
      {!cst.cmpLoading && cr && (
        <div style={{ marginTop:24 }}>
          <Card style={{ marginBottom:14 }} padding="16px 20px">
            <div style={{ display:"flex", alignItems:"center", gap:16 }}>
              <span style={{ fontSize:32, fontWeight:800, color:parseFloat(cr.score)>=8?A.green:parseFloat(cr.score)>=6?A.orange:A.red, lineHeight:1 }}>{cr.score}</span>
              <div>
                <p style={{ fontSize:14, fontWeight:600, color:A.text, marginBottom:4 }}>Alignment score</p>
                <p style={{ fontSize:13, color:A.secondary, lineHeight:1.5 }}>{cr.summary}</p>
              </div>
            </div>
          </Card>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
            {[
              { title:"Both cover ✓", items:(cr.coverage||{}).both||[], col:A.green, bg:A.greenBg },
              { title:"Human only — AI misses ⚠", items:(cr.coverage||{}).humanOnly||[], col:A.orange, bg:A.orangeBg },
              { title:"AI only — check for FP", items:(cr.coverage||{}).aiOnly||[], col:A.blue, bg:A.blueBg },
              { title:"Neither covers ✗", items:(cr.coverage||{}).neither||[], col:A.red, bg:A.redBg },
            ].map((box) => (
              <div key={box.title} style={{ background:box.bg, borderRadius:A.radiusSm, padding:"12px 14px" }}>
                <p style={{ fontSize:11, fontWeight:700, color:box.col, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>{box.title}</p>
                {box.items.length ? box.items.map((it,i) => <p key={i} style={{ fontSize:12, color:A.secondary, margin:"0 0 3px" }}>· {it}</p>) : <p style={{ fontSize:12, color:A.tertiary }}>None</p>}
              </div>
            ))}
          </div>
          {(cr.actionItems||[]).length>0 && (
            <Card style={{ marginBottom:14 }} padding="14px 18px">
              <p style={{ fontSize:12, fontWeight:700, color:A.blue, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>Action items</p>
              {cr.actionItems.map((a,i) => <p key={i} style={{ fontSize:13, color:A.secondary, margin:"0 0 6px", lineHeight:1.5 }}>{i+1}. {a}</p>)}
            </Card>
          )}
          {(cr.improvedScripts||[]).length>0 && (
            <Card>
              <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontWeight:600, fontSize:14, color:A.text }}>Improved merged scripts</span>
                <Tag label="AI + Human" color={A.greenDk} bg={A.greenBg} />
              </div>
              <div style={{ padding:14 }}>{cr.improvedScripts.map((sc,i) => <ScriptBlock key={i} sc={sc} />)}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SCRIPTING BASICS TAB ─────────────────────────────────────────────────────
function BasicsTab() {
  const ops = [
    { op:'[word1 word2 "phrase"]', col:A.monoBlue, name:"OR group", rule:'Any single item inside [] satisfies that line. Three usages: (1) On its own line as an AND condition — [raise start get put] means the call must contain one of these words for this line to be satisfied; (2) Nested inside a (phrase group) as a sub-group for OR variation within a phrase sequence — (how [may can what] I [help assist]) nests two [OR groups] inside a (); (3) With :-1 for negation — [won\'t unable cannot "can\'t"]:-1 suppresses score when any item matches. Items can be plain words, "exact phrases", or (phrase groups).' },
    { op:'(phrase words)', col:A.monoBlue, name:"Phrase group", rule:"Groups content as a single unit. Three usages: (1) Inside [] as one OR option: [(over the phone) (when you call)]; (2) Standalone on its own line as an AND condition: (Don't tell compliance); (3) With :-1 for negation. Inside () you can nest plain words, [OR groups], and exact phrases: (Compliance [doesn't don't] need to know). Complex negation: ([non not isn't wasn't] (clear by)):-1 — nests an [OR group] AND a (phrase group) together inside () with :-1." },
    { op:"{word1 word2}", col:A.monoTeal, name:"Optional neutral words", rule:'INDIVIDUAL PLAIN WORDS ONLY, in left-to-right order — each entry is a single word, not a phrase. Each word is OPTIONAL (zero, some, or all may hit), but whichever do hit must appear in the order written. {to quickly} = two optional words; if both appear, "to" must come before "quickly". {of them} = the word "of" optionally followed by "them". Order is preserved like every other Tethr operator. No [], (), or quotes inside {}. Neutral-weight — fires with or without them. Two valid placements: (1) Standalone on its own line as a bridge between anchor lines; (2) Inside a (phrase group): (cash {or} "gift cards"). Cannot go inside [] — WRONG: [{two three} of them]. CORRECT: [two three] on one line, {of them} on the next.' },
    { op:'"exact phrase"', col:A.monoRed, name:"Exact sequence", rule:'Fixed word sequence — maximum 5 words. Use ONLY when the sequence must appear verbatim (e.g. "thank you for calling", "terms and conditions"). If words within the sequence can naturally swap, use a (phrase group) with nested [OR groups] instead. WRONG: ["how may I help" "how can I help" "how can I assist"]. CORRECT: (how [may can what] I [help assist]) — one phrase group catches all variations. Test: could a caller say it with one word swapped and mean the same thing? Yes → use (phrase group). No → use "exact phrase".' },
    { op:"token:-1", col:A.red, name:"Negative weight", rule:'Suppresses score for the line it is on. Two types: (1) BROAD CONTEXT SUPPRESSOR — a wide [OR group]:-1 collecting many contextual words that signal wrong topic: [like should technical more add "not requiring" "paper work"]:-1. Deliberately wide — the breadth is the point. Exact phrases can live inside. (2) SURGICAL — a narrow (phrase group):-1 targeting a specific false positive: ("see how much is in" "my checking account"):-1. Complex form: ([OR group] (phrase group)):-1 nests both inside one () with :-1 to suppress a specific context+phrase combination.' },
    { op:"keyword", col:A.text, name:"Plain keyword", rule:"Matches anywhere in the transcript. Each line is an AND condition — all lines must match for the script to fire." },
  ];
  const guardrails = [
    { n:"1", t:"Order is everything — AND lines match left to right as a whole unit", b:'ALL AND lines must match left to right in the order written. The script matches a phrase as a whole, in sequence. "Training is great" (training then great) and "How great was training today" (great then training) are DIFFERENT word orders and need SEPARATE scripts. Always scan all approved phrases for inversions and create a separate script for each distinct left-to-right order.' },
    { n:"2", t:"Strip filler words", b:'Remove is, am, the, very, really, just unless inside an exact quoted phrase. Fillers add noise and hurt precision.' },
    { n:"3", t:"Identify the intent type — it drives the precision gate", b:'Intent takes 7 forms: (1) Questioning — what/which/how/can you; (2) Confirming — confirm/confirming/"just to confirm"; (3) Action — raise/put/get/start/escalate; (4) Existence/State — have/got/"there is"/"you have"; (5) Offering — "can I"/"shall I"/"let me"/"I\'ll"; (6) Requesting — "can you"/"could you"/"would you"; (7) Awareness — "I see"/"I can see"/"looking at". Include intent when the topic words alone are too common. Omit it when the topic anchor is already highly specific.' },
    { n:"4", t:"(phrase groups) inside [] for topic variation only — not the whole script", b:'Use (phrase groups) as OR options inside [] for the TOPIC layer only, when the same concept appears in multiple word orders: [(visa letter) (letter for visa) (visa [application invitation] letter)]. Never collapse an entire script into one massive OR group of phrase groups — that destroys AND precision. Each script still needs its full layered AND structure (subject → action → topic). The phrase group OR pattern is just for the topic layer.' },
    { n:"5", t:"Synonym safety test before expanding OR groups", b:'Before adding any word to an [OR group], ask: could this word appear in a different, unrelated call center topic and fire on the wrong call? Words like "start", "help", "check", "look", "process" are common across all call center speech and create false positives. Only include synonyms that are specific enough to this topic that they rarely appear in unrelated phrases. When in doubt, use the exact word from the approved phrase instead of expanding.' },
    { n:"6", t:"Consolidate before creating a new script", b:'Ask first: can this pattern merge into an existing script by widening OR groups or adding {} optional words? Only create a new letter when word order or structure is genuinely incompatible.' },
    { n:"7", t:":-1 only for above-threshold false positives", b:'Only write :-1 for phrases where the Tethr precision score is GREEN (at or above threshold — script is already firing). Red/orange scores are already suppressed naturally. No :-1 needed for those.' },
    { n:"8", t:":-1 must be on every line of a negation", b:':-1 only suppresses the score of the line it sits on. Preferred: combine all identifying conditions into one (phrase group):-1. If multiple AND lines are unavoidable, every line must carry :-1. Never put :-1 only on the last line.' },
    { n:"9", t:"Use {} to bridge spoken language gaps — prefer over exact phrases", b:'Spoken language inserts filler words between key terms. Use {} to capture them without requiring them. "just to confirm" -> just / {to quickly gonna} / confirm — catches all spoken variants. "need to know" -> need / {to} / know. "going to raise" -> going / {to gonna} / [raise start]. Only plain words inside {}. Never duplicate adjacent OR group content. The script fires with or without {} words — they only boost recall when present.' },
  ];
  const refs = [
    { letter:"a", covers:"Intent + Topic — question about visa letter/application", lines:['[about regarding need question confirm help assistance support waiting reply request receiving look forward offering provide send sent apply start registration response confirmation]','[(letter visa application) (visa [invitation application] [letter form process]) (for the visa letter) ([invitation application] [letter form] visa) (visa letter section)]'] },
    { letter:"b", covers:"Agent asks for verbal/secret password", lines:['[provide ([can may] I [have get]) confirm ask verify recall]','{is your phone number}','[verbal secret challenge (challenge word)]','[(verbal [password passport]) password identifier]'] },
    { letter:"c", covers:"Verbal password exists on account", lines:['[(verbal [password passport]) (secret identifier) (security word)]','{you give us on these calls you provide}','[recall authenticate verify ([can do] you [know have give remember])]'] },
    { letter:"d", covers:"Surgical negation — false positive suppression", lines:['("see how much is in" "my checking account"):-1'] },
  ];

  return (
    <div style={{ paddingTop:28 }}>
      <p style={{ fontSize:14, color:A.secondary, lineHeight:1.7, marginBottom:24 }}>Rules and guardrails followed when generating Tethr detection scripts.</p>

      <SectionLabel>Syntax operators</SectionLabel>
      <Card style={{ marginBottom:24 }}>
        {ops.map((op, i) => (
          <div key={i} style={{ display:"flex", gap:0, borderBottom: i<ops.length-1 ? "1px solid "+A.divider : "none", padding:"13px 18px", alignItems:"flex-start" }}>
            <div style={{ width:196, flexShrink:0, paddingRight:16 }}>
              <code style={{ fontSize:12.5, fontFamily:MONO, color:op.col, background:A.fill, padding:"3px 8px", borderRadius:6, display:"inline-block", marginBottom:4 }}>{op.op}</code>
              <p style={{ fontSize:11, fontWeight:600, color:A.secondary, margin:0 }}>{op.name}</p>
            </div>
            <p style={{ fontSize:13, color:A.secondary, lineHeight:1.7, margin:0, flex:1 }}>{op.rule}</p>
          </div>
        ))}
      </Card>

      <SectionLabel>Logic rules</SectionLabel>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:24 }}>
        {[
          { t:"AND between lines", b:"Every line must match somewhere in the call — but order doesn't matter across lines. Tethr matches each AND line independently anywhere in the transcript. So one script covers both 'Training is great' and 'How great was training today'. Warning: every extra AND line is a gate — if any approved phrase doesn't contain a word satisfying that line, it silently won't fire." },
          { t:"OR inside [ ]", b:"Any single item satisfies that line. More items = higher recall. Always mix formal and colloquial forms." },
          { t:"Threshold .95", b:"Match confidence must reach 95% to fire. Standard for most categories. Raise to .98 for sensitive QA categories." },
        ].map((c) => (
          <Card key={c.t} padding="16px 18px">
            <p style={{ fontSize:13, fontWeight:600, color:A.text, marginBottom:6 }}>{c.t}</p>
            <p style={{ fontSize:13, color:A.secondary, lineHeight:1.7, margin:0 }}>{c.b}</p>
          </Card>
        ))}
      </div>

      <SectionLabel>Script labelling convention</SectionLabel>
      <Card style={{ marginBottom:24 }} padding="14px 18px">
        <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:"10px 20px", alignItems:"start" }}>
          {[
            { label:"a → z", desc:"First 26 scripts. Each letter covers a distinct phrasing pattern — different word order, tense, speaker perspective, or structural variation." },
            { label:"aa → zz", desc:"Double-letter scripts for extended coverage when a category has many edge cases. aa, bb, cc etc. continue after z." },
            { label:"Club first", desc:"Before adding a new script, always ask: can this pattern be merged into an existing one by expanding its OR groups or adding a gap bridge? Fewer scripts = easier to maintain." },
          ].map((r) => (
            <><span key={r.label+"l"} style={{ fontFamily:MONO, fontSize:13, fontWeight:700, color:A.blue, whiteSpace:"nowrap" }}>{r.label}</span>
            <p key={r.label+"d"} style={{ fontSize:13, color:A.secondary, lineHeight:1.6, margin:0 }}>{r.desc}</p></>
          ))}
        </div>
      </Card>

      <SectionLabel>Generation guardrails</SectionLabel>
      <Card style={{ marginBottom:24 }}>
        {guardrails.map((g, i) => (
          <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"12px 18px", borderBottom: i<guardrails.length-1?"1px solid "+A.divider:"none" }}>
            <span style={{ width:22, height:22, borderRadius:"50%", background:A.blue, color:"#fff", fontSize:11, fontWeight:700, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>{g.n}</span>
            <div>
              <p style={{ fontSize:13, fontWeight:600, color:A.text, marginBottom:3 }}>{g.t}</p>
              <p style={{ fontSize:13, color:A.secondary, lineHeight:1.6, margin:0 }}>{g.b}</p>
            </div>
          </div>
        ))}
      </Card>

      <SectionLabel>Reference example — secret identifier / verbal password category</SectionLabel>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {refs.map((sc) => <ScriptBlock key={sc.letter} sc={sc} />)}
      </div>
    </div>
  );
}

// ─── PROMPTS TAB ─────────────────────────────────────────────────────────────
function PromptsTab({ buildPrompt, setBuildPrompt, comparePrompt, setComparePrompt }) {
  const [activePrompt, setActivePrompt] = useState("build");

  const current = activePrompt === "build" ? buildPrompt : comparePrompt;
  const defaultVal = activePrompt === "build" ? DEFAULT_BUILD_SYS : DEFAULT_COMPARE_SYS;
  const charCount = current.length;
  const lineCount = current.split("\n").length;

  // Extract guardrail lines for the sidebar (lines starting with a number)
  const guardrailLines = defaultVal.split("\n").filter((l) => /^\d+\./.test(l.trim()));

  const PROMPT_TABS = [
    { id: "build", label: "Build prompt", desc: "Used when generating Tethr scripts from phrases or screenshots" },
    { id: "compare", label: "Compare prompt", desc: "Used when comparing AI scripts against human-written scripts" },
  ];

  return (
    <div style={{ paddingTop: 28 }}>
      <p style={{ fontSize: 14, color: A.secondary, lineHeight: 1.7, marginBottom: 24 }}>
        View the system prompts sent to the AI. Read-only.
      </p>

      {/* Prompt selector */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        {PROMPT_TABS.map((pt) => (
          <div key={pt.id} onClick={() => setActivePrompt(pt.id)}
            style={{ padding: "14px 18px", borderRadius: A.radius, border: "2px solid " + (activePrompt === pt.id ? A.blue : A.divider), background: activePrompt === pt.id ? A.blueBg : A.white, cursor: "pointer", boxShadow: activePrompt === pt.id ? "0 0 0 4px rgba(0,113,227,.08)" : A.shadowSm, transition: "all .15s" }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: activePrompt === pt.id ? A.blue : A.text, marginBottom: 4 }}>{pt.label}</p>
            <p style={{ fontSize: 12, color: A.secondary, margin: 0, lineHeight: 1.5 }}>{pt.desc}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
        {/* Editor */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <SectionLabel>{activePrompt === "build" ? "Build" : "Compare"} system prompt</SectionLabel>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: A.tertiary }}>{charCount.toLocaleString()} chars · {lineCount} lines</span>
              <CopyBtn text={current} />
            </div>
          </div>
          <textarea
            value={current}
            readOnly
            style={{ ...fieldStyle, minHeight: 480, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.8, resize: "vertical", padding: "14px 16px", cursor: "text", background: A.fill }}
          />
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Guardrails summary */}
          {activePrompt === "build" && guardrailLines.length > 0 && (
            <Card padding="16px 18px">
              <p style={{ fontSize: 12, fontWeight: 700, color: A.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Active guardrails</p>
              {guardrailLines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: A.blue, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    {i + 1}
                  </span>
                  <p style={{ fontSize: 12, color: A.secondary, margin: 0, lineHeight: 1.5 }}>{line.replace(/^\d+\.\s*/, "")}</p>
                </div>
              ))}
            </Card>
          )}

          {/* Output format */}
          <Card padding="16px 18px">
            <p style={{ fontSize: 12, fontWeight: 700, color: A.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Expected output format</p>
            <p style={{ fontSize: 12, color: A.secondary, lineHeight: 1.6, marginBottom: 8 }}>
              The prompt instructs the AI to return <strong>raw JSON only</strong> — no markdown, no explanation. The app parses this automatically.
            </p>
            <div style={{ background: A.fill, borderRadius: 6, padding: "8px 10px", fontFamily: MONO, fontSize: 11, color: A.secondary, lineHeight: 1.8 }}>
              {activePrompt === "build" ? (
                <>
                  <span style={{ color: A.monoBlue }}>categoryName</span><br />
                  <span style={{ color: A.monoBlue }}>definition</span><br />
                  <span style={{ color: A.monoBlue }}>analysis[]</span> → phrase, status, scriptLetter, why<br />
                  <span style={{ color: A.monoBlue }}>scripts[]</span> → letter, lines[], covers, threshold<br />
                  <span style={{ color: A.monoBlue }}>synonyms</span> → keyword: [variants]<br />
                  <span style={{ color: A.monoBlue }}>precision, recall</span>
                </>
              ) : (
                <>
                  <span style={{ color: A.monoBlue }}>score</span> → e.g. "8/10"<br />
                  <span style={{ color: A.monoBlue }}>summary</span><br />
                  <span style={{ color: A.monoBlue }}>coverage</span> → both, humanOnly, aiOnly, neither<br />
                  <span style={{ color: A.monoBlue }}>missingPatterns[]</span><br />
                  <span style={{ color: A.monoBlue }}>actionItems[]</span><br />
                  <span style={{ color: A.monoBlue }}>improvedScripts[]</span>
                </>
              )}
            </div>
          </Card>

          {/* Notes */}
          <Card padding="16px 18px">
            <p style={{ fontSize: 12, fontWeight: 700, color: A.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>How this prompt works</p>
            {[
              "Always ends with 'Return ONLY raw JSON' to prevent markdown wrapping.",
              "Includes domain-specific guardrails to keep outputs consistent.",
              "Caps script count (2–4) to control output verbosity.",
              "Encodes synonym expansion rules used for every category.",
            ].map((tip, i) => (
              <p key={i} style={{ fontSize: 12, color: A.secondary, lineHeight: 1.5, marginBottom: 6 }}>· {tip}</p>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── CUSTOM SCRIPT TAB ───────────────────────────────────────────────────────
const DEFAULT_CUSTOM_SYS = `You are an expert Tethr speech analytics scripting engineer. Your task is to update existing scripts by incorporating newly submitted pending phrases, while preserving the coverage of all existing approved phrases.

CRITICAL OUTPUT RULE: You must output ONLY a raw JSON object. No thinking. No analysis text. No markdown. No explanation before or after. No code fences. Your entire response must start with { and end with }. If you think step-by-step, do it silently inside your reasoning — never output it.

PROCESS (do silently):
1. Read existing scripts exactly as written.
2. Identify which existing script covers each approved phrase.
3. For each pending phrase, attempt to MERGE into the most suitable existing script first:
   - Widen an OR group to include the new variant
   - Add {optional words} to bridge it
   - Add a new line without breaking existing matches
   - Only create a NEW script letter if the structure is genuinely incompatible with ALL existing scripts
4. Verify updated scripts still cover all original approved phrases.
5. Apply surgical negation for false positives: ("specific words" "from false positive"):-1

TETHR SYNTAX:
- Plain keyword: AND condition, matches anywhere
- [OR group]: any item satisfies; can contain words, "exact phrases", (phrase groups)
- (phrase group): inside [] as OR option, standalone as AND, or with :-1; can contain [OR groups] and "exact phrases"
- {optional words}: plain words only, neutral-weight, never duplicate OR group content
- "exact phrase": fixed sequence max 5 words
- :-1 on any token. Surgical: ("distinctive words" "from false positive"):-1
- AND between lines; OR inside []

OUTPUT — return ONLY this JSON, nothing else, starting with { on the very first character:
{"summary":"...","pendingAnalysis":[{"phrase":"...","action":"merged","scriptLetter":"a","why":"..."}],"updatedScripts":[{"letter":"a","lines":["line1"],"covers":"...","threshold":".95","changed":true,"changeNote":"..."}],"newScripts":[{"letter":"x","lines":["line1"],"covers":"...","threshold":".95"}],"preservedCoverage":true,"warnings":[]}`;

function CustomScriptTab({ buildPrompt, setTab, modelConfig }) {
  const [phraseImgs, setPhraseImgs] = useState([]);
  const [scriptImgs, setScriptImgs] = useState([]);
  const [humanScriptTxt, setHumanScriptTxt] = useState("");
  const [pendingTxt, setPendingTxt] = useState("");
  const [approvedTxt, setApprovedTxt] = useState("");
  const [threshold, setThreshold] = useState("0.95");
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  function handlePhraseImgs(arr, ri) {
    if (ri !== undefined) setPhraseImgs(p => p.filter((_, i) => i !== ri));
    else if (arr) setPhraseImgs(p => [...p, ...arr]);
  }
  function handleScriptImgs(arr, ri) {
    if (ri !== undefined) setScriptImgs(p => p.filter((_, i) => i !== ri));
    else if (arr) setScriptImgs(p => [...p, ...arr]);
  }

  async function run() {
    setError("");
    const hasInput = phraseImgs.length > 0 || scriptImgs.length > 0 || humanScriptTxt.trim() || pendingTxt.trim();
    if (!hasInput) { setError("Please upload screenshots or add phrases and scripts."); return; }
    if (!scriptImgs.length && !humanScriptTxt.trim()) { setError("Please provide the existing human scripts — upload a screenshot or paste them."); return; }

    setLoading(true); setResult(null);
    const content = [];

    // Phrase screenshots (shows approved + pending with score/thumb state)
    if (phraseImgs.length) {
      setLoadMsg(`Reading ${phraseImgs.length} phrase screenshot${phraseImgs.length > 1 ? "s" : ""}…`);
      phraseImgs.forEach((img, idx) => {
        content.push({ type: "image", source: { type: "base64", media_type: img.type || "image/png", data: img.b64 } });
        content.push({ type: "text", text: `Phrase screenshot ${idx + 1}/${phraseImgs.length}. Threshold is ${threshold}.

Extract ALL phrases and classify them:
- APPROVED (green thumbs-up): existing approved phrases — the scripts must continue to cover these
- PENDING (no thumb yet, blue ✓ and red ✗ buttons visible): newly submitted phrases that need to be incorporated into scripts
- NON-RELEVANT (red thumbs-down, ANY score color): all red thumbs-down phrases are non-relevant. Additionally:
  → red thumbs-down + GREEN score = false positive currently firing above threshold — also needs surgical :-1 guard
  → red thumbs-down + RED/ORANGE score = non-relevant and already below threshold — no :-1 needed, already suppressed

Also note the script letter badge (a, b, c) on each phrase — this tells you which script currently covers it.` });
      });
    }

    // Script screenshots
    if (scriptImgs.length) {
      setLoadMsg("Reading existing scripts…");
      scriptImgs.forEach((img, idx) => {
        content.push({ type: "image", source: { type: "base64", media_type: img.type || "image/png", data: img.b64 } });
        content.push({ type: "text", text: `Script screenshot ${idx + 1}/${scriptImgs.length}: Extract every existing script exactly — letter, all lines, all syntax including [OR groups], (phrase groups), {optional words}, "exact phrases", :-1 weights, threshold.` });
      });
    }

    // Build text prompt
    setLoadMsg("Analysing pending phrases and updating scripts…");
    let txt = `Threshold: ${threshold}\n\n`;
    if (approvedTxt.trim()) txt += `Existing approved phrases (scripts MUST still cover all of these after changes):\n${approvedTxt.trim()}\n\n`;
    if (pendingTxt.trim()) txt += `Pending phrases to incorporate (try merge first, create new script only if impossible):\n${pendingTxt.trim()}\n\n`;
    if (humanScriptTxt.trim()) txt += `Existing human scripts:\n${humanScriptTxt.trim()}\n\n`;
    txt += `For each pending phrase: first attempt to merge into an existing script by widening OR groups or adding optional {words}. Only create a new script letter if the structure is genuinely incompatible. After all changes, verify every approved phrase is still covered. Use surgical (phrase group):-1 for any false positives with green scores.

IMPORTANT: Respond with ONLY the raw JSON object. Do not write any analysis, explanation, markdown, or text. Start your response with { immediately.`;
    content.push({ type: "text", text: txt });

    try {
      const r = sanitizeCustomResult(await callAPI(DEFAULT_CUSTOM_SYS, content, 4000, modelConfig));
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false); setLoadMsg("");
    }
  }

  const cr = result;

  return (
    <div style={{ paddingTop: 28 }}>
      {/* Info banner */}
      <div style={{ background: A.blueBg, border: "1px solid " + A.blue + "30", borderRadius: A.radius, padding: "12px 16px", marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: A.blue, marginBottom: 4 }}>How this works</p>
        <p style={{ fontSize: 12, color: A.secondary, lineHeight: 1.7 }}>
          Upload your current Tethr phrase list (showing Pending + Approved) and your existing scripts. The AI will try to merge each pending phrase into the most suitable existing script without breaking existing coverage. Only creates new scripts when merging is genuinely impossible.
        </p>
      </div>

      {/* Threshold */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <SectionLabel>Score threshold</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: A.fill, border: "1px solid " + A.divider, borderRadius: A.radiusSm, padding: "6px 12px" }}>
          <input type="number" min="0" max="1" step="0.01" value={threshold}
            onChange={e => setThreshold(e.target.value)}
            style={{ width: 52, background: "transparent", border: "none", outline: "none", fontSize: 14, fontFamily: SF, color: A.text, fontWeight: 600, textAlign: "center" }} />
          <span style={{ fontSize: 11, color: A.tertiary }}>Scores ≥ this fire</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        {/* Left: Phrase screenshots + text */}
        <div>
          <Card>
            <div style={{ padding: "10px 16px", background: A.fill, borderBottom: "1px solid " + A.divider }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: A.text, margin: 0 }}>Phrase list</p>
              <p style={{ fontSize: 11, color: A.secondary, margin: "2px 0 0" }}>Screenshots showing Approved + Pending phrases with score and thumb state</p>
            </div>
            <div style={{ padding: 14 }}>
              <ImgZone images={phraseImgs} onAdd={handlePhraseImgs} label="Screenshots (Phrases panel)" />
              <SectionLabel>Or paste pending phrases</SectionLabel>
              <textarea value={pendingTxt} onChange={e => setPendingTxt(e.target.value)}
                placeholder={"One per line — these are the new pending phrases to incorporate:\nSo what I would do is\nI would just recommend to\nYou can also do that."}
                style={{ ...fieldStyle, minHeight: 100, resize: "vertical", marginBottom: 10 }} />
              <SectionLabel>Approved phrases (to preserve coverage)</SectionLabel>
              <textarea value={approvedTxt} onChange={e => setApprovedTxt(e.target.value)}
                placeholder={"One per line — existing approved phrases the scripts must still cover"}
                style={{ ...fieldStyle, minHeight: 80, resize: "vertical" }} />
            </div>
          </Card>
        </div>

        {/* Right: Existing scripts */}
        <div>
          <Card>
            <div style={{ padding: "10px 16px", background: A.fill, borderBottom: "1px solid " + A.divider }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: A.text, margin: 0 }}>Existing scripts</p>
              <p style={{ fontSize: 11, color: A.secondary, margin: "2px 0 0" }}>The current human-written scripts that need updating</p>
            </div>
            <div style={{ padding: 14 }}>
              <ImgZone images={scriptImgs} onAdd={handleScriptImgs} label="Screenshots (Scripts panel)" />
              <SectionLabel>Or paste scripts directly</SectionLabel>
              <textarea value={humanScriptTxt} onChange={e => setHumanScriptTxt(e.target.value)}
                placeholder={"Script a:\n[what how]\n{is your}\n[verbal secret]\n[password identifier]\n\nScript b:\n[(verbal [password passport]) (secret identifier)]\n{you give us}\n[recall authenticate verify]"}
                style={{ ...fieldStyle, minHeight: 200, fontFamily: MONO, fontSize: 12.5, resize: "vertical" }} />
            </div>
          </Card>
        </div>
      </div>

      <ErrBox msg={error} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Btn primary onClick={run}>Update scripts →</Btn>
        <Btn onClick={() => { setPhraseImgs([]); setScriptImgs([]); setHumanScriptTxt(""); setPendingTxt(""); setApprovedTxt(""); setError(""); setResult(null); }}>Clear</Btn>
      </div>

      {loading && <Spinner msg={loadMsg} />}

      {!loading && cr && (
        <div style={{ marginTop: 24 }}>
          {/* Summary */}
          <Card style={{ marginBottom: 14 }} padding="14px 18px">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: cr.preservedCoverage ? A.greenBg : A.redBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18 }}>
                {cr.preservedCoverage ? "✓" : "⚠"}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: cr.preservedCoverage ? A.green : A.red, marginBottom: 4 }}>
                  {cr.preservedCoverage ? "Existing coverage preserved" : "Coverage warning — review carefully"}
                </p>
                <p style={{ fontSize: 13, color: A.secondary, lineHeight: 1.5 }}>{cr.summary}</p>
              </div>
            </div>
            {(cr.warnings || []).length > 0 && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: A.orangeBg, borderRadius: A.radiusSm }}>
                {cr.warnings.map((w, i) => <p key={i} style={{ fontSize: 12, color: A.orange, margin: "0 0 3px" }}>⚠ {w}</p>)}
              </div>
            )}
          </Card>

          {/* Pending phrase decisions */}
          <SectionLabel>Pending phrase decisions</SectionLabel>
          <Card style={{ marginBottom: 16 }}>
            {(cr.pendingAnalysis || []).map((item, i) => (
              <div key={i} style={{ padding: "10px 16px", borderBottom: i < cr.pendingAnalysis.length - 1 ? "1px solid " + A.divider : "none", display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0,
                  background: item.action === "merged" ? A.greenBg : A.blueBg,
                  color: item.action === "merged" ? A.greenDk : A.blue,
                }}>
                  {item.action === "merged" ? "↩ Merged into " + item.scriptLetter : "＋ New script " + item.scriptLetter}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, color: A.text, margin: "0 0 3px" }}>{item.phrase}</p>
                  <p style={{ fontSize: 11, color: A.tertiary }}>{item.why}</p>
                </div>
              </div>
            ))}
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* Updated scripts */}
            {(cr.updatedScripts || []).length > 0 && (
              <div>
                <SectionLabel>Updated scripts <span style={{ color: A.green, fontWeight: 700 }}>({(cr.updatedScripts || []).filter(s => s.changed).length} modified)</span></SectionLabel>
                {cr.updatedScripts.map((sc, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    {sc.changed && (
                      <div style={{ padding: "5px 12px", background: A.greenBg, border: "1px solid " + A.green + "30", borderBottom: "none", borderRadius: A.radiusSm + " " + A.radiusSm + " 0 0", fontSize: 11, color: A.greenDk, fontWeight: 600 }}>
                        ✎ {sc.changeNote}
                      </div>
                    )}
                    <div style={{ borderRadius: sc.changed ? "0 0 " + A.radiusSm + " " + A.radiusSm : A.radiusSm, overflow: "hidden", border: "1px solid " + (sc.changed ? A.green + "50" : A.divider) }}>
                      <div style={{ padding: "8px 12px", background: sc.changed ? A.greenBg + "80" : A.fill, borderBottom: "1px solid " + A.divider, display: "flex", alignItems: "center", gap: 8 }}>
                        <ScriptBadge letter={sc.letter} size={18} />
                        <span style={{ fontSize: 12, color: A.secondary, flex: 1, fontStyle: "italic" }}>{sc.covers}</span>
                        <CopyBtn text={(sc.lines || []).join("\n")} />
                      </div>
                      <div style={{ padding: "10px 12px", background: A.white, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.9 }}>
                        {(sc.lines || []).map((line, j) => (
                          <div key={j}>{colorize(line).map(([t, c], k) => <span key={k} style={{ color: c }}>{t}</span>)}</div>
                        ))}
                      </div>
                      <div style={{ padding: "4px 12px 5px", background: A.fill, borderTop: "1px solid " + A.divider, fontSize: 11, color: A.tertiary }}>
                        Threshold: {sc.threshold || ".95"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* New scripts */}
            {(cr.newScripts || []).length > 0 && (
              <div>
                <SectionLabel>New scripts added <span style={{ color: A.blue, fontWeight: 700 }}>({cr.newScripts.length})</span></SectionLabel>
                {cr.newScripts.map((sc, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ padding: "5px 12px", background: A.blueBg, border: "1px solid " + A.blue + "30", borderBottom: "none", borderRadius: A.radiusSm + " " + A.radiusSm + " 0 0", fontSize: 11, color: A.blue, fontWeight: 600 }}>
                      ＋ New script — could not merge
                    </div>
                    <div style={{ borderRadius: "0 0 " + A.radiusSm + " " + A.radiusSm, overflow: "hidden", border: "1px solid " + A.blue + "50" }}>
                      <div style={{ padding: "8px 12px", background: A.blueBg + "80", borderBottom: "1px solid " + A.divider, display: "flex", alignItems: "center", gap: 8 }}>
                        <ScriptBadge letter={sc.letter} size={18} />
                        <span style={{ fontSize: 12, color: A.secondary, flex: 1, fontStyle: "italic" }}>{sc.covers}</span>
                        <CopyBtn text={(sc.lines || []).join("\n")} />
                      </div>
                      <div style={{ padding: "10px 12px", background: A.white, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.9 }}>
                        {(sc.lines || []).map((line, j) => (
                          <div key={j}>{colorize(line).map(([t, c], k) => <span key={k} style={{ color: c }}>{t}</span>)}</div>
                        ))}
                      </div>
                      <div style={{ padding: "4px 12px 5px", background: A.fill, borderTop: "1px solid " + A.divider, fontSize: 11, color: A.tertiary }}>
                        Threshold: {sc.threshold || ".95"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("create");
  const [cst, setCst] = useState({ inputMode:"text", defText:"", contextText:"", saidBy:"any", relText:"", nonText:"", images:[], csvRows:null, csvErr:"", buildErr:"", threshold:"0.95" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [buildError, setBuildError] = useState("");
  const [compareSt, setCompareSt] = useState({ humanTxt:"", cmpImgs:[], cmpLoading:false, cmpErr:"", cmpResult:null });
  const [buildPrompt, setBuildPrompt] = useState(DEFAULT_BUILD_SYS);
  const [comparePrompt, setComparePrompt] = useState(DEFAULT_COMPARE_SYS);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState(MODEL_OPTIONS.openai[0].value);
  const modelConfig = { provider, model };

  async function runScalableBuild({ defText, contextText, saidBy, threshold, phraseData }) {
    setLoadMsg(`Generating scalable script set for ${phraseData.generationRelevant.length + phraseData.nonRelevant.length} unique phrases…`);
    const base = sanitizeBuildResult(await callAPI(
      buildPrompt + LARGE_INPUT_BUILD_SUFFIX,
      [{ type:"text", text: buildScalableGenerationText({ defText, contextText, saidBy, threshold, generationRelevant: phraseData.generationRelevant, nonRelevant: phraseData.nonRelevant, pending: phraseData.pending, clusters: phraseData.clusters }) }],
      6000,
      modelConfig
    ));

    if (!Array.isArray(base.scripts) || !base.scripts.length) {
      throw new Error("Scalable build did not return any scripts.");
    }

    const chunks = chunkArray(phraseData.analysisItems, ANALYSIS_CHUNK_SIZE);
    const mergedAnalysis = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setLoadMsg(`Analysing phrase batch ${i + 1} of ${chunks.length}…`);
      const chunkResult = await callAPI(
        DEFAULT_ANALYSIS_SYS,
        [{ type:"text", text: buildAnalysisChunkText({ scripts: base.scripts, chunk, threshold }) }],
        4000,
        modelConfig
      );
      const chunkAnalysis = Array.isArray(chunkResult.analysis) ? chunkResult.analysis : [];
      if (chunkAnalysis.length !== chunk.length) {
        throw new Error(`Analysis batch ${i + 1} returned ${chunkAnalysis.length} rows for ${chunk.length} phrases.`);
      }
      mergedAnalysis.push(...chunkAnalysis.map((item, index) => ({
        phrase: item.phrase || chunk[index].phrase,
        status: item.status || "pending",
        _expectedStatus: chunk[index].expectedStatus,
      })));
    }

    const approvedTotal = mergedAnalysis.filter((item) => item._expectedStatus === "relevant").length;
    const nonRelevantTotal = mergedAnalysis.filter((item) => item._expectedStatus === "nonrelevant").length;
    const approvedCovered = mergedAnalysis.filter((item) => item._expectedStatus === "relevant" && item.status === "relevant").length;
    const nonRelevantRejected = mergedAnalysis.filter((item) => item._expectedStatus === "nonrelevant" && item.status === "nonrelevant").length;

      return {
        categoryName: base.categoryName || defText.trim() || "Category",
        definition: base.definition || defText.trim() || "",
        scripts: base.scripts || [],
        synonyms: base.synonyms || {},
        analysis: mergedAnalysis.map(({ _expectedStatus, ...item }) => item),
        precision: ratioString(nonRelevantRejected, nonRelevantTotal),
        recall: ratioString(approvedCovered, approvedTotal),
        warnings: [...(Array.isArray(base.warnings) ? base.warnings : [])],
      };
  }

  async function generate() {
    setCst((p) => ({ ...p, buildErr:"" }));
    setBuildError("");
    const { inputMode, defText, contextText, saidBy, relText, nonText, images, csvRows, threshold } = cst;
    const phraseData = collectPhraseInputs({ inputMode, relText, nonText, csvRows });
    const relLines = phraseData.approved;
    const nonLines = phraseData.nonRelevant;
    if (inputMode==="text" && !relLines.length) { setCst((p) => ({...p, buildErr:"Please add at least some relevant phrases."})); return; }
    if (inputMode==="image" && !images.length) { setCst((p) => ({...p, buildErr:"Please upload at least one screenshot."})); return; }
    if (inputMode==="csv" && !csvRows?.length) { setCst((p) => ({...p, buildErr:"Please upload a CSV file."})); return; }
    if (inputMode==="both" && !images.length && !relLines.length) { setCst((p) => ({...p, buildErr:"Please upload screenshots or add phrases — or both."})); return; }
    setLoading(true); setResult(null); setTab("validate");
    if (shouldUseScalableMode({ images, generationRelevant: phraseData.generationRelevant, nonRelevant: phraseData.nonRelevant, contextText, defText })) {
      try {
        const scalableResult = await runScalableBuild({ defText, contextText, saidBy, threshold, phraseData });
        setResult(scalableResult);
      } catch (e) {
        setBuildError(e.message);
      } finally {
        setLoading(false); setLoadMsg("");
      }
      return;
    }
    const content = [];
    if (images.length) {
      setLoadMsg("Reading "+images.length+" screenshot"+(images.length>1?"s":"")+"…");
      images.forEach((img, idx) => {
        content.push({ type:"image", source:{ type:"base64", media_type:img.type||"image/png", data:img.b64 } });
        content.push({ type:"text", text:`Screenshot ${idx+1}/${images.length} from the Tethr speech analytics platform. Threshold is ${threshold}.

THUMB DIRECTION tells you relevant vs non-relevant:
✅ GREEN thumbs-up = RELEVANT — script should catch this phrase
❌ RED thumbs-down = NON-RELEVANT — script must not catch this phrase

ALL red thumbs-down phrases are non-relevant, regardless of their score.

SCORE COLOR tells you whether a :-1 guard is additionally needed:
→ RED thumbs-down + GREEN score (e.g. green "1", green ".98") = NON-RELEVANT AND FALSE POSITIVE — the script is currently firing on this above threshold. Treat as non-relevant AND write a surgical :-1 guard to suppress it.
→ RED thumbs-down + RED or ORANGE score (e.g. red "0", orange ".69") = NON-RELEVANT but already below threshold — treat as non-relevant, no :-1 needed as it is already suppressed naturally.

So in both cases the phrase is non-relevant. The score only answers: does it also need a :-1 fix right now?

Also extract all scripts from the Scripts panel — every letter, every line of syntax exactly as written.`
        });
      });
    }
    setLoadMsg("Generating Tethr scripts…");
    let rPhrases = relLines, nPhrases = nonLines;
    if (inputMode==="csv" && csvRows) {
      rPhrases = phraseData.generationRelevant;
      nPhrases = phraseData.nonRelevant;
    }
    let ut = defText.trim() ? "Category definition: "+defText.trim()+"\n\n" : "";
    ut += "Said by: "+getSaidByLabel(saidBy)+"\n";
    ut += buildParticipantGuidance(saidBy)+"\n\n";
    if (contextText?.trim()) ut += "Context examples (tone and domain only — not scored):\n"+contextText.trim()+"\n\n";
    if (rPhrases.length) ut += "Relevant phrases:\n"+rPhrases.map((p,i) => (i+1)+". "+p).join("\n")+"\n\n";
    if (nPhrases.length) ut += "Non-relevant phrases:\n"+nPhrases.map((p,i) => (i+1)+". "+p).join("\n")+"\n\n";
    ut += `Build Tethr detection scripts following all rules in the system prompt.

KEY REMINDERS:
- Use the SUBJECT → INTENT → NEGATION → ACTION → BRIDGE → TOPIC layer structure. Each layer is a separate AND line in speech order.
- Extract 2-3 word anchors per phrase — a single common word gives too little weight. Find the word COMBINATIONS that make each phrase distinctive.
- ORDER IS ENFORCED EVERYWHERE. ALL AND lines must match left to right in the order written. The same core words in a different order across phrases = SEPARATE script. Scan ALL approved phrases for inversions before writing any script — every distinct left-to-right ordering needs its own script letter.
- USE {} optional bridge words instead of exact phrases for spoken language. "just to confirm" -> just / {to quickly gonna} / confirm.
- BEFORE adding any AND line ask: "Does every approved phrase contain a word satisfying this line, AND does that word appear after the words on all previous lines?" If no — don't add it.
- LARGE PHRASE SETS: if given 10+ phrases, merge aggressively into 3-6 scripts maximum using [OR of phrase groups]. Do NOT create one script per phrase.

SMART MERGING USING NESTING:
- Use [(phrase group A) (phrase group B)] to collapse multiple word order variants into one AND line
- Use (phrase [OR group] word) to handle OR variation within a phrase group rather than splitting scripts
- If two scripts share the same layers but differ in one OR group → widen that OR group and merge
- For (phrase group) order variants → use [( order1 ) ( order2 )] on the same line — one script
- Never nest more than 3 levels deep — if it gets more complex, split into two scripts

NON-RELEVANT PHRASES — TWO DIFFERENT APPROACHES, NEVER BOTH:

TEXT non-relevant phrases (provided in the input with no score):
  Every single one MUST produce its own dedicated negation script in the scripts[] array.
  Write a script containing only the surgical :-1 guard for that phrase.
  Do NOT also embed a :-1 guard for the same phrase inside detection scripts.
  The phrase has no green score — the detection script is not firing on it — so there is nothing to suppress there. Adding a guard inside detection scripts is redundant and dangerous.

  WRONG — double negation (dedicated script b AND guard embedded in script a):
    Script a: training / [not isn't wasn't]:-1 / [(cooled down)(down outside)]:-1 / [cool great awesome]
    Script b: (cooled down outside):-1 / training
  CORRECT — dedicated script only, detection script clean:
    Script a: training / [not isn't wasn't]:-1 / [cool great awesome bomb]
    Script b: (cooled down outside):-1 / training

  EXCEPTION — embed :-1 directly inside the detection script (no separate script) ONLY when:
  The non-relevant phrase is the NEGATED FORM of a relevant phrase (contains "not", "isn't", "wasn't", "don't" etc.)
  Example: "training is not great" -> embed [not isn't wasn't]:-1 inside script a at its natural position

SCREENSHOT false positives (red thumb + green score):
  Do NOT create a separate script. Embed the :-1 guard inside each relevant script that is
  actively firing (green score). No separate script letter needed.

Set threshold to ${threshold} on all scripts. Assign each relevant phrase the best matching script letter.

REMINDER: Output ONLY the raw JSON object. Your response must start with { immediately. No steps, no classification, no explanation before the JSON.`;
    content.push({ type:"text", text:ut });
    try { const r = sanitizeBuildResult(await callAPI(buildPrompt, content, 8000, modelConfig)); setResult(r); }
    catch(e) { setBuildError(e.message); }
    finally { setLoading(false); setLoadMsg(""); }
  }

  const TABS = [["create","Create"],["validate","Validate"],["basics","New Category Scripting Basics"],["prompt","Prompt"]];

  return (
    <div style={{ background:A.pageBg, minHeight:"100vh", fontFamily:SF, color:A.text, fontSize:14 }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}button:active{transform:scale(.97);}input:focus,textarea:focus{outline:none;border-color:${A.blue}!important;box-shadow:0 0 0 3px rgba(0,113,227,.15);}@keyframes spin{to{transform:rotate(360deg);}}`}</style>

      {/* Nav */}
      <div style={{ background:"rgba(255,255,255,0.85)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderBottom:"1px solid "+A.divider, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 24px", display:"flex", alignItems:"center", height:52 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginRight:32 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#0071e3,#34aadc)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ color:"#fff", fontSize:13, fontWeight:700 }}>T</span>
            </div>
            <span style={{ fontWeight:700, fontSize:15, color:A.text, letterSpacing:"-0.02em" }}>Script Builder</span>
          </div>
          <div style={{ display:"flex", gap:0 }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                style={{ padding:"0 16px", border:"none", background:"none", cursor:"pointer", fontSize:13.5, fontFamily:SF, color: tab===id ? A.blue : A.secondary, fontWeight: tab===id ? 600 : 400, height:52, borderBottom: "2px solid "+(tab===id ? A.blue : "transparent"), letterSpacing:"-0.01em" }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ display:"flex", gap:8, alignItems:"center", background:A.fill, border:"1px solid "+A.divider, borderRadius:10, padding:"5px 8px" }}>
              <select
                value={provider}
                onChange={(e) => {
                  const nextProvider = e.target.value;
                  setProvider(nextProvider);
                  setModel(MODEL_OPTIONS[nextProvider][0].value);
                }}
                style={{ border:"none", background:"transparent", fontFamily:SF, fontSize:12, color:A.text }}
              >
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
              </select>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ border:"none", background:"transparent", fontFamily:SF, fontSize:12, color:A.text, minWidth:130 }}
              >
                {MODEL_OPTIONS[provider].map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <span style={{ fontSize:12, color:A.tertiary, padding:"4px 10px", background:A.fill, borderRadius:6, fontWeight:500 }}>GBR</span>
            <span style={{ fontSize:12, color:A.tertiary, padding:"4px 10px", background:A.fill, borderRadius:6, fontWeight:500 }}>Transcript</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 24px 60px" }}>
        {tab==="create" && <CreateTab st={cst} setSt={setCst} onGenerate={generate} />}
        {tab==="validate" && <ValidateTab result={result} loading={loading} msg={loadMsg} error={buildError} onEdit={() => setTab("create")} onCompare={() => setTab("compare")} />}
        {tab==="compare" && <CompareTab aiResult={result} cst={compareSt} setCst={setCompareSt} comparePrompt={comparePrompt} modelConfig={modelConfig} />}
        {tab==="custom" && <CustomScriptTab buildPrompt={buildPrompt} setTab={setTab} modelConfig={modelConfig} />}
        {tab==="basics" && <BasicsTab />}
        {tab==="prompt" && <PromptsTab buildPrompt={buildPrompt} setBuildPrompt={setBuildPrompt} comparePrompt={comparePrompt} setComparePrompt={setComparePrompt} />}
      </div>
    </div>
  );
}
