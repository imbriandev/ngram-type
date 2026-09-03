const STORAGE_KEY = "ngram-type-web-state";
const DATA = window.NGRAM_DATA;
const labels = { bigrams: "Bigrams", trigrams: "Trigrams", tetragrams: "Tetragrams", words: "Words", custom_words: "Custom words" };
const defaults = { source: "bigrams", scope: 50, combination: 2, repetition: 3, minimumWPM: 40, minimumAccuracy: 100, customWords: [], phrases: [], phraseIndex: 0, wpms: [] };
let state = loadState();
let expected = "";
let typed = "";
let startedAt = null;
let lastMetrics = { wpm: 0, accuracy: 0 };

const $ = (id) => document.getElementById(id);
const source = $("source");
const settingsSource = $("settings-source");
const typing = $("typing");
const phrase = $("phrase");
const lesson = $("lesson");
const hint = $("hint");
const settingsDialog = $("settings-dialog");
const settingsForm = $("settings-form");

function loadState() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") };
  } catch {
    return { ...defaults };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // File URLs may disable browser storage; practice still works for this session.
  }
}

function valuesForSource() {
  return state.source === "custom_words" ? state.customWords : DATA[state.source];
}

function generatePhrases() {
  const values = valuesForSource().slice(0, state.source === "custom_words" ? undefined : state.scope);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  const combination = Math.max(1, Math.floor(Number(state.combination)) || 1);
  const repetition = Math.max(1, Math.floor(Number(state.repetition)) || 1);
  const phrases = [];
  for (let i = 0; i < values.length; i += combination) {
    const part = values.slice(i, i + combination).join(" ");
    phrases.push(Array(repetition).fill(part).join(" "));
  }
  return phrases;
}

function resetRound() {
  state.phrases = generatePhrases();
  state.phraseIndex = 0;
  state.wpms = [];
  resetPhrase();
  saveState();
}

function resetPhrase(message = "Type accurately. Press Esc to reset the phrase.") {
  typed = "";
  startedAt = null;
  hint.textContent = message;
  hint.className = "hint";
  typing.value = "";
  render();
  typing.focus();
}

function metrics() {
  let correct = 0;
  for (let i = 0; i < Math.min(expected.length, typed.length); i++) {
    if (expected[i] === typed[i]) correct++;
  }
  const total = typed.length;
  const seconds = startedAt ? Math.max((Date.now() - startedAt) / 1000, 0.001) : 0;
  return {
    correct,
    wrong: total - correct,
    wpm: startedAt ? Math.round((total / 5 / seconds) * 60) : 0,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
  };
}

function renderPhrase() {
  phrase.replaceChildren();
  for (let i = 0; i < typed.length; i++) {
    const character = document.createElement("span");
    character.textContent = typed[i];
    character.className = expected[i] === typed[i] ? "typed" : "mistake";
    phrase.append(character);
  }
  const remaining = document.createElement("span");
  remaining.className = "remaining";
  remaining.textContent = expected.slice(typed.length);
  phrase.append(remaining);
  const caret = document.createElement("span");
  caret.className = "caret";
  phrase.append(caret);
}

function render() {
  expected = state.phrases[state.phraseIndex] || "";
  const current = metrics();
  lastMetrics = current;
  source.value = state.source;
  lesson.textContent = expected ? `Lesson ${state.phraseIndex + 1} / ${state.phrases.length}` : "Ready to practice";
  renderPhrase();
  $("wpm").textContent = current.wpm;
  $("accuracy").textContent = `${current.accuracy}%`;
  $("average").textContent = `${average(state.wpms)} WPM`;
  typing.classList.toggle("error", typed.length > 0 && !expected.startsWith(typed));
  settingsSource.value = state.source;
  $("scope").disabled = state.source === "custom_words";
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function finishPhrase() {
  const current = metrics();
  if (current.wpm < state.minimumWPM || current.accuracy < state.minimumAccuracy) {
    resetPhrase(`Try again · minimum ${state.minimumWPM} WPM and ${state.minimumAccuracy}% accuracy`);
    hint.className = "hint error";
    return;
  }
  if (state.phraseIndex === 0) state.wpms = [];
  state.wpms.push(current.wpm);
  state.phraseIndex++;
  hint.textContent = `Great! ${current.wpm} WPM · ${current.accuracy}% accuracy`;
  hint.className = "hint success";
  if (state.phraseIndex >= state.phrases.length) {
    state.phrases = generatePhrases();
    state.phraseIndex = 0;
  }
  typed = "";
  startedAt = null;
  saveState();
  render();
  typing.focus();
}

function setSource(value) {
  if (!labels[value]) return;
  state.source = value;
  resetRound();
}

source.addEventListener("change", () => setSource(source.value));
$("settings-button").addEventListener("click", () => {
  settingsForm.source.value = state.source;
  settingsForm.scope.value = state.scope;
  settingsForm.combination.value = state.combination;
  settingsForm.repetition.value = state.repetition;
  settingsForm.minimumWPM.value = state.minimumWPM;
  settingsForm.minimumAccuracy.value = state.minimumAccuracy;
  settingsForm.customWords.value = state.customWords.join("\n");
  settingsDialog.showModal();
});
$("close-settings").addEventListener("click", () => settingsDialog.close());
$("cancel-settings").addEventListener("click", () => settingsDialog.close());
settingsSource.addEventListener("change", () => { $("scope").disabled = settingsSource.value === "custom_words"; });
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(settingsForm);
  state.source = form.get("source");
  state.scope = Number(form.get("scope")) || 50;
  state.combination = Math.max(1, Number(form.get("combination")) || 1);
  state.repetition = Math.max(1, Number(form.get("repetition")) || 1);
  state.minimumWPM = Math.max(1, Number(form.get("minimumWPM")) || 1);
  state.minimumAccuracy = Math.min(100, Math.max(1, Number(form.get("minimumAccuracy")) || 1));
  state.customWords = String(form.get("customWords") || "").split(/\s+/).filter(Boolean);
  resetRound();
  settingsDialog.close();
});
typing.addEventListener("input", () => {
  typed = typing.value.trimStart();
  typing.value = typed;
  if (!typed) return resetPhrase();
  if (!startedAt) startedAt = Date.now();
  const current = metrics();
  hint.textContent = expected.startsWith(typed) ? `${typed.length} / ${expected.length} characters` : "Mistake — correct it or press Esc to reset";
  hint.className = expected.startsWith(typed) ? "hint" : "hint error";
  render();
  if (typed.trimEnd() === expected) finishPhrase();
});
typing.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); resetPhrase("Phrase reset"); }
  if (event.key === "Tab") { event.preventDefault(); resetPhrase("Phrase reset"); }
  if (event.key === "Enter" && event.metaKey) { event.preventDefault(); }
});
setInterval(() => { if (startedAt) render(); }, 250);
if (!state.phrases.length || state.phraseIndex >= state.phrases.length) resetRound();
else render();
typing.focus();
