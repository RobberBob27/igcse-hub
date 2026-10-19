// Quiz: questions come from the built-in bank (instant) or from AI via /api/quiz (Python function).
// Plays them, scores them and tracks history.
import { topics, generalTopics, findSubject, nm } from "./data.js";
import { state, setSubject, store, esc, toast, fillSubjectSelect, segmented } from "./core.js";
import { renderMarkdown, renderMath, setRich } from "./markdown.js";
import { BANK } from "./quizbank.js";

const HIST_KEY = "igcse.quiz.history.v1";
const SOURCE_KEY = "igcse.quiz.source";
const LETTERS = ["A", "B", "C", "D"];

const el = {};
let difficulty, count, source;
let quiz = null; // {subject, topic, difficulty, questions, i, answers[], hints[]}
let goTutor = function () {};
let busy = false;

export function initQuiz(opts) {
  goTutor = opts.goTutor;
  ["quizSetup", "quizLoading", "quizLoadingText", "quizPlay", "quizResults", "quizForm", "quizSubject", "quizTopic",
    "quizTopicSuggest", "quizDifficulty", "quizSource", "quizDiffWrap", "quizFallback", "quizCount", "quizGo", "quizErr", "quizMeta", "quizProgressText", "quizScore",
    "quizBar", "quizBarWrap", "qTopic", "qText", "qOpts", "qHint", "qFeedback", "qHintBtn", "qQuit", "qNext",
    "resArc", "resPct", "resHeadline", "resSub", "resRetry", "resNew", "resTutor", "resReview", "histList", "weakList", "histClear"]
    .forEach(function (id) { el[id] = document.getElementById(id); });

  fillSubjectSelect(el.quizSubject, false);
  difficulty = segmented(el.quizDifficulty);
  count = segmented(el.quizCount);
  source = segmented(el.quizSource, function (v) { store.set(SOURCE_KEY, v); syncSource(); });
  source.set(store.get(SOURCE_KEY, "bank") === "ai" ? "ai" : "bank");
  el.quizFallback.addEventListener("click", function () { source.set("bank"); syncSource(); generate(); });

  el.quizSubject.addEventListener("change", function () {
    setSubject(findSubject(el.quizSubject.value));
    drawTopicChips();
  });
  el.quizTopicSuggest.addEventListener("click", function (e) {
    const b = e.target.closest("button[data-t]");
    if (b) { el.quizTopic.value = b.dataset.t; el.quizTopic.focus(); }
  });
  el.quizForm.addEventListener("submit", function (e) { e.preventDefault(); generate(); });

  el.qOpts.addEventListener("click", function (e) {
    const b = e.target.closest("button[data-i]");
    if (b) answer(+b.dataset.i);
  });
  el.qHintBtn.addEventListener("click", showHint);
  el.qNext.addEventListener("click", next);
  el.qQuit.addEventListener("click", function () {
    if (!quiz) return;
    const answered = quiz.answers.filter(function (a) { return a != null; }).length;
    if (!answered) { showPanel("setup"); quiz = null; return; }
    finish();
  });

  el.resNew.addEventListener("click", function () { showPanel("setup"); el.quizTopic.focus(); });
  el.resRetry.addEventListener("click", retryWrong);
  el.resTutor.addEventListener("click", reviewWithTutor);
  el.histClear.addEventListener("click", function () {
    store.remove(HIST_KEY);
    drawHistory();
    updateHomeStats();
    toast("Quiz history cleared");
  });
  el.weakList.addEventListener("click", function (e) {
    const b = e.target.closest("button[data-topic]");
    if (!b) return;
    el.quizSubject.value = b.dataset.subject;
    setSubject(findSubject(b.dataset.subject));
    el.quizTopic.value = b.dataset.topic;
    drawTopicChips();
    generate();
  });

  document.addEventListener("keydown", onKey);

  if (state.current) el.quizSubject.value = state.current[0];
  syncSource();
  drawHistory();
  updateHomeStats();
}

export function onQuizShow(opts) {
  opts = opts || {};
  if (opts.subject) el.quizSubject.value = opts.subject;
  else if (state.current && !quiz) el.quizSubject.value = state.current[0];
  if (opts.topic != null) el.quizTopic.value = opts.topic;
  const s = findSubject(el.quizSubject.value);
  if (s !== state.current) setSubject(s);
  drawTopicChips();
  if (opts.topic != null || opts.subject) showPanel("setup");
  if (opts.autostart) generate();
}

export function onGlobalSubject(s) {
  if (s && !busy) { el.quizSubject.value = s[0]; drawTopicChips(); }
}

function syncSource() {
  const bank = source.get() === "bank";
  el.quizDiffWrap.hidden = bank;
  el.quizGo.textContent = bank ? "Start quiz" : "Generate quiz";
  el.quizErr.textContent = "";
  el.quizFallback.hidden = true;
  drawTopicChips();
}

function bankTopics(subject) {
  const seen = [];
  (BANK[subject] || []).forEach(function (q) { if (seen.indexOf(q[0]) < 0) seen.push(q[0]); });
  return seen;
}

function drawTopicChips() {
  const list = source && source.get() === "bank"
    ? bankTopics(el.quizSubject.value)
    : (topics[el.quizSubject.value] || generalTopics).slice(0, 6);
  el.quizTopicSuggest.innerHTML = list.map(function (t) {
    return "<button type='button' data-t='" + esc(t) + "'>" + esc(t) + "</button>";
  }).join("");
}

function showPanel(name) {
  el.quizSetup.hidden = name !== "setup";
  el.quizLoading.hidden = name !== "loading";
  el.quizPlay.hidden = name !== "play";
  el.quizResults.hidden = name !== "results";
}

/* ---------------- generate ---------------- */
// Turn a bank entry into a playable question with shuffled options.
export function fromBank(entry) {
  const order = shuffle([0, 1, 2, 3].slice(0, entry[2].length));
  return {
    topic: entry[0], question: entry[1],
    options: order.map(function (i) { return entry[2][i]; }),
    answer: order.indexOf(0), explanation: entry[3], hint: entry[4]
  };
}

function bankQuiz(subject, topic, n) {
  const all = BANK[subject] || [];
  const t = topic.toLowerCase();
  let pool = t ? all.filter(function (q) { return q[0].toLowerCase().indexOf(t) >= 0 || t.indexOf(q[0].toLowerCase()) >= 0 || q[1].toLowerCase().indexOf(t) >= 0; }) : all;
  let label = topic || "Mixed topics";
  if (!pool.length) {
    pool = all;
    label = "Mixed topics";
    toast("No bank questions on \"" + topic + "\" yet, so here's a mix. Try AI-generated for that topic.", 3200);
  }
  return { label: label, questions: shuffle(pool.slice()).slice(0, n).map(fromBank) };
}

async function generate() {
  if (busy) return;
  const subject = el.quizSubject.value;
  const topic = el.quizTopic.value.trim();
  const diff = difficulty.get() || "Mixed";
  const n = +(count.get() || 5);
  el.quizErr.textContent = "";
  el.quizFallback.hidden = true;

  if (source.get() === "bank") {
    const b = bankQuiz(subject, topic, n);
    if (!b.questions.length) { el.quizErr.textContent = "There are no bank questions for this subject yet."; return; }
    if (b.questions.length < n) toast("The bank has " + b.questions.length + " questions on this, so the quiz is shorter.", 2600);
    start({ subject: subject, topic: b.label, difficulty: "Question bank", questions: b.questions });
    return;
  }

  busy = true;
  el.quizLoadingText.textContent = "Writing " + n + " " + (diff === "Mixed" ? "" : diff + " ") + "questions on " + (topic || nm(subject)) + "…";
  showPanel("loading");

  try {
    const res = await fetch("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject, topic: topic, difficulty: diff, count: n })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || "Quiz service unavailable (" + res.status + ").");
    if (!Array.isArray(data.questions) || !data.questions.length) throw new Error("No questions came back. Try a different topic.");
    start({ subject: subject, topic: topic || data.title || nm(subject), difficulty: diff, questions: data.questions });
  } catch (err) {
    showPanel("setup");
    el.quizErr.textContent = (err && err.message) || "Something went wrong. Please try again.";
    if (!navigator.onLine) el.quizErr.textContent = "You appear to be offline.";
    if ((BANK[subject] || []).length) el.quizFallback.hidden = false;
  } finally {
    busy = false;
  }
}

function start(q) {
  quiz = q;
  quiz.i = 0;
  quiz.answers = q.questions.map(function () { return null; });
  quiz.hints = q.questions.map(function () { return false; });
  showPanel("play");
  el.quizMeta.textContent = nm(q.subject) + " · " + q.topic + " · " + q.difficulty;
  el.quizBarWrap.setAttribute("aria-valuemax", String(q.questions.length));
  drawQuestion();
}

/* ---------------- play ---------------- */
function drawQuestion() {
  const q = quiz.questions[quiz.i];
  const total = quiz.questions.length;
  el.quizProgressText.textContent = "Question " + (quiz.i + 1) + " of " + total;
  el.quizBar.style.width = (quiz.i / total * 100) + "%";
  el.quizBarWrap.setAttribute("aria-valuenow", String(quiz.i));
  updateScore();
  el.qTopic.textContent = q.topic || quiz.topic;
  el.qTopic.hidden = !(q.topic || quiz.topic);
  setRich(el.qText, q.question);
  el.qOpts.innerHTML = q.options.map(function (o, i) {
    return "<button type='button' class='opt' data-i='" + i + "'><span class='k'>" + LETTERS[i] + "</span><span class='t'>" + renderInline(o) + "</span></button>";
  }).join("");
  renderMath(el.qOpts);
  el.qHint.hidden = true;
  el.qFeedback.hidden = true;
  el.qNext.hidden = true;
  el.qHintBtn.hidden = !q.hint;
  el.qHintBtn.disabled = false;
  const first = el.qOpts.querySelector("button");
  if (first && document.activeElement && document.activeElement.closest && document.activeElement.closest("#quizPlay")) first.focus();
}

function renderInline(s) {
  // options are short: render Markdown but unwrap the paragraph
  return renderMarkdown(s).replace(/^<p>([\s\S]*)<\/p>$/, "$1");
}

function answer(i) {
  const q = quiz.questions[quiz.i];
  if (quiz.answers[quiz.i] != null) return;
  quiz.answers[quiz.i] = i;
  const ok = i === q.answer;
  el.qOpts.querySelectorAll("button").forEach(function (b, bi) {
    b.disabled = true;
    if (bi === q.answer) b.classList.add("correct");
    else if (bi === i) b.classList.add("wrong");
    else b.classList.add("dim");
  });
  el.qHintBtn.disabled = true;
  el.qFeedback.className = "qfeedback " + (ok ? "ok" : "no");
  el.qFeedback.innerHTML = "<h4>" + (ok ? pick(["Correct!", "Spot on!", "Nailed it.", "That's right."]) : "Not quite. The answer is " + LETTERS[q.answer] + ".") + "</h4><div class='md'></div>";
  setRich(el.qFeedback.querySelector(".md"), q.explanation || "");
  el.qFeedback.hidden = false;
  el.qNext.textContent = quiz.i === quiz.questions.length - 1 ? "See results →" : "Next question →";
  el.qNext.hidden = false;
  el.qNext.focus({ preventScroll: true });
  updateScore();
}

function showHint() {
  const q = quiz && quiz.questions[quiz.i];
  if (!q || !q.hint || quiz.answers[quiz.i] != null) return;
  quiz.hints[quiz.i] = true;
  el.qHint.innerHTML = "<b>Hint:</b> <span class='md'></span>";
  setRich(el.qHint.querySelector(".md"), q.hint);
  el.qHint.hidden = false;
}

function next() {
  if (!quiz || quiz.answers[quiz.i] == null) return;
  if (quiz.i < quiz.questions.length - 1) { quiz.i++; drawQuestion(); el.quizPlay.scrollIntoView({ block: "start", behavior: "smooth" }); }
  else finish();
}

function updateScore() {
  const answered = quiz.answers.filter(function (a) { return a != null; }).length;
  el.quizScore.textContent = correctCount() + " / " + answered;
}

function correctCount() {
  return quiz.answers.reduce(function (n, a, i) { return n + (a === quiz.questions[i].answer ? 1 : 0); }, 0);
}

function onKey(e) {
  if (el.quizPlay.hidden || !quiz || document.getElementById("quizPage").hidden) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= quiz.questions[quiz.i].options.length) { e.preventDefault(); answer(n - 1); }
  else if (e.key === "h" || e.key === "H") showHint();
  else if (e.key === "Enter" && quiz.answers[quiz.i] != null && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); next(); }
}

/* ---------------- results ---------------- */
function finish() {
  const answeredIdx = [];
  quiz.answers.forEach(function (a, i) { if (a != null) answeredIdx.push(i); });
  const total = answeredIdx.length;
  const score = correctCount();
  const pct = total ? Math.round(score / total * 100) : 0;

  showPanel("results");
  el.quizBar.style.width = "100%";
  el.resPct.textContent = pct + "%";
  el.resArc.style.strokeDashoffset = "326.7";
  requestAnimationFrame(function () { requestAnimationFrame(function () { el.resArc.style.strokeDashoffset = String(326.7 * (1 - pct / 100)); }); });
  el.resHeadline.textContent = pct === 100 ? "Perfect score!" : pct >= 80 ? "Excellent work" : pct >= 60 ? "Good effort" : pct >= 40 ? "Getting there" : "Keep practising";
  el.resSub.textContent = "You got " + score + " out of " + total + " on " + quiz.topic + " (" + quiz.difficulty + ")." +
    (score < total ? " Review the explanations below, then retry the ones you missed." : "");
  const wrong = answeredIdx.filter(function (i) { return quiz.answers[i] !== quiz.questions[i].answer; });
  el.resRetry.hidden = !wrong.length;
  el.resTutor.hidden = !wrong.length;

  el.resReview.innerHTML = answeredIdx.map(function (i) {
    const q = quiz.questions[i], a = quiz.answers[i], ok = a === q.answer;
    return "<li class='" + (ok ? "ok" : "no") + "'><div class='rq md'>" + renderMarkdown(q.question) + "</div>" +
      "<div class='ra'>" + (ok ? "✓ " : "✗ You chose <b>" + LETTERS[a] + ". " + renderInline(q.options[a]) + "</b> · ") +
      "Answer: <b>" + LETTERS[q.answer] + ". " + renderInline(q.options[q.answer]) + "</b></div>" +
      "<details><summary>Explanation</summary><div class='md'>" + renderMarkdown(q.explanation || "") + "</div></details></li>";
  }).join("");
  renderMath(el.resReview);

  // save to history
  if (total) {
    const hist = store.get(HIST_KEY, []);
    hist.unshift({
      subject: quiz.subject, topic: quiz.topic, difficulty: quiz.difficulty,
      score: score, total: total, date: Date.now(),
      missed: wrong.map(function (i) { return quiz.questions[i].topic || quiz.topic; }).slice(0, 10)
    });
    store.set(HIST_KEY, hist.slice(0, 30));
    drawHistory();
    updateHomeStats();
  }
  el.quizResults.scrollIntoView({ block: "start", behavior: "smooth" });
}

function retryWrong() {
  const wrongQs = quiz.questions.filter(function (q, i) { return quiz.answers[i] != null && quiz.answers[i] !== q.answer; })
    .map(shuffleOptions);
  if (!wrongQs.length) return;
  start({ subject: quiz.subject, topic: quiz.topic, difficulty: quiz.difficulty, questions: wrongQs });
}

function shuffleOptions(q) {
  const order = q.options.map(function (_, i) { return i; });
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  return Object.assign({}, q, { options: order.map(function (i) { return q.options[i]; }), answer: order.indexOf(q.answer) });
}

function reviewWithTutor() {
  const wrong = [];
  quiz.questions.forEach(function (q, i) {
    const a = quiz.answers[i];
    if (a != null && a !== q.answer) wrong.push(q);
  });
  if (!wrong.length) return;
  const lines = wrong.slice(0, 6).map(function (q, n) {
    const a = quiz.answers[quiz.questions.indexOf(q)];
    return (n + 1) + ". " + q.question + "\n   I chose: " + q.options[a] + "\n   Correct answer: " + q.options[q.answer];
  });
  const ask = "I just did a quiz on " + quiz.topic + " and got these wrong. For each one, explain the misconception behind my answer and how to get it right next time:\n\n" + lines.join("\n\n");
  goTutor({ subject: quiz.subject, mode: "explain", ask: ask, fresh: true });
}

/* ---------------- history ---------------- */
function drawHistory() {
  const hist = store.get(HIST_KEY, []);
  if (!Array.isArray(hist) || !hist.length) {
    el.histList.innerHTML = "<li class='side-empty' style='background:none;border:0;padding:0'>No quizzes yet. Your scores will show up here.</li>";
    el.weakList.innerHTML = "<li class='side-empty'>Topics you miss questions on will be suggested here.</li>";
    el.histClear.hidden = true;
    return;
  }
  el.histClear.hidden = false;
  el.histList.innerHTML = hist.slice(0, 8).map(function (h) {
    const pct = Math.round(h.score / Math.max(1, h.total) * 100);
    return "<li><div><b>" + esc(h.topic) + "</b><small>" + esc(nm(h.subject)) + " · " + esc(h.difficulty) + " · " + timeAgo(h.date) + "</small></div><span class='pct'>" + pct + "%</span></li>";
  }).join("");

  const tally = {};
  hist.forEach(function (h) {
    (h.missed || []).forEach(function (t) {
      const k = h.subject + "|" + t;
      tally[k] = (tally[k] || 0) + 1;
    });
  });
  const weak = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, 5);
  el.weakList.innerHTML = weak.length ? weak.map(function (k) {
    const parts = k.split("|");
    return "<li><button type='button' data-subject='" + esc(parts[0]) + "' data-topic='" + esc(parts[1]) + "'>" + esc(parts[1]) +
      "<small>" + esc(nm(parts[0])) + " · missed " + tally[k] + "× · tap to practise</small></button></li>";
  }).join("") : "<li class='side-empty'>Nothing to revisit — great work.</li>";
}

export function updateHomeStats() {
  const t = document.getElementById("homeStatsText");
  if (!t) return;
  const hist = store.get(HIST_KEY, []);
  if (!Array.isArray(hist) || !hist.length) { t.textContent = "Take a quiz and your recent scores will appear here."; return; }
  const totalQ = hist.reduce(function (n, h) { return n + h.total; }, 0);
  const totalS = hist.reduce(function (n, h) { return n + h.score; }, 0);
  const avg = Math.round(totalS / Math.max(1, totalQ) * 100);
  t.innerHTML = "<div class='stat-row'><div><strong>" + hist.length + "</strong><span>quizzes</span></div><div><strong>" + totalQ +
    "</strong><span>questions</span></div><div><strong>" + avg + "%</strong><span>average</span></div></div>";
}

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : d + " days ago";
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
