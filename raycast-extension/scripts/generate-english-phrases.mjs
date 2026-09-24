import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "data/english/english-phrases-2000.txt");
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
];
const singularVerbs = [
  "checks",
  "saves",
  "reviews",
  "compares",
  "updates",
  "shares",
  "opens",
  "closes",
  "tests",
  "measures",
  "records",
  "confirms",
  "prepares",
  "sorts",
  "sends",
  "moves",
  "keeps",
  "reads",
  "writes",
  "finishes",
];
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
];

function pick(values, seed, multiplier) {
  const cycle = Math.floor(seed / values.length);
  return values[((seed % values.length) + cycle * multiplier) % values.length];
}

const templates = [
  (i) =>
    `The ${pick(subjects, i, 3)} ${pick(singularVerbs, i, 5)} the ${pick(objects, i, 7)} before ${pick(times, i, 11)}.`,
  (i) =>
    `Please ${pick(verbs, i, 2)} the ${pick(objects, i, 7)} when ${pick(conditions, i, 11)}.`,
  (i) =>
    `We can ${pick(verbs, i, 3)} the ${pick(objects, i, 5)}, then ${pick(verbs, i, 7)} the ${pick(objects, i, 11)}.`,
  (i) =>
    `I will ${pick(verbs, i, 5)} the ${pick(objects, i, 9)} after ${pick(times, i, 13)}.`,
  (i) =>
    `The ${pick(subjects, i, 7)} is ${pick(qualities, i, 11)}, but the ${pick(objects, i, 13)} is ${pick(qualities, i, 17)}.`,
  (i) =>
    `Can you ${pick(verbs, i, 11)} the ${pick(objects, i, 3)} by ${pick(times, i, 7)}?`,
  (i) =>
    `After ${pick(conditions, i, 2)}, the ${pick(subjects, i, 5)} ${pick(singularVerbs, i, 7)} the ${pick(objects, i, 11)}.`,
  (i) =>
    `Keep the ${pick(objects, i, 3)} ${pick(qualities, i, 7)} until ${pick(conditions, i, 11)}.`,
  (i) =>
    `The ${pick(subjects, i, 5)} shows ${(i % 9) + 1} new items and ${(i % 7) + 1} notes.`,
  (i) =>
    `Don't ${pick(verbs, i, 7)} the ${pick(objects, i, 11)}; ${pick(verbs, i, 13)} it after ${pick(conditions, i, 17)}.`,
  (i) =>
    `Our ${pick(subjects, i, 11)} gets ${pick(qualities, i, 13)} with each ${pick(qualities, i, 17)} result.`,
  (i) =>
    `The ${pick(objects, i, 2)} needs one more ${pick(objects, i, 5)} before ${pick(times, i, 7)}.`,
  (i) =>
    `Please ${pick(verbs, i, 5)} the next ${pick(objects, i, 11)} in plain English.`,
  (i) =>
    `The ${pick(subjects, i, 7)} starts at ${(i % 12) + 1}:15 on ${pick(startWindows, i, 11)}.`,
  (i) =>
    `We found a ${pick(qualities, i, 3)} path -- not a quick fix -- through the ${pick(objects, i, 5)}.`,
  (i) =>
    `The ${pick(objects, i, 7)} was ${pick(qualities, i, 11)}, clear, and useful.`,
  (i) => `We passed check ${i + 1} after ${pick(conditions, i, 13)}.`,
  (i) => `Use the ${pick(objects, i, 5)} when ${pick(conditions, i, 11)}.`,
  (i) =>
    `The new ${pick(subjects, i, 7)} works in /${pick(objects, i, 11)}-${i + 1}.`,
  (i) =>
    `Great! Every ${pick(qualities, i, 13)} review makes the final ${pick(objects, i, 17)} stronger.`,
];

const phraseGroups = templates.map((template) =>
  Array.from({ length: 100 }, (_, index) => template(index)),
);
const phrases = phraseGroups.flat();
if (phrases.length !== 2_000 || new Set(phrases).size !== phrases.length) {
  const duplicateCounts = phraseGroups.map(
    (group) => group.length - new Set(group).size,
  );
  throw new Error(
    `English Phrases generator must create 2,000 unique phrases: ${duplicateCounts.join(",")}`,
  );
}

await writeFile(outputPath, `${phrases.join("\n")}\n`);
