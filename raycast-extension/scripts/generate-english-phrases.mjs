import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "data/english/english-phrases-2000.txt");

/**
 * Phase 3 editorial bank: reflex-transfer sentences (not template spam).
 * Goals: a/an + number agreement, interleaved families, lexical diversity,
 * useful punctuation; no /path-N junk or tautology loops.
 */

const subjects = [
  "system",
  "project",
  "report",
  "team",
  "schedule",
  "plan",
  "review",
  "draft",
  "workflow",
  "dashboard",
  "session",
  "release",
  "service",
  "document",
  "result",
  "feature",
  "test",
  "task",
  "meeting",
  "process",
  "client",
  "vendor",
  "pipeline",
  "module",
  "branch",
  "ticket",
  "board",
  "alert",
  "backup",
  "router",
];

const objects = [
  "draft",
  "report",
  "summary",
  "file",
  "plan",
  "result",
  "record",
  "message",
  "document",
  "setting",
  "example",
  "table",
  "schedule",
  "version",
  "answer",
  "detail",
  "note",
  "list",
  "request",
  "change",
  "outline",
  "checklist",
  "handoff",
  "log",
  "brief",
  "packet",
  "snapshot",
  "timeline",
  "invoice",
  "receipt",
];

const verbs = [
  "check",
  "save",
  "review",
  "compare",
  "update",
  "share",
  "open",
  "close",
  "test",
  "measure",
  "record",
  "confirm",
  "prepare",
  "sort",
  "send",
  "move",
  "keep",
  "read",
  "write",
  "finish",
  "export",
  "import",
  "merge",
  "fix",
  "label",
  "pin",
  "archive",
  "restore",
  "publish",
  "verify",
];

const singularVerbs = verbs.map((verb) => {
  if (verb.endsWith("y") && !/[aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  if (verb.endsWith("s") || verb.endsWith("x") || verb.endsWith("ch") || verb.endsWith("sh"))
    return `${verb}es`;
  return `${verb}s`;
});

const times = [
  "lunch",
  "the meeting",
  "the review",
  "tomorrow",
  "Friday",
  "sunset",
  "the deadline",
  "the next call",
  "the release",
  "the session",
  "dinner",
  "the weekend",
  "the next round",
  "the final check",
  "the update",
  "the handoff",
  "the demo",
  "the restart",
  "the test",
  "the launch",
  "noon",
  "midnight",
  "standup",
  "retro",
  "ship day",
];

const conditions = [
  "the meeting ends",
  "the upload finishes",
  "the review begins",
  "the page loads",
  "the team arrives",
  "the timer starts",
  "the test completes",
  "the signal changes",
  "the next step is clear",
  "the draft is ready",
  "the call begins",
  "the data is stable",
  "the screen is open",
  "the result appears",
  "the work is complete",
  "the session resets",
  "the request arrives",
  "the task is assigned",
  "the alert appears",
  "the plan changes",
  "the build turns green",
  "the queue empties",
  "the cursor settles",
  "the cache warms",
  "the lock clears",
];

const qualities = [
  "clear",
  "simple",
  "useful",
  "ready",
  "stable",
  "careful",
  "complete",
  "current",
  "reliable",
  "focused",
  "helpful",
  "accurate",
  "quiet",
  "timely",
  "practical",
  "secure",
  "brief",
  "consistent",
  "flexible",
  "strong",
  "honest",
  "urgent",
  "polished",
  "lean",
  "explicit",
];


const locations = [
  "the shared folder",
  "this screen",
  "the main page",
  "the final section",
  "the local cache",
  "the review board",
  "the project folder",
  "the next row",
  "the settings panel",
  "the task list",
  "the work queue",
  "the test report",
  "the current session",
  "the release notes",
  "the results table",
  "the message thread",
  "the summary page",
  "the change log",
  "the help panel",
  "the source file",
  "the sidebar",
  "the inbox",
  "the staging area",
  "the archive shelf",
  "the margin notes",
];

const startWindows = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "the first morning",
  "the next morning",
  "release day",
  "review day",
  "launch day",
  "demo day",
  "the final morning",
  "the last morning",
  "a busy morning",
  "a quiet morning",
  "test day",
  "the workday",
  "the next holiday",
  "ship week",
  "sprint day",
  "handoff day",
  "training day",
  "cleanup day",
];


const pluralNouns = [
  "items",
  "notes",
  "tasks",
  "files",
  "alerts",
  "checks",
  "rows",
  "pages",
  "edits",
  "tickets",
];

function pick(values, seed, multiplier) {
  const cycle = Math.floor(seed / values.length);
  return values[((seed % values.length) + cycle * multiplier) % values.length];
}

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function distinctPair(primary, secondary, seed, multA, multB) {
  let a = pick(primary, seed, multA);
  let b = pick(secondary, seed, multB);
  let guard = 0;
  while (a === b && guard < 8) {
    b = pick(secondary, seed + guard + 1, multB + guard + 1);
    guard++;
  }
  return [a, b];
}

function avoidTautologyTime(subject, object, time, seed) {
  const banned = new Set([subject, object, `${subject}s`]);
  let next = time;
  let guard = 0;
  while (
    guard < 10 &&
    [...banned].some((token) => next.toLowerCase().includes(token))
  ) {
    next = pick(times, seed + guard + 3, 17 + guard);
    guard++;
  }
  return next;
}

const templates = [
  (i) => {
    const [subject, object] = distinctPair(subjects, objects, i, 3, 7);
    const time = avoidTautologyTime(subject, object, pick(times, i, 11), i);
    return `The ${subject} ${pick(singularVerbs, i, 5)} the ${object} before ${time}.`;
  },
  (i) => {
    const object = pick(objects, i, 7);
    return `Please ${pick(verbs, i, 2)} the ${object} when ${pick(conditions, i, 11)}.`;
  },
  (i) => {
    const [objectA, objectB] = distinctPair(objects, objects, i, 5, 11);
    const [verbA, verbB] = distinctPair(verbs, verbs, i, 3, 7);
    return `We can ${verbA} the ${objectA}, then ${verbB} the ${objectB}.`;
  },
  (i) => {
    const object = pick(objects, i, 9);
    const time = avoidTautologyTime("x", object, pick(times, i, 13), i);
    return `I will ${pick(verbs, i, 5)} the ${object} after ${time}.`;
  },
  (i) => {
    const [subject, object] = distinctPair(subjects, objects, i, 7, 13);
    const [q1, q2] = distinctPair(qualities, qualities, i, 11, 17);
    return `The ${subject} is ${q1}, but the ${object} is ${q2}.`;
  },
  (i) => {
    const object = pick(objects, i, 3);
    const time = avoidTautologyTime("x", object, pick(times, i, 7), i);
    return `Can you ${pick(verbs, i, 11)} the ${object} by ${time}?`;
  },
  (i) => {
    const [subject, object] = distinctPair(subjects, objects, i, 5, 11);
    return `After ${pick(conditions, i, 2)}, the ${subject} ${pick(singularVerbs, i, 7)} the ${object}.`;
  },
  (i) => {
    const object = pick(objects, i, 3);
    return `Keep the ${object} ${pick(qualities, i, 7)} until ${pick(conditions, i, 11)}.`;
  },
  (i) => {
    const subject = pick(subjects, i, 5);
    const countA = (i % 9) + 1;
    const countB = (i % 7) + 1;
    const [nounA, nounB] = distinctPair(pluralNouns, pluralNouns, i, 3, 11);
    const labelA = countA === 1 ? nounA.replace(/s$/, "") : nounA;
    const labelB = countB === 1 ? nounB.replace(/s$/, "") : nounB;
    return `The ${subject} shows ${countA} new ${labelA} and ${countB} ${labelB}.`;
  },
  (i) => {
    const object = pick(objects, i, 11);
    const [verbA, verbB] = distinctPair(verbs, verbs, i, 7, 13);
    return `Don't ${verbA} the ${object}; ${verbB} it after ${pick(conditions, i, 17)}.`;
  },
  (i) => {
    const subject = pick(subjects, i, 11);
    const [q1, q2] = distinctPair(qualities, qualities, i, 13, 17);
    return `Our ${subject} gets ${q1} with each ${q2} result.`;
  },
  (i) => {
    const [objectA, objectB] = distinctPair(objects, objects, i, 2, 5);
    const time = avoidTautologyTime(objectA, objectB, pick(times, i, 7), i);
    return `The ${objectA} needs one more ${objectB} before ${time}.`;
  },
  (i) => {
    const object = pick(objects, i, 11);
    return `Please ${pick(verbs, i, 5)} the next ${object} in plain English.`;
  },
  (i) => {
    const subject = pick(subjects, i, 7);
    const hour = (i % 12) + 1;
    const minute = ["00", "15", "30", "45"][i % 4];
    return `The ${subject} starts at ${hour}:${minute} on ${pick(startWindows, i, 11)}.`;
  },
  (i) => {
    const quality = pick(qualities, i, 3);
    const object = pick(objects, i, 5);
    return `We found ${articleFor(quality)} ${quality} path -- not a quick fix -- through the ${object}.`;
  },
  (i) => {
    const object = pick(objects, i, 7);
    const [q1, q2] = distinctPair(qualities, qualities, i, 11, 19);
    return `The ${object} was ${q1}, ${q2}, and useful.`;
  },
  (i) => {
    const check = i + 1;
    return `We passed check ${check} after ${pick(conditions, i, 13)}.`;
  },
  (i) => {
    const object = pick(objects, i, 5);
    return `Use the ${object} when ${pick(conditions, i, 11)}.`;
  },
  (i) => {
    const object = pick(objects, i, 11);
    const location = pick(locations, i, 7);
    return `Put the ${object} beside the notes in ${location}; label it "ready".`;
  },
  (i) => {
    const quality = pick(qualities, i, 13);
    const object = pick(objects, i, 17);
    return `Great! Every ${quality} review makes the final ${object} stronger.`;
  },
];

// Interleave families so small scopes aren't one template block.
const TARGET = 2_000;
const phrases = [];
const seen = new Set();
let cursor = 0;
let guard = 0;
while (phrases.length < TARGET && guard < TARGET * 20) {
  const family = phrases.length % templates.length;
  const phrase = templates[family](cursor);
  cursor++;
  guard++;
  if (seen.has(phrase)) continue;
  // Reject leftover path-style or empty junk if any template regresses.
  if (/\/[A-Za-z0-9_-]+-\d+/.test(phrase)) continue;
  if (/\ba [aeiou]/i.test(phrase) || /\ban [bcdfghjklmnpqrstvwxyz]/i.test(phrase))
    continue;
  seen.add(phrase);
  phrases.push(phrase);
}

if (phrases.length !== TARGET) {
  throw new Error(
    `English Phrases generator must create ${TARGET} unique phrases (got ${phrases.length})`,
  );
}

// Sanity: first 40 should span many families (interleave check).
const headFamilies = new Set(
  phrases.slice(0, 40).map((phrase, index) => {
    // Rough fingerprint by leading pattern
    if (phrase.startsWith("Please ")) return "please";
    if (phrase.startsWith("Can you ")) return "can";
    if (phrase.startsWith("I will ")) return "iwill";
    if (phrase.startsWith("We can ")) return "wecan";
    if (phrase.startsWith("We found ")) return "found";
    if (phrase.startsWith("We passed ")) return "passed";
    if (phrase.startsWith("Don't ")) return "dont";
    if (phrase.startsWith("Keep ")) return "keep";
    if (phrase.startsWith("After ")) return "after";
    if (phrase.startsWith("Our ")) return "our";
    if (phrase.startsWith("Use ")) return "use";
    if (phrase.startsWith("Put ")) return "put";
    if (phrase.startsWith("Great!")) return "great";
    if (phrase.startsWith("The ") && phrase.includes(" starts at ")) return "starts";
    if (phrase.startsWith("The ") && phrase.includes(" shows ")) return "shows";
    if (phrase.startsWith("The ") && phrase.includes(", but the ")) return "but";
    return `other-${index % 7}`;
  }),
);
if (headFamilies.size < 10) {
  throw new Error(
    `Interleave failed: only ${headFamilies.size} families in first 40 phrases`,
  );
}

await writeFile(outputPath, `${phrases.join("\n")}\n`);
console.log(`Wrote ${phrases.length} interleaved phrases to ${outputPath}`);
