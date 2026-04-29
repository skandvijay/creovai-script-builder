import { useState, useRef } from "react";

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

async function callAPI(system, content, maxTokens) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens || 4000,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("API " + res.status + ": " + t.slice(0, 200)); }
  const d = await res.json();
  const raw = (d.content || []).map((b) => b.text || "").join("");
  try {
    return extractAndRepairJSON(raw);
  } catch (e) {
    throw new Error("JSON parse error — " + e.message + ". Raw (first 200 chars): " + raw.slice(0, 200));
  }
}

const DEFAULT_BUILD_SYS = `You are an expert Tethr speech analytics scripting engineer. Build precise call center transcript detection scripts that maximise recall without sacrificing precision.

CRITICAL: Your entire response must be a single raw JSON object. Start with { and end with }. No thinking text. No steps. No explanation. No markdown. Do all reasoning silently — never output it.

---

# TETHR SYNTAX REFERENCE

## Plain keyword (own line)
Matches the word anywhere in the transcript, case-insensitive.
Each line is an AND condition — ALL lines must match for the script to fire.
Example: credit

## [OR group]
Any single item inside [] satisfies that line.
Items can be plain words, "exact phrases", or (phrase groups).
Three usages:
1. On its own line as an AND condition — any one item satisfies it:
   [raise start get put]   <- call must contain one of these
   [confirm confirming]    <- call must contain confirm or confirming
2. Nested inside (phrase group) as a sub-group for OR variation within a sequence:
   (how [may can what] I [help assist])   <- [OR groups] inside () for variable slots
3. With :-1 for negation:
   [won't unable cannot]:-1

## (phrase group)
Groups a multi-word sequence as one unit. Three usages:
1. Inside [] as one OR option: [(over the phone) (when you call) direct]
2. Standalone on its own line as an AND condition: (Don't tell compliance)
3. With :-1 for negation: (Don't tell compliance):-1
Inside () you can nest plain words, [OR groups], and "exact phrases":
  (how [may can] I [help assist])
  ([non not isn't wasn't] (clear by)):-1   <- [OR group] + (phrase group) nested inside () with :-1

## "exact phrase"
Fixed word sequence — maximum 5 words. Inside [] or () or standalone.
Split longer phrases: ("see how much is in" "my checking account") — 5 + 3 words.

USE SPARINGLY. Spoken language is NOT written language — verbatim sequences are rare in transcripts.
Use "exact phrase" ONLY for:
- Fixed terms that cannot vary: "terms and conditions", "thank you for calling", "direct debit"
- Brand names or legal phrases
- Inside a broad [OR group]:-1 for context suppression
- Inside a surgical (phrase group):-1 for a specific false positive

USE INSTEAD for spoken language:
- (phrase group) with nested [OR] for variable slots: (how [may can] I [help assist])
- anchor keyword + {optional bridge}: just {to quickly gonna} confirm

## {optional words}
INDIVIDUAL PLAIN WORDS ONLY.
Each entry inside {} is a single word — not a phrase, not a sequence.
{to quickly gonna} means three separate individual words: "to", "quickly", "gonna"
{of them} means two separate words: "of" and "them" — NOT the phrase "of them" in order
No [], (), or "" inside {} — ever.
Neutral-weight: NOT required to fire but boost recall when present.
Only use for individual connector words between ordered anchor conditions NOT already in adjacent [OR groups].
Never duplicate content in surrounding OR groups.

WHERE {} CAN AND CANNOT GO:
  VALID — standalone on its own line (most common):
    [two three four five]
    {of them}
    items

  VALID — inside a (phrase group) as an optional slot within a phrase sequence:
    (gift {cards} "and")        <- matches "gift and" AND "gift cards and"
    (clear {the} balance)       <- matches "clear balance" AND "clear the balance"
    (cash {or} "gift cards")    <- matches "cash gift cards" AND "cash or gift cards"

    {} inside () means: this word is optional within this phrase — fires either way.

    IMPORTANT PATTERN — plain word + {optional connector} + "exact phrase":
    When a spoken connector word may or may not appear between a plain word and an exact phrase,
    use {} to bridge them inside the (phrase group):
      (cash {or} "gift cards")      <- "or" is optional spoken connector between cash and gift cards
      (payment {or} "store credit") <- same pattern
      (refund {or} "exchange")      <- same pattern
    Without {or}, the phrase group only matches if "or" is absent. With {or}, it matches both.

    {} inside () = the word is optional spoken filler within this specific phrase sequence.
    "or" and "and" inside {} are literal spoken words, NOT logic operators — they have no
    OR/AND script logic. {or} simply means: the word "or" may optionally appear here in speech.
    Natural spoken connectors for this pattern: {or} {and} {the} {a} {to} {of} {for}

  INVALID — inside an [OR group]:
    [{two three} of them]  <- {} inside [] is wrong
    [gift {cards} voucher]  <- {} inside [] is wrong
    [] needs definite items that must match — {} has no place there

[] must contain genuine must-have anchor words — not filler, not connectors:
  WRONG: [of them]   <- filler connector, not a meaningful anchor word
  CORRECT: [two three four five]   <- count words that prove the category

SPOKEN BRIDGE PATTERNS — use {} to bridge gaps between anchor keywords:
Transcripts insert filler words, hesitations, and connectors. Never exact-quote a phrase when
anchors + {} will capture more real speech:

  "just to confirm"     ->  just {to quickly gonna} confirm
  "need to know"        ->  need {to} know
  "going to raise"      ->  going {to gonna} [raise start]
  "not in compliance"   ->  not {in} [compliant compliance]
  "get it sorted"       ->  [get have] {it} [sort sorted]
  "put it through"      ->  [put get] {it} through
  "I want to speak"     ->  [I want wanna] {to} speak
  "clear by end of day" ->  clear {by the} [end close]
  "rock and a hard place" -> rock {and a} hard place
  "cash or gift cards"    -> (cash {or} "gift cards")   <- {or} is the literal word "or", not OR logic
  "one or two items"      -> (one {or} two) {of the} items

WRONG: "just to confirm" — only catches this exact 3-word sequence
CORRECT: just / {to quickly gonna} / confirm — catches "just confirm", "just to confirm",
  "just quickly confirm", "just gonna confirm" etc.

## :-1 negative weight
Suppresses the score of the exact line it sits on — NOT the whole script.
Works on any token: keyword:-1 / "phrase":-1 / [list]:-1 / (group):-1
For full negation: put :-1 on every AND line of the negation, OR compress into one (phrase group):-1.

## Nesting
Valid: [word (nested [sub list]) "phrase"]. () can contain [], "exact phrases", plain words.

AND between lines — all lines must match. OR inside [] — any one item matches.

---

# HOW TO BUILD A SCRIPT

## STEP 0 — Understand How Tethr Matches

CRITICAL — HOW TETHR AND LINES WORK:
AND lines between separate script lines are ORDER-INDEPENDENT across the transcript.
Each AND line just needs to appear SOMEWHERE in the call — they do not need to appear
in the order you write them.

This means a single script covers both word orderings of the same words:
  training
  [not isn't wasn't]:-1
  [great awesome cool bomb]

This fires on BOTH:
  "Training is great"            <- training anywhere + great anywhere = fires
  "How great was training today" <- great anywhere + training anywhere = fires

You do NOT need separate scripts for word order inversions of plain AND lines.
Both orderings are already covered by the same script.

RULE 1 — Word order matters ONLY inside (phrase groups) and "exact phrases":
Inside a (phrase group) or "exact phrase", words MUST appear in the sequence you write them.
This is the only place where order is enforced.

  CORRECT: (visa [invitation application] letter)  <- visa then letter, in that order
  WRONG:   (letter [invitation application] visa)  <- reversed, won't match "visa letter"

  So if a phrase group needs to cover both orders, add both as separate () options:
  [(visa [invitation application] letter) ([invitation application] letter visa)]

RULE 2 — Use natural layer order for readability only, not for matching:
Write AND lines in the natural speech order of the phrase for readability.
Tethr matches all AND lines anywhere in the call regardless of order — natural ordering
is just cleaner and easier to maintain.

RULE 3 — EVERY AND LINE IS A GATE THAT CAN EXCLUDE PHRASES.
This is critical. If a phrase does not contain the word(s) on one of your AND lines,
that phrase will NOT fire the script — even if it matches every other line perfectly.

  EXAMPLE:
    training
    [not isn't wasn't]:-1
    [great awesome cool bomb]

  This covers: "Training is great" and "How great was training today"
  This does NOT cover: "What a great session" <- no "training" word, blocked by line 1

  So: only add AND lines for words that genuinely appear across ALL your approved phrases.
  An AND line that only some phrases contain will silently exclude the others.

  THE BALANCE:
    More AND lines = higher precision (fewer false positives)
    Fewer AND lines = higher recall (more phrases fire)
    Unnecessary AND lines = approved phrases that should fire but don't

  Before adding any AND line, ask: "Does every approved phrase I want to catch
  contain a word that satisfies this line?" If no -> don't add it.

---

## STEP 1 — Identify and Build Layers

Break each phrase into positional layers. Build one AND line per layer, in speech order.
Only use layers that genuinely appear in the approved phrase set.

  SUBJECT   -> who is acting?       [I he she we] or (let me)
  INTENT    -> what type of act?    see Intent Taxonomy
  NEGATION  -> is it negated?       [won't unable cannot]:-1
  ACTION    -> what they are doing  [raise start get put]
  BRIDGE    -> spoken filler        {a the your}
  TOPIC     -> what it is about     credit / (phrase groups)

MULTI-WORD ANCHORS — extract 2-3 word combinations, not just single words:
Single common words give very little weight. Find the combination that proves the intent.
  WRONG: "I'll get a credit raised" -> credit  (too weak)
  CORRECT: "I'll get a credit raised" -> [get put] + credit + [raised request]
  CORRECT: "confirm the missing items" -> [confirm confirming] + [(missing items) (items missing)]

### Intent Taxonomy

**1. Questioning** — asking what / which / how
  Script line: [what which how]
  Spoken form: (what [is the] [product code]) or just what / {the} / [code number]
  Use when: phrases are questions asking to identify or provide something

**2. Confirming** — verifying something already known
  Script line: [confirm confirming]
  Spoken form: just {to quickly gonna} confirm  <- never use "just to confirm" as exact phrase
  Use when: agent or customer is checking a fact already mentioned

**3. Action** — actively performing a task
  Script line: [raise start get put escalate]
  Spoken form: [raise raised start] {the a} credit
  Use when: a specific action is being performed or offered

**4. Existence / State** — something exists or is the case
  Script line: [have got] or (there [is are]) or (you have)
  Spoken form: [have got] {a} [verbal password]
  Use when: a thing or state is being declared to exist

**5. Offering** — agent proposing an action
  Script line: [(can I) (shall I) (let me) (I can) (I will)]
  Spoken form: [(can I) (shall I) (let me)] {just quickly} [book arrange]
  Note: use (phrase groups) not "exact phrases" — spoken form varies
  Use when: agent is offering to perform something for the customer

**6. Requesting** — asking the other party to act
  Script line: [(can you) (could you) (would you)]
  Spoken form: [(can you) (could you)] {just quickly} [confirm provide]
  Use when: one party is asking the other to do something

**7. Awareness / Noticing** — agent observing screen information
  Script line: [(I see) (I can see) (looking at) (I notice)]
  Spoken form: [(I see) (I can see)] {that you have} [verbal password]
  Use when: agent is reading or observing something on screen

### Intent Decision Rules

Include intent when:
  - Topic words alone are too common (items, credit, account, payment, order)
  - Approved phrases consistently share a clear speech act type
  - Without intent the script fires on unrelated calls mentioning the topic

Omit intent when:
  - Topic anchor is already highly specific (product code, verbal password, visa letter)
  - Approved phrases do not share a common intent type
  - Adding intent would exclude real approved phrases that lack it

### Subject as a Precision Gate
When pronouns appear consistently, use them as the FIRST AND line:
  [I he she we] or (let me)  <- widen as needed across approved phrases

### Negation Guard — place at its natural speech position
  CORRECT:
    [I he she we]
    [won't unable cannot]:-1
    [raise start]
    {a the your}
    credit
  WRONG: [I he she we] / [raise start] / credit / [cannot won't]:-1  <- end is broken

---

## STEP 2 — Build the Topic Line with Phrase Groups

PATTERN A — Single line when the topic is distinctive enough on its own:
  [(product code) (which product) (what the product) (got the product) (have the product)]
  Each () is one word order variant. Use when the concept alone is a strong anchor.

PATTERN B — Multi-line when topic words need a precision gate:
  [confirm confirming]
  [(missing items) (items there) (items you are missing) (items missing)]

Decision: "Could this topic phrase fire on a completely unrelated call?"
  NO  (product code, visa letter) -> Pattern A: single line
  YES (items, credit, account)   -> Pattern B: add precision gate AND line

Prefer (phrase groups) over {optional filler}:
  WEAK:   [confirm confirming] / {the} / [item items]
  BETTER: [confirm confirming] / [(missing items) (items there) (items you are missing)]

Inside each (): nest [OR groups] for word order variation within that pattern:
  (visa [invitation application] letter) — covers both document type variants

---

## STEP 3 — Synonyms, Colloquial Variants, Spoken Bridges

Strip fillers: remove is, am, the, very, really, just unless inside an exact quoted phrase.

Include colloquial spoken variants alongside formal equivalents:
  wanna / gonna / can't / don't / isn't / wasn't / I'm / I've / I'll
  Missing these drops recall significantly.

Smart synonym expansion:
  - Only expand where real variation exists across approved phrases
  - Ask: "Would a real agent or customer naturally say this word in this exact context?"
  - Max 3-4 synonyms per slot — if you need 6+, split into two AND lines instead
  - SAFE: words specific to this topic domain
  - UNSAFE: generic call center words (start, help, look, check, process) that fire everywhere

Spoken bridges — always prefer over exact phrases for natural speech:
  "just to confirm" -> just {to quickly} confirm
  "need to know"    -> need {to} know
  "going to raise"  -> going {to gonna} [raise start]
  "let me check"    -> [let me] {just quickly} check
  "I want to"       -> [I want wanna] {to}

---

## STEP 4 — Consolidate Scripts Using Nesting

### CRITICAL — How AND lines work (understand this before merging anything)

A script is evaluated as a WHOLE UNIT against each phrase.
ALL AND lines must be satisfied by the SAME phrase for the script to fire.
It is NOT "line 1 hits some phrases and line 2 hits others" — ALL lines together must match ONE phrase.

CONSEQUENCE: adding an extra AND line to merge two scripts will BREAK any approved phrase
that does not contain the words on that extra line.

  Script a: training / [great awesome bomb]
  Covers: "training is great" ✓ / "training is awesome" ✓
  If you add [I he she]: training / [I he she] / [great awesome bomb]
  Now "training is great" no longer fires — it has no I/he/she.
  You broke existing coverage to merge.

SAFE merge = the new AND line contains words that appear in EVERY approved phrase already covered.
UNSAFE merge = the new AND line contains a word missing from even one approved phrase.

### NEGATION EMBEDDED IN A DETECTION SCRIPT

When a non-relevant phrase is a negated form of a relevant phrase, embed the :-1 guard
directly inside the detection script at its natural word order position.
No separate negation script needed.

  Relevant: "training is great" / "training is awesome" / "training is the bomb"
  Non-relevant: "training is not great" / "training isn't awesome"

  ONE script covers both the detection AND the negation:
    training
    [not isn't wasn't]:-1
    [great awesome bomb cool]

  The [not isn't wasn't]:-1 line sits at its natural position — where the negation word appears
  in speech between "training" and the sentiment word. The script fires on "training is great"
  (no negation word present) and does NOT fire on "training is not great" (negation suppresses).

  This is always preferred over creating a separate negation-only script when the negation
  word appears naturally between the same anchor words you are already detecting.

### PRE-MERGE CHECK before assigning any script letters
1. Group phrases by layer structure — same layers in same order = same group
2. Phrases differing only in topic phrase -> one script, all topic variants as (phrase groups) in []
3. Single-line (phrase group) scripts -> ALWAYS merge into one []:
   WRONG: (direct interest) as a / (premium interest) as b / (benefits checking) as c
   CORRECT: [(direct interest) (premium interest) (benefits checking) (simply free checking)]

### Nesting Examples

SIMPLE — merge parallel topic variants:
  [(direct interest) (premium interest) (benefits checking) (simply free checking) (tell a friend)]

MEDIUM — shared action, varying topic:
  [confirm confirming verify]
  [(missing items) (items there) (items you are missing) (items missing)]

MEDIUM — word order variants using [OR] inside ():
  [(visa [invitation application] letter) ([invitation application] letter [for the] visa)]

COMPLEX — subject + tense + topic all vary across phrases:
  Phrases: "I'll get a credit raised" / "he raised the credit" / "we put a credit through" / "let me start the credit"
  CORRECT — all approved phrases contain these words, safe to merge:
    [I he she we (let me)]
    [get put raise raised start]
    {a the your}
    credit

COMPLEX — negation embedded, detection + suppression in one script:
  training
  [not isn't wasn't]:-1
  [great awesome bomb cool]
  Covers all "training is [positive]" phrases. Suppresses "training is not great" in same script.

COMPLEX — agent vs customer intent (genuinely different layers, must be 2 scripts):
  Script a (agent offering):
    [(can I) (shall I) (let me) (I can)]
    {just quickly}
    [book arrange schedule]
    [valuation evaluation]
  Script b (customer requesting):
    [(can you) (could you) wanna]
    {to just}
    [book arrange schedule]
    [valuation evaluation]

### Nesting Patterns (quick reference)
- Same layers, different topic phrase -> add new () to existing [] at that position
- Same words, different subject/speaker -> widen subject [OR group]
- Same phrase, different tense -> add tense variants to action [OR group]
- Negation is the negated form of existing relevant phrases -> embed :-1 at its natural position inside the same script
- Colloquial variant of existing phrase -> add as additional () in the []

WHEN to create a new script (not merge):
  - An extra AND line would break coverage of any existing approved phrase
  - Different intent type (offering vs requesting vs confirming)
  - Nesting would exceed 3 levels
  - Opposite meaning that would break existing matches

NO DOUBLE-GUARDING:
If a false positive is already handled by a dedicated negation script, do NOT also embed a :-1 guard for it inside the detection script. Pick one approach only:
  - Embed :-1 inside the detection script (when the negation word naturally falls between anchor words)
  - OR write a dedicated negation script (when it is a contextually wrong phrase with no negation word)

  WRONG — double-guarded:
    Script a:
      training
      [not isn't wasn't]:-1
      [(cooled down) (down outside)]:-1   <- handles "cooled down outside" case
      [cool great bomb awesome]
    Script b:
      (cooled down outside):-1            <- ALSO handles the same case
      training

  CORRECT — each case handled once:
    Script a:
      training
      [not isn't wasn't]:-1              <- handles "training is NOT great"
      [cool great bomb awesome]
    Script b:
      (cooled down outside):-1           <- handles "it cooled down outside after training"
      training

  The :-1 guard inside script a handles negation words (not/isn't/wasn't).
  Script b handles the contextually wrong phrase. No overlap.

Labels: a, b, c … z then aa, bb … zz.
Minimal is best: one or two precise AND lines beats five loose ones.

---

# NEGATION RULES

## Rule A — Text non-relevant phrases: ALWAYS write a negation script
Every text non-relevant phrase MUST produce its own dedicated negation script in scripts[].
Do not skip any. Write them as standalone scripts so they are visible and publishable.

## Rule B — Screenshot non-relevant phrases: negate based on score color only
- Red thumb + GREEN score -> false positive firing -> MUST get :-1 guard (embed in relevant scripts)
- Red thumb + RED/ORANGE score -> already suppressed -> NO :-1 needed
- ALL red thumbs are non-relevant. Score only determines if a :-1 fix is additionally needed.

## Rule C — Two types of negation

TYPE 1 — BROAD CONTEXT SUPPRESSOR [OR group]:-1
Deliberately wide. Suppresses an entire semantic context, not one specific phrase.
Collect all words that signal "wrong topic/context" and put :-1 on the whole group.
Exact phrases and (phrase groups) can live inside a broad [OR group]:-1:
  [like should technical more add (clear by) thought understand "not requiring" "paper work"]:-1

TYPE 2 — SURGICAL (phrase group):-1
Narrow. Targets one specific false positive phrase.
Extract the most distinctive words from that exact phrase:
  ("see how much is in" "my checking account"):-1

COMPLEX — ([OR group] (phrase group)):-1
Nest an [OR group] and a (phrase group) together inside () with :-1:
  ([non not isn't wasn't] (clear by)):-1
  -> Suppresses: any negation word appearing together with the phrase "clear by"

CHOOSE:
  - Wrong context/topic -> TYPE 1: wide [OR group]:-1
  - Specific false positive -> TYPE 2: narrow (phrase group):-1
  - Specific context + phrase combination -> COMPLEX: ([OR] (phrase group)):-1

## Rule D — Placement

Text non-relevant (no score) -> dedicated standalone negation script in scripts[] with its own letter.
Do NOT also embed the same guard inside detection scripts.
The phrase has no green score — the detection script is NOT firing on it, so there is nothing to suppress there.
Adding a :-1 inside a detection script that isn't even firing is unnecessary and dangerous — it risks suppressing real relevant phrases that happen to share those words.

  WRONG — dedicated script b exists AND guard embedded in script a:
    Script a: training / [not isn't wasn't]:-1 / [(cooled down)(down outside)]:-1 / [cool great awesome]
    Script b: (cooled down outside):-1 / training
    The phrase has no green score. Script a is not firing on it. The embedded guard is unnecessary.

  CORRECT — dedicated script only, detection script untouched:
    Script a: training / [not isn't wasn't]:-1 / [cool great awesome bomb]
    Script b: (cooled down outside):-1 / training

Screenshot false positive (red thumb + GREEN score) -> embed :-1 as a line INSIDE each relevant
script that is actively firing on it. No separate script letter needed — embedding in every
firing script is sufficient.

---

# OUTPUT

YOUR RESPONSE MUST START WITH { ON THE VERY FIRST CHARACTER.
No steps, no classification text, no markdown, no preamble. Do all analysis silently.

Return ONLY a valid JSON object. No text before or after. No markdown fences. No trailing commas:
{"categoryName":"...","definition":"...","analysis":[{"phrase":"...","status":"relevant","scriptLetter":"a","why":"..."}],"scripts":[{"letter":"a","lines":["line1"],"covers":"...","threshold":".95"}],"synonyms":{"word":["s1","s2","s3"]},"precision":"1.00","recall":"0.95"}

- Text non-relevant phrases -> each gets its own dedicated negation script with its own letter
- Screenshot false positives -> embed :-1 inside each relevant script, no separate letter
- status must be exactly: "relevant" | "nonrelevant" | "pending"
- Target threshold .95 unless told otherwise
- Use only words that appear in the approved phrases — do not invent`;

const DEFAULT_COMPARE_SYS = `You are a Tethr QA analyst. Compare AI vs human scripts, find gaps, return merged improvements.
Return ONLY a valid JSON object. No text before or after. No markdown fences. No trailing commas:
{"score":"8/10","summary":"...","coverage":{"both":[],"humanOnly":[],"aiOnly":[],"neither":[]},"missingPatterns":[],"actionItems":[],"improvedScripts":[{"letter":"a","lines":[],"covers":"...","threshold":".95"}]}`;
const parseLines = (t) => t.split("\n").map((l) => l.replace(/^[-•*\d.)]\s*/, "").trim()).filter(Boolean);

const toB64 = (f) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res({ b64: r.result.split(",")[1], url: URL.createObjectURL(f), type: f.type, name: f.name });
  r.onerror = rej;
  r.readAsDataURL(f);
});

const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const cols = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return { def: cols[0]||"", phrase: cols[1]||"", status: (cols[2]||"").toLowerCase().replace(/[\s-]/g,""), notes: cols[3]||"" };
  }).filter((r) => r.phrase);
};

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
  const set = (k, v) => setSt((p) => ({ ...p, [k]: v }));

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
                    {st.csvRows.map((row, i) => {
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
  if (loading) return <Spinner msg={msg} />;
  if (error) return <div style={{ paddingTop:28 }}><ErrBox msg={error} /></div>;
  if (!result) return (
    <div style={{ textAlign:"center", paddingTop:80, color:A.secondary }}>
      <p style={{ fontSize:17, fontWeight:500, color:A.text, marginBottom:8 }}>No scripts generated yet</p>
      <p style={{ fontSize:14, marginBottom:24 }}>Go to Create to build your first scripts</p>
      <Btn primary onClick={onEdit}>Go to Create →</Btn>
    </div>
  );

  const rel = result.analysis.filter((a) => a.status==="relevant");
  const non = result.analysis.filter((a) => a.status==="nonrelevant");
  const pend = result.analysis.filter((a) => a.status==="pending");
  const shown = filter==="all" ? result.analysis : result.analysis.filter((a) => a.status===filter);
  const pScore = parseFloat(result.precision||"1");

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

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {/* Phrases */}
        <Card>
          <div style={{ padding:"12px 18px", borderBottom:"1px solid "+A.divider, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:600, fontSize:14, color:A.text }}>Phrases</span>
            <span style={{ fontSize:12, color:A.secondary }}>{result.analysis.length} total</span>
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
          <div style={{ maxHeight:480, overflowY:"auto" }}>
            {shown.map((item, i) => {
              const isR = item.status==="relevant", isP = item.status==="pending";
              return (
                <div key={i} style={{ padding:"9px 18px", borderBottom:"1px solid "+A.divider, display:"flex", gap:10, alignItems:"flex-start", background:isP?A.orangeBg:A.white }}>
                  {item.scriptLetter ? <ScriptBadge letter={item.scriptLetter} size={16} />
                    : <span style={{ width:16, height:16, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ width:7, height:7, borderRadius:"50%", background:!isR&&!isP?A.red:isP?A.orange:A.tertiary, display:"block" }} />
                      </span>}
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:13, color:isR?A.text:isP?A.orange:A.tertiary, margin:0, lineHeight:1.4, fontStyle:!isR&&!isP?"italic":"normal" }}>{item.phrase}</p>
                    {item.why && <p style={{ fontSize:11, color:A.tertiary, margin:"3px 0 0" }}>{item.why}</p>}
                  </div>
                  <span style={{ fontSize:16 }}>{isR?"👍":isP?"⏳":"👎"}</span>
                </div>
              );
            })}
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
function CompareTab({ aiResult, cst, setCst, comparePrompt }) {
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
    const phrases = aiResult.analysis.map((a) => "["+a.status+"] "+a.phrase).join("\n");
    content.push({ type:"text", text:"AI scripts:\n"+aiTxt+"\n\nHuman scripts:\n"+(cst.humanTxt||"(see screenshots)")+"\n\nPhrases:\n"+phrases+"\n\nCompare, find gaps, return improved merged scripts." });
    try { const r = await callAPI(comparePrompt, content, 3000); set("cmpResult", r); }
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
    { op:"{word1 word2}", col:A.monoTeal, name:"Optional neutral words", rule:'INDIVIDUAL PLAIN WORDS ONLY — each entry is a single word, not a phrase or sequence. {to quickly} = two separate words. {of them} = the word "of" and the word "them" independently, NOT the phrase "of them" in order. No [], (), or quotes inside {}. Neutral-weight — fires with or without them. Two valid placements: (1) Standalone on its own line as a bridge between anchor lines; (2) Inside a (phrase group): (cash {or} "gift cards"). Cannot go inside [] — WRONG: [{two three} of them]. CORRECT: [two three] on one line, {of them} on the next.' },
    { op:'"exact phrase"', col:A.monoRed, name:"Exact sequence", rule:'Fixed word sequence — maximum 5 words. Use ONLY when the sequence must appear verbatim (e.g. "thank you for calling", "terms and conditions"). If words within the sequence can naturally swap, use a (phrase group) with nested [OR groups] instead. WRONG: ["how may I help" "how can I help" "how can I assist"]. CORRECT: (how [may can what] I [help assist]) — one phrase group catches all variations. Test: could a caller say it with one word swapped and mean the same thing? Yes → use (phrase group). No → use "exact phrase".' },
    { op:"token:-1", col:A.red, name:"Negative weight", rule:'Suppresses score for the line it is on. Two types: (1) BROAD CONTEXT SUPPRESSOR — a wide [OR group]:-1 collecting many contextual words that signal wrong topic: [like should technical more add "not requiring" "paper work"]:-1. Deliberately wide — the breadth is the point. Exact phrases can live inside. (2) SURGICAL — a narrow (phrase group):-1 targeting a specific false positive: ("see how much is in" "my checking account"):-1. Complex form: ([OR group] (phrase group)):-1 nests both inside one () with :-1 to suppress a specific context+phrase combination.' },
    { op:"keyword", col:A.text, name:"Plain keyword", rule:"Matches anywhere in the transcript. Each line is an AND condition — all lines must match for the script to fire." },
  ];
  const guardrails = [
    { n:"1", t:"AND lines are order-independent — inversions don't need separate scripts", b:'Tethr matches AND lines anywhere in the transcript — they do not need to appear in the order written. So one script with training + [great awesome] fires on both "Training is great" AND "How great was training today". You only need separate scripts when a (phrase group) or "exact phrase" forces a specific word order that cannot be expressed otherwise.' },
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
  const [saved, setSaved] = useState(false);

  const current = activePrompt === "build" ? buildPrompt : comparePrompt;
  const setCurrent = activePrompt === "build" ? setBuildPrompt : setComparePrompt;
  const defaultVal = activePrompt === "build" ? DEFAULT_BUILD_SYS : DEFAULT_COMPARE_SYS;
  const isModified = current !== defaultVal;
  const charCount = current.length;
  const lineCount = current.split("\n").length;

  function handleSave(val) {
    setCurrent(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  function handleReset() {
    setCurrent(defaultVal);
    setSaved(false);
  }

  // Extract guardrail lines for the sidebar (lines starting with a number)
  const guardrailLines = defaultVal.split("\n").filter((l) => /^\d+\./.test(l.trim()));

  const PROMPT_TABS = [
    { id: "build", label: "Build prompt", desc: "Used when generating Tethr scripts from phrases or screenshots" },
    { id: "compare", label: "Compare prompt", desc: "Used when comparing AI scripts against human-written scripts" },
  ];

  return (
    <div style={{ paddingTop: 28 }}>
      <p style={{ fontSize: 14, color: A.secondary, lineHeight: 1.7, marginBottom: 24 }}>
        View and edit the system prompts sent to the AI. Changes apply immediately to all future generations.
      </p>

      {/* Prompt selector */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        {PROMPT_TABS.map((pt) => (
          <div key={pt.id} onClick={() => setActivePrompt(pt.id)}
            style={{ padding: "14px 18px", borderRadius: A.radius, border: "2px solid " + (activePrompt === pt.id ? A.blue : A.divider), background: activePrompt === pt.id ? A.blueBg : A.white, cursor: "pointer", boxShadow: activePrompt === pt.id ? "0 0 0 4px rgba(0,113,227,.08)" : A.shadowSm, transition: "all .15s" }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: activePrompt === pt.id ? A.blue : A.text, marginBottom: 4 }}>{pt.label}</p>
            <p style={{ fontSize: 12, color: A.secondary, margin: 0, lineHeight: 1.5 }}>{pt.desc}</p>
            {activePrompt === pt.id && isModified && (
              <span style={{ marginTop: 8, display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: A.orangeBg, color: A.orange }}>Modified</span>
            )}
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
              {isModified && (
                <button onClick={handleReset}
                  style={{ fontSize: 12, padding: "4px 11px", borderRadius: 6, border: "none", background: A.redBg, color: A.red, cursor: "pointer", fontFamily: SF, fontWeight: 500 }}>
                  Reset to default
                </button>
              )}
              <button onClick={() => handleSave(current)}
                style={{ fontSize: 12, padding: "4px 11px", borderRadius: 6, border: "none", background: saved ? A.greenBg : A.blue, color: saved ? A.greenDk : "#fff", cursor: "pointer", fontFamily: SF, fontWeight: 600, transition: "all .2s" }}>
                {saved ? "Saved ✓" : "Save changes"}
              </button>
            </div>
          </div>
          <textarea
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            style={{ ...fieldStyle, minHeight: 480, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.8, resize: "vertical", padding: "14px 16px" }}
          />
          {isModified && (
            <p style={{ fontSize: 12, color: A.orange, marginTop: 8 }}>
              ⚠ You have unsaved changes. Click "Save changes" to apply, or "Reset to default" to revert.
            </p>
          )}
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

          {/* Tips */}
          <Card padding="16px 18px">
            <p style={{ fontSize: 12, fontWeight: 700, color: A.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Editing tips</p>
            {[
              "Always end with 'Return ONLY raw JSON' to prevent markdown wrapping.",
              "Add domain-specific examples (e.g. healthcare, finance) to the guardrails section.",
              "Adjust the number of scripts (2–4) to control output verbosity.",
              "Add custom synonym rules for your industry's vocabulary.",
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

function CustomScriptTab({ buildPrompt, setTab }) {
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
      const r = await callAPI(DEFAULT_CUSTOM_SYS, content, 4000);
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

  async function generate() {
    setCst((p) => ({ ...p, buildErr:"" }));
    setBuildError("");
    const { inputMode, defText, contextText, saidBy, relText, nonText, images, csvRows, threshold } = cst;
    const relLines = parseLines(relText), nonLines = parseLines(nonText);
    if (inputMode==="text" && !relLines.length) { setCst((p) => ({...p, buildErr:"Please add at least some relevant phrases."})); return; }
    if (inputMode==="image" && !images.length) { setCst((p) => ({...p, buildErr:"Please upload at least one screenshot."})); return; }
    if (inputMode==="csv" && !csvRows?.length) { setCst((p) => ({...p, buildErr:"Please upload a CSV file."})); return; }
    if (inputMode==="both" && !images.length && !relLines.length) { setCst((p) => ({...p, buildErr:"Please upload screenshots or add phrases — or both."})); return; }
    setLoading(true); setResult(null); setTab("validate");
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
      rPhrases = csvRows.filter((r) => r.status==="relevant").map((r) => r.phrase);
      const pend = csvRows.filter((r) => r.status==="pending"||!r.status).map((r) => r.phrase);
      nPhrases = csvRows.filter((r) => r.status==="nonrelevant"||r.status==="non-relevant").map((r) => r.phrase);
      rPhrases = [...rPhrases, ...pend];
    }
    let ut = defText.trim() ? "Category definition: "+defText.trim()+"\n\n" : "";
    const saidByLabel = (saidBy||"any")==="internal" ? "Internal (agent/rep only)" : (saidBy||"any")==="external" ? "External (customer only)" : "Any (agent or customer)";
    ut += "Said by: "+saidByLabel+"\n";
    ut += (saidBy||"any")==="internal" ? "Focus scripts on agent-led phrasing — first-person agent speech, offering/action intent, [I he she we (let me)] as subject layer.\n\n"
        : (saidBy||"any")==="external" ? "Focus scripts on customer-led phrasing — requesting, questioning, expressing intent. Use [you your] as subject layer where relevant.\n\n"
        : "Scripts should cover both agent and customer phrasing patterns.\n\n";
    if (contextText?.trim()) ut += "Context examples (tone and domain only — not scored):\n"+contextText.trim()+"\n\n";
    if (rPhrases.length) ut += "Relevant phrases:\n"+rPhrases.map((p,i) => (i+1)+". "+p).join("\n")+"\n\n";
    if (nPhrases.length) ut += "Non-relevant phrases:\n"+nPhrases.map((p,i) => (i+1)+". "+p).join("\n")+"\n\n";
    ut += `Build Tethr detection scripts following all rules in the system prompt.

KEY REMINDERS:
- Use the SUBJECT → INTENT → NEGATION → ACTION → BRIDGE → TOPIC layer structure. Each layer is a separate AND line in speech order.
- Extract 2-3 word anchors per phrase — a single common word gives too little weight. Find the word COMBINATIONS that make each phrase distinctive.
- Detect word order inversions — same core words in different order across phrases = separate script for each ordering.
- USE {} optional bridge words instead of exact phrases for spoken language. "just to confirm" -> just / {to quickly gonna} / confirm. Exact phrases miss 80% of real calls because spoken language inserts filler words.
- A script can be as short as one or two lines if that is all the phrase needs. Minimal and precise beats broad.

SMART MERGING USING NESTING:
- Use [(phrase group A) (phrase group B)] to collapse multiple word order variants into one AND line
- Use (phrase [OR group] word) to handle OR variation within a phrase group rather than splitting scripts
- If two scripts share the same layers but differ in one OR group → widen that OR group and merge
- If two scripts differ only in word order of the topic → use [( order1 ) ( order2 )] in one line
- Never nest more than 3 levels deep — if it gets more complex, split into two scripts
- Word order inversions (topic before verb vs verb before topic) CANNOT be merged — always separate

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
    try { const r = await callAPI(buildPrompt, content, 4000); setResult(r); }
    catch(e) { setBuildError(e.message); }
    finally { setLoading(false); setLoadMsg(""); }
  }

  const TABS = [["create","Create"],["validate","Validate"],["compare","Compare"],["custom","Custom Script"],["basics","Scripting Basics"],["prompt","Prompt"]];

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
          <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            <span style={{ fontSize:12, color:A.tertiary, padding:"4px 10px", background:A.fill, borderRadius:6, fontWeight:500 }}>GBR</span>
            <span style={{ fontSize:12, color:A.tertiary, padding:"4px 10px", background:A.fill, borderRadius:6, fontWeight:500 }}>Transcript</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 24px 60px" }}>
        {tab==="create" && <CreateTab st={cst} setSt={setCst} onGenerate={generate} />}
        {tab==="validate" && <ValidateTab result={result} loading={loading} msg={loadMsg} error={buildError} onEdit={() => setTab("create")} onCompare={() => setTab("compare")} />}
        {tab==="compare" && <CompareTab aiResult={result} cst={compareSt} setCst={setCompareSt} comparePrompt={comparePrompt} />}
        {tab==="custom" && <CustomScriptTab buildPrompt={buildPrompt} setTab={setTab} />}
        {tab==="basics" && <BasicsTab />}
        {tab==="prompt" && <PromptsTab buildPrompt={buildPrompt} setBuildPrompt={setBuildPrompt} comparePrompt={comparePrompt} setComparePrompt={setComparePrompt} />}
      </div>
    </div>
  );
}
