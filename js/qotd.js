// Home page "Question of the day": one bank question answered inline.
import { BANK } from "./quizbank.js";
import { state, esc } from "./core.js";
import { nm } from "./data.js";
import { renderMarkdown, renderMath, setRich } from "./markdown.js";
import { fromBank } from "./quiz.js";

const LETTERS = ["A", "B", "C", "D"];
const el = {};
let q = null;

export function initQotd() {
  ["qotd", "qotdSubj", "qotdQ", "qotdOpts", "qotdFb", "qotdNext"].forEach(function (id) { el[id] = document.getElementById(id); });
  if (!el.qotd) return;
  el.qotdOpts.addEventListener("click", function (e) {
    const b = e.target.closest("button[data-i]");
    if (b) answer(+b.dataset.i);
  });
  el.qotdNext.addEventListener("click", function () { show(randomPick(state.current ? state.current[0] : null)); });
  show(dailyPick());
}

// Called when the selected subject changes: switch to a question from that subject.
export function qotdSubject(s) {
  if (s && BANK[s[0]] && (!q || q.subject !== s[0])) show(randomPick(s[0]));
}

function allEntries() {
  const out = [];
  Object.keys(BANK).forEach(function (subj) { BANK[subj].forEach(function (e) { out.push({ subject: subj, entry: e }); }); });
  return out;
}

// Same question for everyone on a given day.
function dailyPick() {
  const all = allEntries();
  const d = new Date();
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return all[(day * 37) % all.length];
}

function randomPick(subject) {
  const pool = subject && BANK[subject] ? BANK[subject].map(function (e) { return { subject: subject, entry: e }; }) : allEntries();
  let p;
  do { p = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && q && p.entry[1] === q.question);
  return p;
}

function show(pick) {
  q = Object.assign({ subject: pick.subject }, fromBank(pick.entry));
  el.qotdSubj.textContent = nm(q.subject) + " · " + q.topic;
  setRich(el.qotdQ, q.question);
  el.qotdOpts.innerHTML = q.options.map(function (o, i) {
    return "<button type='button' class='opt' data-i='" + i + "'><span class='k'>" + LETTERS[i] + "</span><span class='t'>" +
      renderMarkdown(o).replace(/^<p>([\s\S]*)<\/p>$/, "$1") + "</span></button>";
  }).join("");
  renderMath(el.qotdOpts);
  el.qotdFb.hidden = true;
  const quizLink = document.getElementById("qotdQuiz");
  if (quizLink) quizLink.dataset.subject = q.subject;
}

function answer(i) {
  if (!q || el.qotdOpts.querySelector(".correct")) return;
  const ok = i === q.answer;
  el.qotdOpts.querySelectorAll("button").forEach(function (b, bi) {
    b.disabled = true;
    b.classList.add(bi === q.answer ? "correct" : bi === i ? "wrong" : "dim");
  });
  el.qotdFb.className = "qotd-fb md " + (ok ? "ok" : "no");
  el.qotdFb.innerHTML = "<b>" + (ok ? "Correct!" : "Not quite. It's " + LETTERS[q.answer] + ".") + "</b> " +
    renderMarkdown(q.explanation).replace(/^<p>([\s\S]*)<\/p>$/, "$1");
  renderMath(el.qotdFb);
  el.qotdFb.hidden = false;
}

export { esc };
