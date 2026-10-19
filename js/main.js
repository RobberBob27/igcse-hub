// Entry point: hash router between Home, Papers, AI Tutor and AI Quiz views.
import { state, onSubjectChange, setDim, toast } from "./core.js";
import { initPapers, refreshPapers, hasPapersPage } from "./papers.js";
import { initTutor, onTutorShow, onGlobalSubject as tutorSubject } from "./tutor.js";
import { initQuiz, onQuizShow, onGlobalSubject as quizSubject } from "./quiz.js";
import { initQotd, qotdSubject } from "./qotd.js";

const VIEWS = {
  home: { el: "top", title: "IGCSE Papers" },
  papers: { el: "papersPage", title: "Past papers · IGCSE Papers", hash: "browse" },
  "ask-ai": { el: "tutorPage", title: "AI Tutor · IGCSE Papers", hash: "ask-ai" },
  quiz: { el: "quizPage", title: "Quiz · IGCSE Papers", hash: "quiz" }
};
let currentView = null;

function showView(name, push) {
  const v = VIEWS[name] || VIEWS.home;
  Object.keys(VIEWS).forEach(function (k) { document.getElementById(VIEWS[k].el).hidden = k !== name; });
  if (name !== "papers") setDim(false);
  document.title = v.title;
  document.querySelectorAll("header.top nav a").forEach(function (a) {
    if (a.dataset.route === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (push && v.hash && location.hash !== "#" + v.hash) history.pushState(null, "", "#" + v.hash);
  if (name !== currentView) window.scrollTo(0, 0);
  currentView = name;
}

function route(opts) {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hash === "ask-ai") { showView("ask-ai"); onTutorShow(opts); return; }
  if (hash === "quiz") { showView("quiz"); onQuizShow(opts); return; }
  if (hash === "browse" && hasPapersPage()) { showView("papers"); return; }
  showView("home");
  const target = hash && hash !== "browse" && document.getElementById(hash);
  if (target && hash !== "top") requestAnimationFrame(function () { target.scrollIntoView(); });
  else window.scrollTo(0, 0);
}

function navigate(name, opts) {
  const v = VIEWS[name];
  if (v && v.hash && location.hash !== "#" + v.hash) history.pushState(null, "", "#" + v.hash);
  route(opts);
}

// Internal links: route without a full page jump, keep history working.
document.addEventListener("click", function (e) {
  const ph = e.target.closest("[data-ph]");
  if (ph) { e.preventDefault(); toast(); return; }

  const ai = e.target.closest("[data-ai]");
  if (ai) {
    const subj = state.current ? state.current[0] : "";
    if (ai.dataset.ai === "quiz") navigate("quiz", { subject: subj, topic: "" });
    else navigate("ask-ai", { subject: subj });
    return;
  }

  const qq = e.target.closest("#qotdQuiz");
  if (qq) { e.preventDefault(); navigate("quiz", { subject: qq.dataset.subject || "", topic: "" }); return; }

  const a = e.target.closest("a[href^='#']");
  if (!a || a.getAttribute("href") === "#" || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (location.hash !== href) history.pushState(null, "", href);
  route();
});

document.getElementById("backBtn").addEventListener("click", function () {
  history.pushState(null, "", "#papers");
  route();
});

window.addEventListener("popstate", function () { route(); });

onSubjectChange(function (s) {
  refreshPapers();
  tutorSubject(s);
  quizSubject(s);
  qotdSubject(s);
});

initPapers({ showView: showView });
initTutor({ goQuiz: function (o) { navigate("quiz", o); } });
initQuiz({ goTutor: function (o) { navigate("ask-ai", o); } });
initQotd();

// Direct load of #browse has no subject selected yet — fall back to the papers section.
if (location.hash === "#browse") history.replaceState(null, "", "#papers");
route();
