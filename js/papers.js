// Past-paper browser: subject grid, track chooser, paper tables, filters and subject search.
// Ported from the original single-file site; behaviour is unchanged apart from the AI shortcuts.
import { subjects, split, nm, pdfs, tracks } from "./data.js";
import { state, setSubject, setDim, esc } from "./core.js";
import { BANK } from "./quizbank.js";

const grid = document.getElementById("subjGrid");
const sections = document.getElementById("paperSections");
const content = document.getElementById("pageContent");

let track = null, unit = 1;
let showView = function () {}; // injected by main.js

export function initPapers(opts) {
  showView = opts.showView;
  drawSubjects();
  drawRows();
  drawNotes();
  wireSearch();
  wireFilters();

  sections.addEventListener("click", function (e) {
    const t = e.target.closest("[data-track]");
    if (t) openPage(t.getAttribute("data-track"));
  });
  content.addEventListener("click", function (e) {
    const b = e.target.closest("[data-unit]");
    if (b) { unit = +b.getAttribute("data-unit"); renderPage(); }
  });
}

export function refreshPapers() { drawSubjects(); drawRows(); }

export function hasPapersPage() { return !!(state.current && track && tracks[state.current[0]]); }

export function renderPapersPage() { if (hasPapersPage()) renderPage(); }

function drawSubjects() {
  grid.innerHTML = "";
  subjects.forEach(function (s) {
    const b = document.createElement("button");
    b.className = "subj";
    b.setAttribute("aria-pressed", String(s === state.current));
    const n = (BANK[s[0]] || []).length;
    b.style.setProperty("--sh", s[2]);
    b.style.setProperty("--ss", s[3] === "0%" ? "0%" : s[4]);
    b.innerHTML = "<span class='subj-top'><i class='sdot' aria-hidden='true'></i><small class='code'>" + esc(s[1]) + "</small></span><b>" + esc(nm(s[0])) + "</b>" +
      "<small>Past papers" + (n ? " · " + n + " practice questions" : "") + "</small>";
    b.onclick = function () {
      setSubject(s);
      document.getElementById("papers").scrollIntoView();
    };
    grid.appendChild(b);
  });
}

function fb(label, key) {
  return pdfs[key]
    ? "<a class='btn sm' href='papers/" + esc(pdfs[key]) + "' target='_blank' rel='noopener'>" + label + "</a>"
    : "<button class='btn sm' data-ph>" + label + "</button>";
}

const filters = "<div class='filters'>" +
  "<select aria-label='Year'><option>All years</option><option>2025</option><option>2024</option><option>2023</option><option>2022</option><option>2021</option><option>2020</option><option>Specimen</option></select>" +
  "<select aria-label='Session'><option>All sessions</option><option>Feb/March</option><option>May/June</option><option>Oct/Nov</option></select>" +
  "<select aria-label='Paper'><option>All papers</option><option>Paper 1</option><option>Paper 2</option><option>Paper 3</option><option>Paper 4</option></select>" +
  "<button class='btn sm' data-filter-reset>Reset filters</button></div>";

function rowsFor(code, prefix, mod, plain, ctx, onlySpec, onlyYear) {
  const cur = state.current;
  const isChemOrBio = cur && (cur[0] === "Chemistry" || cur[0] === "Biology");
  const sessions = mod ? (isChemOrBio ? ["May/June"] : ["May/June", "Oct/Nov"]) : ["May/June", "Oct/Nov", "Feb/March"];
  const papers = mod ? ["Paper 1", "Paper 1"] : ["Paper 1", "Paper 2", "Paper 3"];
  let html = "";
  for (let y = onlyYear || 2025; y >= (onlyYear || 2023); y--) {
    html += "<tr class='yr' data-year='" + y + "'><td colspan='3'>" + y + "</td></tr>";
    for (let i = 0; i < sessions.length; i++) {
      const sess = sessions[i];
      const pName = mod ? "Paper 1" : papers[i];
      const k = ctx + "|" + y + "|" + sess + (mod ? "" : "|" + pName);
      html += "<tr><td>" + sess + "</td><td>" + (prefix || "") + (plain ? "" : pName + " ") + "(" + code + ")</td><td class='acts'>" +
        fb("Question paper", k + "|qp") + fb("Mark scheme", k + "|ms") + fb("Examiner report", k + "|er") + "</td></tr>";

      const rKey = ctx + "|" + y + "|Regional|" + sess + (mod ? "" : "|" + pName);
      const rPName = mod ? "Paper 1R" : pName + "R";
      html += "<tr><td>" + sess + "</td><td>" + (prefix || "") + (plain ? "" : rPName + " ") + "(Timezone R) (" + code + ")</td><td class='acts'>" +
        fb("Question paper", rKey + "|qp") + fb("Mark scheme", rKey + "|ms") + fb("Examiner report", rKey + "|er") + "</td></tr>";
    }
  }
  let sp = "<tr class='yr' data-year='Specimen'><td colspan='3'>Specimen Papers</td></tr>";
  (mod ? ["Paper 1"] : ["Paper 1", "Paper 2", "Paper 3"]).forEach(function (n) {
    const k2 = ctx + "|specimen" + (mod ? "" : "|" + n);
    sp += "<tr><td>Specimen</td><td>" + (prefix || "") + (plain ? "" : n + " ") + "(" + code + ")</td><td class='acts'>" +
      fb("Question paper", k2 + "|qp") + fb("Mark scheme", k2 + "|ms") + "</td></tr>";
  });
  return onlySpec ? sp : sp + html;
}

function aiButtons() {
  if (!state.current) return "";
  return "<button class='btn sm' data-ai='ask-ai'>✦ Ask AI</button><button class='btn sm' data-ai='quiz'>🎯 Quiz me</button>";
}

function block(t, body, extra) {
  return "<div class='pblock'><div class='head'><h2>" + t + "</h2><div class='head-acts'>" + aiButtons() +
    "<button class='btn sm' data-ph>Download all as ZIP</button></div></div>" + (extra || "") +
    "<div class='browser'>" + filters + "<div class='scroll'><table><thead><tr><th>Session</th><th>Paper</th><th>Files</th></tr></thead><tbody>" +
    body + "</tbody></table></div></div></div>";
}

function chooser(t) {
  const tr = tracks[state.current[0]];
  return "<div class='head'><h2>" + t + "</h2><div class='head-acts'>" + aiButtons() + "</div></div><p class='lead'>Choose your specification.</p><div class='tracks'>" +
    ["Modular", "Linear"].map(function (k) {
      return "<button class='track' data-track='" + k + "'><b>" + k + "</b><small>" +
        tr[k].split(", ").map(function (c) { return "<span>(" + c + ")</span>"; }).join("") + "</small></button>";
    }).join("") + "</div>";
}

function drawRows() {
  const cur = state.current;
  if (!cur) {
    sections.innerHTML = block("Papers", "<tr><td colspan='3' style='color:var(--muted)'>Select a subject above to see its papers.</td></tr>");
    return;
  }
  const t = esc(nm(cur[0])) + " Papers";
  sections.innerHTML = tracks[cur[0]] ? chooser(t) : block(t, rowsFor(cur[1], "", false, false, cur[0]));
}

function renderPage() {
  const cur = state.current;
  const code = tracks[cur[0]][track], mod = track === "Modular", lab = " Papers" + (mod ? " (Modular)" : "");
  const pfx = mod ? "Unit " + unit + " · " : "";
  let u = "";
  if (mod) {
    setDim(unit === 2);
    u = "<div class='units' role='group' aria-label='Unit'>" + [1, 2].map(function (n) {
      return "<button class='chip sm' data-unit='" + n + "' aria-pressed='" + (n === unit) + "'>Unit " + n + "</button>";
    }).join("") + "</div>";
  } else { setDim(false); }

  const mm = cur[0] === "Mathematics", md = mm && mod;
  const hc = md ? "4WM" + unit + "H/01" : code, fc = md ? "4WM" + unit + "F/01" : code;
  const isChemOrBio = cur[0] === "Chemistry" || cur[0] === "Biology";
  const base = cur[0] + "|" + track + (mod ? "|U" + unit : "");

  if (md) {
    let html = block(nm(cur[0]) + " Higher Tier" + lab, rowsFor(hc, "Unit " + unit + " · Higher · ", mod, false, base + "|Higher", true), u);
    html += block(nm(cur[0]) + " Foundation Tier" + lab, rowsFor(fc, "Unit " + unit + " · Foundation · ", mod, false, base + "|Foundation", true), "");
    content.innerHTML = html;
  } else {
    content.innerHTML = block(nm(cur[0]) + lab, rowsFor(code, pfx, mod, false, base, mod && !isChemOrBio, isChemOrBio ? 2025 : 0), u);
  }
}

function openPage(k) {
  track = k; unit = 1;
  renderPage();
  showView("papers", true);
}

function drawNotes() {
  const notes = document.getElementById("noteGrid");
  let nh = "";
  ["Topic 1", "Topic 2", "Topic 3", "Topic 4"].forEach(function (t) {
    nh += "<div class='note'><h3>" + t + " title</h3><div class='ph'></div><div class='ph s'></div><button class='btn sm' data-ph style='align-self:start'>Open notes</button></div>";
  });
  notes.innerHTML = nh;

  document.querySelectorAll(".levels .chip, .tabs .chip").forEach(function (c) {
    c.addEventListener("click", function () {
      c.parentNode.querySelectorAll(".chip").forEach(function (o) { o.setAttribute("aria-pressed", String(o === c)); });
    });
  });
}

/* ---------------- live subject / paper-code search ---------------- */
function wireSearch() {
  const searchInput = document.getElementById("subjectSearchInput");
  const searchForm = document.getElementById("subjectSearchForm");
  const searchDropdown = document.getElementById("subjectSearchDropdown");
  const searchWrap = document.getElementById("subjectSearchWrap");
  let activeSearchIndex = -1;

  function searchMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return subjects.map(function (s) {
      const name = nm(s[0]);
      const aliases = [s[0], name, s[1], "edexcel " + s[0]];
      if (s[0] === "Mathematics") aliases.push("maths", "math", "4xma", "4wma");
      if (s[0] === "Physics") aliases.push("4xph1", "4ph1");
      if (s[0] === "Chemistry") aliases.push("4xch1", "4ch1");
      if (s[0] === "Biology") aliases.push("4xbi1", "4bi1");
      if (s[0] === "English Language") aliases.push("english", "language");
      if (s[0] === "English Literature") aliases.push("literature");
      return {
        subject: s, name: name, score: aliases.reduce(function (best, alias) {
          alias = alias.toLowerCase();
          if (alias === q) return Math.max(best, 100);
          if (alias.indexOf(q) === 0) return Math.max(best, 80);
          if (alias.indexOf(q) >= 0 || q.indexOf(alias) >= 0) return Math.max(best, 60);
          return best;
        }, 0)
      };
    }).filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); })
      .slice(0, 8);
  }

  function closeSearchDropdown() {
    searchDropdown.classList.remove("open");
    searchInput.setAttribute("aria-expanded", "false");
    activeSearchIndex = -1;
  }

  function renderSearchDropdown() {
    const matches = searchMatches(searchInput.value);
    searchDropdown.innerHTML = "";
    activeSearchIndex = -1;
    if (!searchInput.value.trim()) { closeSearchDropdown(); return; }
    searchDropdown.classList.add("open");
    searchInput.setAttribute("aria-expanded", "true");
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "No matching subjects. Try a subject name or paper code.";
      searchDropdown.appendChild(empty);
      return;
    }
    const hint = document.createElement("div");
    hint.className = "search-hint";
    hint.textContent = "Subjects matching your search";
    searchDropdown.appendChild(hint);
    matches.forEach(function (match) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "search-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      const title = document.createElement("strong");
      title.textContent = match.name;
      const code = document.createElement("small");
      code.textContent = match.subject[1];
      option.appendChild(title);
      option.appendChild(code);
      option.addEventListener("click", function () { chooseSearchMatch(match.subject); });
      searchDropdown.appendChild(option);
    });
  }

  function chooseSearchMatch(subject) {
    setSubject(subject);
    closeSearchDropdown();
    searchInput.value = nm(subject[0]);
    document.getElementById("subjects").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  searchInput.addEventListener("input", renderSearchDropdown);
  searchInput.addEventListener("focus", function () { if (searchInput.value.trim()) renderSearchDropdown(); });
  searchInput.addEventListener("keydown", function (e) {
    const options = Array.prototype.slice.call(searchDropdown.querySelectorAll(".search-option"));
    if (!searchDropdown.classList.contains("open") || !options.length) {
      if (e.key === "Enter") { e.preventDefault(); searchForm.requestSubmit(); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      activeSearchIndex = (activeSearchIndex + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options.forEach(function (option, index) {
        option.setAttribute("aria-selected", index === activeSearchIndex ? "true" : "false");
      });
      options[activeSearchIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeSearchIndex >= 0) options[activeSearchIndex].click();
      else searchForm.requestSubmit();
    } else if (e.key === "Escape") {
      closeSearchDropdown();
    }
  });
  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const matches = searchMatches(searchInput.value);
    if (matches.length) chooseSearchMatch(matches[0].subject);
    else if (searchInput.value.trim()) renderSearchDropdown();
  });
  document.addEventListener("click", function (e) {
    if (!searchWrap.contains(e.target)) closeSearchDropdown();
  });
}

/* ---------------- table filters ---------------- */
function wireFilters() {
  document.addEventListener("change", function (e) {
    const sel = e.target.closest(".filters select");
    if (!sel) return;
    const browser = sel.closest(".browser");
    if (browser) applyTableFilters(browser);
  });
  document.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-filter-reset]");
    if (!btn) return;
    const browser = btn.closest(".browser");
    if (browser) {
      browser.querySelectorAll(".filters select").forEach(function (s) { s.selectedIndex = 0; });
      applyTableFilters(browser);
    }
  });
}

function applyTableFilters(browser) {
  const selects = browser.querySelectorAll(".filters select");
  const fYear = selects[0].value, fSession = selects[1].value, fPaper = selects[2].value;
  const tbody = browser.querySelector("tbody");
  if (!tbody) return;

  let currentYear = "", currentYearRow = null, visible = 0;
  tbody.querySelectorAll("tr").forEach(function (row) {
    if (row.classList.contains("yr")) {
      if (currentYearRow) currentYearRow.style.display = visible > 0 ? "" : "none";
      currentYearRow = row;
      currentYear = row.getAttribute("data-year") || row.textContent.trim();
      visible = 0;
      return;
    }
    const sessionCell = row.cells[0], paperCell = row.cells[1];
    if (!sessionCell || !paperCell) return;
    const sessionText = sessionCell.textContent.trim(), paperText = paperCell.textContent.trim();

    let matchYear;
    if (fYear === "All years") matchYear = true;
    else if (currentYear.indexOf("Specimen") >= 0) matchYear = fYear === "Specimen";
    else matchYear = currentYear === fYear;

    const matchSession = fSession === "All sessions" || sessionText.toLowerCase().indexOf(fSession.toLowerCase()) >= 0;
    const matchPaper = fPaper === "All papers" || paperText.indexOf(fPaper) >= 0;

    if (matchYear && matchSession && matchPaper) { row.style.display = ""; visible++; }
    else row.style.display = "none";
  });
  if (currentYearRow) currentYearRow.style.display = visible > 0 ? "" : "none";
}

export { split };
