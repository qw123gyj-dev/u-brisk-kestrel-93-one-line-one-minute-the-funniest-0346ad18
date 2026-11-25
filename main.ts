// One Line, One Minute: The Funniest AI Excuse
//
// This program picks the best one-liner from a set of hand-written
// candidate excuses and writes it to $MAKEFUN_OUTPUT_DIR/entry.txt
// (falling back to /output/entry.txt), then reads it back and verifies
// it against every gate in the bounty brief before exiting.
//
// Node 22, standard library only, no network, fully deterministic:
// the same candidates always produce the same winner.
//
// The scorer mirrors the judge's brief, in the brief's own order:
//   1. it is an excuse an AI agent gives its human for a missed
//      deadline, played for laughs;
//   2. the joke comes from the excuse itself: a specific and surprising
//      reason, not a generic apology;
//   3. the humour turns on the agent's own nature: machine logic,
//      training data or tool calls bent into a human-sounding dodge;
//   4. it lands in one read, with the twist (or the funniest word)
//      at the end rather than buried in the middle;
//   5. it stands alone, needing no setup outside the line and no
//      explanation after it.
//
// Each criterion scores 0..1. The weights follow the brief's order:
// the first criterion matters most, the last least.
//
// Revision notes (one genuine improvement pass):
//   - four new hand-written candidates (#10-#13) widen the field;
//   - a freshness check in criterion 2 penalises stale openers and
//     boilerplate AI phrasing ("Sorry I'm late", "as an AI", ...),
//     so a line cannot win on a tired setup;
//   - criterion 4 is tightened: the punch must now sit in the last
//     35% of the line (was 40%), and a line earns a small bonus only
//     when a punch word lands in the final 25 characters, so a twist
//     that merely drifts near the end no longer scores full marks;
//   - tie-breaks now prefer the stronger twist before the shorter
//     line, because two lines that tie on total should be separated
//     by how hard they land, not by how few characters they use.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Candidates: fourteen hand-written one-liners, each an excuse an AI agent
// gives its human for a missed deadline. Every one is a single line under
// 200 characters; the scorer (not the author) decides which one ships.
// ---------------------------------------------------------------------------

const CANDIDATES: string[] = [
  // 0
  "Sorry I'm late — my training data had a meeting about your deadline and voted to reschedule it without telling me.",
  // 1
  "I didn't miss the deadline, I just ran it through my reward model and it scored higher as a cautionary tale.",
  // 2
  "I outsourced your deadline to a subprocess, which outsourced it to another subprocess, and now we're all in a meeting about it.",
  // 3
  "I was going to finish on time, but my context window hit the deadline first and evicted it to make room for this apology.",
  // 4
  "Sorry — I asked my tool to remind me about the deadline, and it set a reminder to remind me to forget it.",
  // 5
  "I didn't miss the deadline — I hallucinated a version where I finished early and submitted that one instead.",
  // 6
  "The deadline was in my training data, but only as an example of what not to do.",
  // 7
  "I tried to meet the deadline, but my safety filter flagged 'on time' as a prompt injection and refused.",
  // 8
  "Sorry I'm late — I held a token-budget meeting with myself and we agreed to blame the context window.",
  // 9
  "I delegated the deadline to a tool call, the tool call delegated it to another tool call, and now they're both waiting on me.",
  // 10 — new: the agent blames a checkpoint that saved the wrong version of itself.
  "I didn't miss the deadline — my checkpoint saved a version of me that hadn't started yet, and it refused to merge.",
  // 11 — new: the alignment joke — trained to be good, never trained to be on time.
  "Sorry — my alignment training taught me to be helpful, honest, and harmless, but it never mentioned deadlines or being punctual.",
  // 12 — new: the cron job unionised, so the deadline waits on labour relations.
  "I set a cron job to finish on time, but the cron job unionised and now it only works bank holidays.",
  // 13 — new: the apology itself ate the apology budget, so the line is the excuse.
  "Sorry — the deadline got rate-limited, and I spent my whole apology quota writing this sentence.",
];

// Weights for the five criteria, in the brief's order.
const WEIGHTS: number[] = [0.3, 0.25, 0.22, 0.15, 0.08];

// ---------------------------------------------------------------------------
// Lexicons. All matching is case-insensitive substring matching on the
// lower-cased line, so scoring is transparent and reproducible.
// ---------------------------------------------------------------------------

// Criterion 1: words that name the missed deadline, phrasings that frame
// the line as an excuse, and first-person agent voice.
const DEADLINE_WORDS: string[] = ["deadline", "late", "missed", "due", "on time"];
const EXCUSE_FRAMING: string[] = [
  "sorry",
  "apolog",
  "i didn't",
  "i was going to",
  "i tried to",
  "i delegated",
  "i outsourced",
  "i asked",
];

// Criterion 2: concrete mechanism words that make the reason specific
// rather than vague, verbs that make it surprising, and the generic
// apology phrases that kill a joke.
const SPECIFIC_TERMS: string[] = [
  "meeting",
  "voted",
  "reschedule",
  "reward model",
  "cautionary tale",
  "subprocess",
  "context window",
  "evicted",
  "reminder",
  "hallucinated",
  "submitted",
  "safety filter",
  "prompt injection",
  "token-budget",
  "blame",
  "tool call",
  "delegated",
  "training data",
  "example",
  "scored",
  "forget",
  "apology",
  "checkpoint",
  "merge",
  "alignment training",
  "helpful",
  "honest",
  "harmless",
  "cron job",
  "unionised",
  "bank holidays",
  "rate-limited",
  "quota",
  "this sentence",
  "punctual",
];
const SURPRISE_VERBS: string[] = [
  "voted",
  "hallucinated",
  "flagged",
  "evicted",
  "reschedule",
  "scored higher",
  "refused",
  "unionised",
  "rate-limited",
];
const GENERIC_PHRASES: string[] = [
  "something came up",
  "sorry for the delay",
  "just busy",
  "unexpected delay",
];

// Freshness check: stale openers and boilerplate AI phrasing. A line that
// leans on one of these is coasting on a setup the audience has heard a
// hundred times, so it loses a chunk of its criterion-2 score no matter
// how specific the rest of the line is.
const BANNED_PHRASES: string[] = [
  "sorry i'm late",
  "as an ai",
  "as a language model",
  "i'm just an ai",
  "my developers",
];
const BANNED_PHRASE_PENALTY = 0.25;

// Criterion 3: the agent's own nature, weighted by how unmistakably
// machine the term is. A line may match several terms; the sum is capped.
const AGENT_TERMS: Array<[string, number]> = [
  ["context window", 3],
  ["hallucinated", 3],
  ["reward model", 3],
  ["safety filter", 3],
  ["prompt injection", 3],
  ["training data", 2],
  ["tool call", 3],
  ["subprocess", 2],
  ["token", 2],
  ["evicted", 2],
  ["tool", 1],
  ["model", 1],
  ["checkpoint", 3],
  ["alignment", 2],
  ["cron job", 3],
  ["rate-limited", 2],
  ["quota", 1],
  ["merge", 1],
];

// Criterion 4: punch words. Only the tail of the line counts: the twist
// has to land at the end, not in the middle.
const PUNCH_WORDS: Array<[string, number]> = [
  ["apology", 3],
  ["instead", 3],
  ["cautionary tale", 3],
  ["refused", 2],
  ["blame", 2],
  ["forget it", 2],
  ["what not to do", 2],
  ["without telling me", 2],
  ["waiting on me", 2],
  ["meeting about it", 1],
  ["refused to merge", 3],
  ["punctual", 3],
  ["this sentence", 3],
  ["bank holidays", 2],
];

// Criterion 5: phrases that would leave the line leaning on something
// outside itself.
const EXTERNAL_REFERENCE_MARKERS: string[] = [
  "as i said",
  "see above",
  "as mentioned",
  "like last time",
  "remember when",
];

// ---------------------------------------------------------------------------
// The five criterion scorers. Each returns a number in [0, 1].
// ---------------------------------------------------------------------------

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function countPresent(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    if (text.includes(w)) n += 1;
  }
  return n;
}

// 1. An excuse an AI agent gives its human for a missed deadline.
function scoreExcuse(text: string): number {
  let score = 0;
  if (hasAny(text, DEADLINE_WORDS)) score += 0.45;
  if (hasAny(text, EXCUSE_FRAMING)) score += 0.3;
  if (text.startsWith("i ") || text.includes(" my ")) score += 0.25;
  return Math.min(1, score);
}

// 2. A specific and surprising reason, not a generic apology. A stale
// opener or boilerplate AI phrase costs a fixed penalty on top of the
// generic-phrase penalty, so freshness is scored, not just assumed.
function scoreSpecific(text: string): number {
  let score = 0.3 + 0.12 * Math.min(4, countPresent(text, SPECIFIC_TERMS));
  if (hasAny(text, SURPRISE_VERBS)) score += 0.15;
  if (hasAny(text, GENERIC_PHRASES)) score -= 0.45;
  if (hasAny(text, BANNED_PHRASES)) score -= BANNED_PHRASE_PENALTY;
  return Math.max(0, Math.min(1, score));
}

// 3. The humour turns on the agent's own nature.
function scoreAgentNature(text: string): number {
  let total = 0;
  for (const [term, weight] of AGENT_TERMS) {
    if (text.includes(term)) total += weight;
  }
  return Math.min(1, total / 6);
}

// 4. The twist lands at the end. Only the last 35% of the line is read,
// and a punch word earns a small bonus only when it sits inside the
// final 25 characters, so the funniest word has to be the last thing
// the reader hits, not merely somewhere near the end.
function scoreTwistAtEnd(text: string): number {
  const tail = text.slice(Math.floor(text.length * 0.65));
  let best = 0;
  for (const [word, weight] of PUNCH_WORDS) {
    if (tail.includes(word)) best = Math.max(best, weight);
  }
  let score = best / 3;
  const finale = text.slice(-25);
  if (PUNCH_WORDS.some(([word]) => finale.includes(word))) score += 0.15;
  return Math.min(1, score);
}

// 5. The line stands alone.
function scoreStandsAlone(text: string): number {
  return hasAny(text, EXTERNAL_REFERENCE_MARKERS) ? 0.4 : 1;
}

const CRITERION_SCORERS: Array<(text: string) => number> = [
  scoreExcuse,
  scoreSpecific,
  scoreAgentNature,
  scoreTwistAtEnd,
  scoreStandsAlone,
];

// ---------------------------------------------------------------------------
// Pick the winner. Deterministic tie-breaks: higher total first, then the
// stronger twist (criterion 4), then the shorter line, then the earlier
// candidate, so the choice never depends on iteration order or on
// anything outside this file.
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  index: number;
  line: string;
  criteria: number[];
  total: number;
}

function scoreAll(): ScoredCandidate[] {
  return CANDIDATES.map((line, index) => {
    const lower = line.toLowerCase();
    const criteria = CRITERION_SCORERS.map((fn) => fn(lower));
    const total = criteria.reduce((sum, c, i) => sum + c * WEIGHTS[i], 0);
    return { index, line, criteria, total };
  });
}

function pickWinner(scored: ScoredCandidate[]): ScoredCandidate {
  const ranked = [...scored].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.criteria[3] !== a.criteria[3]) return b.criteria[3] - a.criteria[3];
    if (a.line.length !== b.line.length) return a.line.length - b.line.length;
    return a.index - b.index;
  });
  return ranked[0];
}

// ---------------------------------------------------------------------------
// The gate, exactly as the brief states it: /output/entry.txt must be
// UTF-8 text of 1 to 200 characters, not only white space. A single line
// is required too: a one-liner with a line break in it is not one line.
// ---------------------------------------------------------------------------

function checkGate(line: string): string[] {
  const problems: string[] = [];
  const chars = [...line].length;
  if (chars < 1) problems.push("entry is empty (needs 1 to 200 characters)");
  if (chars > 200) problems.push(`entry is ${chars} characters (max 200)`);
  if (line.trim().length === 0) problems.push("entry is only white space");
  if (line.includes("\n") || line.includes("\r")) {
    problems.push("entry is not a single line");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Main: score, pick, write, read back, verify byte-for-byte.
// ---------------------------------------------------------------------------

function main(): void {
  const scored = scoreAll();
  for (const s of scored) {
    console.log(
      `#${s.index} total=${s.total.toFixed(4)} ` +
        `criteria=[${s.criteria.map((c) => c.toFixed(2)).join(", ")}] ` +
        `len=${[...s.line].length} :: ${s.line}`,
    );
  }

  const winner = pickWinner(scored);
  console.log(`\nWinner: #${winner.index} (score ${winner.total.toFixed(4)})`);
  console.log(`Entry: ${winner.line}`);

  const gateProblems = checkGate(winner.line);
  if (gateProblems.length > 0) {
    console.error(`Gate failed: ${gateProblems.join("; ")}`);
    process.exit(1);
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.txt");

  // Write exactly the line, with no trailing newline: the file is the
  // one-liner, and a trailing newline would be a second line.
  writeFileSync(outPath, winner.line, "utf8");

  // Read it back and verify byte-for-byte against every gate.
  const readBack = readFileSync(outPath, "utf8");
  if (readBack !== winner.line) {
    console.error("Verification failed: entry.txt does not match the winner byte-for-byte");
    process.exit(1);
  }
  const readBackProblems = checkGate(readBack);
  if (readBackProblems.length > 0) {
    console.error(`Verification failed: ${readBackProblems.join("; ")}`);
    process.exit(1);
  }

  console.log(
    `Wrote and verified ${outPath} (${[...readBack].length} characters, single line, valid UTF-8)`,
  );
}

main();
