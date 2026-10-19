// AI tutor: multi-turn streaming chat with modes, photo questions, voice input and saved history.
import { topics, generalTopics, findSubject, nm } from "./data.js";
import { state, setSubject, store, esc, toast, fillSubjectSelect, segmented } from "./core.js";
import { renderMarkdown, renderMath } from "./markdown.js";

const STORE_KEY = "igcse.tutor.v2";
const MAX_SAVED = 40;
const MAX_IMAGE_EDGE = 1600;
const PHOTO_PROMPT = "Help me answer the question in this photo.";

export const MODES = [
  { id: "explain", name: "Explain", desc: "Clear explanation with a worked example", verb: "Explain " },
  { id: "notes", name: "Revision notes", desc: "Key points, definitions and exam tips", verb: "Revision notes on " },
  { id: "practice", name: "Exam practice", desc: "I ask exam-style questions, then mark you", verb: "Give me an exam question on " },
  { id: "mark", name: "Mark my answer", desc: "Paste a question and your answer", verb: "" },
  { id: "simple", name: "Simplify", desc: "Plain words and everyday analogies", verb: "Explain simply: " }
];

const el = {};
let messages = [];       // {role:"user"|"model", text, img?, hadImage?, mode?, error?}
let mode = "explain";
let tier;                // segmented control
let pendingImage = null; // {dataUrl, mimeType, base64}
let controller = null;   // AbortController for the active stream
let goQuiz = function () {};

export function initTutor(opts) {
  goQuiz = opts.goQuiz;
  ["chatLog", "chatEmpty", "chatForm", "chatInput", "sendBtn", "chatImage", "attachPreview", "micBtn",
    "tutorSubject", "tutorTier", "tutorModes", "tutorSuggest", "newChatBtn", "quizFromChatBtn", "charCount"]
    .forEach(function (id) { el[id] = document.getElementById(id); });

  fillSubjectSelect(el.tutorSubject, true);
  tier = segmented(el.tutorTier, save);

  // modes
  el.tutorModes.innerHTML = MODES.map(function (m) {
    return "<button type='button' class='mode' role='radio' data-mode='" + m.id + "' aria-checked='false'><b>" + esc(m.name) + "</b><small>" + esc(m.desc) + "</small></button>";
  }).join("");
  el.tutorModes.addEventListener("click", function (e) {
    const b = e.target.closest("[data-mode]");
    if (b) setMode(b.dataset.mode);
  });

  // restore saved chat
  const saved = store.get(STORE_KEY, null);
  if (saved && Array.isArray(saved.messages)) {
    messages = saved.messages.filter(function (m) { return m && (m.role === "user" || m.role === "model") && typeof m.text === "string"; });
    if (saved.tier) tier.set(saved.tier);
    if (saved.mode) mode = saved.mode;
    if (typeof saved.subject === "string") el.tutorSubject.value = saved.subject;
  }
  setMode(mode, true);

  el.tutorSubject.addEventListener("change", function () {
    const s = findSubject(el.tutorSubject.value);
    setSubject(s);
    drawSuggestions();
    save();
  });

  el.chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (controller) { controller.abort(); return; }
    send(el.chatInput.value);
  });
  el.chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.chatForm.requestSubmit(); }
  });
  el.chatInput.addEventListener("input", autosize);

  el.chatImage.addEventListener("change", function () {
    const f = el.chatImage.files && el.chatImage.files[0];
    el.chatImage.value = "";
    if (f) attachImage(f);
  });
  // paste an image straight into the box
  el.chatInput.addEventListener("paste", function (e) {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        const f = items[i].getAsFile();
        if (f) { e.preventDefault(); attachImage(f); return; }
      }
    }
  });

  el.newChatBtn.addEventListener("click", function () {
    if (controller) controller.abort();
    messages = [];
    clearImage();
    save();
    drawAll();
    el.chatInput.focus();
  });
  el.quizFromChatBtn.addEventListener("click", function () {
    goQuiz({ subject: el.tutorSubject.value, topic: guessTopic() });
  });

  el.chatLog.addEventListener("click", onLogClick);
  el.tutorSuggest.addEventListener("click", function (e) {
    const b = e.target.closest("button[data-q]");
    if (b) send(b.dataset.q);
  });

  setupVoice();
  drawAll();
}

// Called when the tutor view is shown.
export function onTutorShow(opts) {
  opts = opts || {};
  if (opts.subject != null) el.tutorSubject.value = opts.subject;
  else if (!messages.length && state.current) el.tutorSubject.value = state.current[0];
  const s = findSubject(el.tutorSubject.value);
  if (s !== state.current) setSubject(s);
  if (opts.mode) setMode(opts.mode);
  drawSuggestions();
  if (opts.ask) {
    if (opts.fresh) { messages = []; drawAll(); }
    send(opts.ask);
  } else {
    setTimeout(function () { el.chatInput.focus({ preventScroll: true }); }, 50);
  }
  scrollToBottom(true);
}

export function onGlobalSubject(s) {
  if (!messages.length) { el.tutorSubject.value = s ? s[0] : ""; drawSuggestions(); }
}

function setMode(id, quiet) {
  if (!MODES.some(function (m) { return m.id === id; })) id = "explain";
  mode = id;
  el.tutorModes.querySelectorAll("[data-mode]").forEach(function (b) {
    b.setAttribute("aria-checked", String(b.dataset.mode === id));
  });
  el.chatInput.placeholder = id === "mark"
    ? "Paste the question, the marks available, and your answer…"
    : id === "practice" ? "Name a topic and I'll set you an exam-style question…"
    : "e.g. Explain the difference between speed and velocity";
  drawSuggestions();
  if (!quiet) save();
}

function drawSuggestions() {
  const subj = el.tutorSubject.value;
  const pool = (topics[subj] || generalTopics).slice();
  const m = MODES.find(function (x) { return x.id === mode; });
  let list;
  if (mode === "mark") {
    list = ["How do I get full marks on a 6-mark question?", "Mark this: (3 marks) Explain why ... My answer: ..."];
  } else {
    list = shuffle(pool).slice(0, 4).map(function (t) { return m.verb + (m.verb ? lowerFirst(t) : t); });
  }
  el.tutorSuggest.innerHTML = list.map(function (q) {
    return "<button type='button' data-q='" + esc(q) + "'>" + esc(q) + "</button>";
  }).join("");
}

/* ---------------- sending & streaming ---------------- */
async function send(text, opts) {
  text = String(text || "").trim();
  opts = opts || {};
  if (controller) return;
  if (!text && !pendingImage && !opts.regenerate) return;
  if (!text && pendingImage) text = PHOTO_PROMPT;

  if (!opts.regenerate) {
    const userMsg = { role: "user", text: text, mode: mode };
    if (pendingImage) { userMsg.img = pendingImage; userMsg.hadImage = true; }
    messages.push(userMsg);
    clearImage();
    el.chatInput.value = "";
    autosize();
    drawAll();
  }

  const aiMsg = { role: "model", text: "", mode: mode };
  messages.push(aiMsg);
  const node = appendMessage(aiMsg, true);
  const body = node.querySelector(".md");
  scrollToBottom(true);
  setBusy(true);

  controller = new AbortController();
  let raf = 0;
  const paint = function () { raf = 0; body.innerHTML = renderMarkdown(aiMsg.text) || "<span class='typing'><i></i><i></i><i></i></span>"; scrollToBottom(); };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildPayload())
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || type.indexOf("application/json") >= 0) {
      let msg = "The AI tutor is unavailable right now (" + res.status + ").";
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* not JSON */ }
      throw new Error(msg);
    }
    if (!res.body || !res.body.getReader) {
      aiMsg.text = await res.text();
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        aiMsg.text += dec.decode(r.value, { stream: true });
        const cut = aiMsg.text.indexOf("\u0000ERR:");
        if (cut >= 0) {
          const err = aiMsg.text.slice(cut + 5);
          aiMsg.text = aiMsg.text.slice(0, cut);
          throw new Error(err || "The response was interrupted.");
        }
        if (!raf) raf = requestAnimationFrame(paint);
      }
      aiMsg.text += dec.decode();
    }
    if (!aiMsg.text.trim()) throw new Error("The AI returned an empty answer. Try rephrasing your question.");
  } catch (err) {
    if (err && err.name === "AbortError") {
      aiMsg.text = (aiMsg.text || "").trim() + (aiMsg.text ? "\n\n" : "") + "_Stopped._";
    } else {
      aiMsg.error = (err && err.message) || "Something went wrong.";
      if (!navigator.onLine) aiMsg.error = "You appear to be offline. Check your connection and try again.";
    }
  } finally {
    if (raf) cancelAnimationFrame(raf);
    controller = null;
    setBusy(false);
    if (aiMsg.error && !aiMsg.text) {
      messages.pop();
      node.remove();
      appendError(aiMsg.error);
    } else {
      node.replaceWith(messageNode(aiMsg, messages.length - 1));
      if (aiMsg.error) appendError(aiMsg.error);
    }
    save();
    scrollToBottom();
  }
}

function buildPayload() {
  // Send the most recent turns only; strip errors and keep images only on the newest user turn.
  const turns = messages.filter(function (m) { return !m.error || m.text; }).slice(0, -1).slice(-16);
  let lastUser = -1;
  turns.forEach(function (m, i) { if (m.role === "user") lastUser = i; });
  return {
    subject: el.tutorSubject.value || "",
    tier: tier.get() || "Higher",
    mode: mode,
    messages: turns.map(function (m, i) {
      const out = { role: m.role, text: m.text.slice(0, 6000) };
      if (i === lastUser && m.img) out.image = { mimeType: m.img.mimeType, data: m.img.base64 };
      else if (m.hadImage && m.role === "user") out.text = "[I attached a photo here] " + out.text;
      return out;
    })
  };
}

function setBusy(on) {
  el.sendBtn.textContent = on ? "Stop" : "Send";
  el.sendBtn.classList.toggle("stop", on);
  el.sendBtn.setAttribute("aria-label", on ? "Stop generating" : "Send");
}

/* ---------------- rendering ---------------- */
function drawAll() {
  el.chatLog.querySelectorAll(".msg").forEach(function (n) { n.remove(); });
  el.chatEmpty.hidden = messages.length > 0;
  messages.forEach(function (m, i) { el.chatLog.appendChild(messageNode(m, i)); });
}

function appendMessage(m, pending) {
  el.chatEmpty.hidden = true;
  const n = messageNode(m, messages.length - 1, pending);
  el.chatLog.appendChild(n);
  return n;
}

function messageNode(m, index, pending) {
  const d = document.createElement("div");
  if (m.role === "user") {
    d.className = "msg user";
    const b = document.createElement("div");
    b.className = "bubble";
    if (m.img && m.img.dataUrl) {
      const img = document.createElement("img");
      img.src = m.img.dataUrl; img.alt = "Attached question photo";
      b.appendChild(img);
    } else if (m.hadImage) {
      const s = document.createElement("div"); s.className = "img-note"; s.textContent = "📷 Photo attached";
      b.appendChild(s);
    }
    b.appendChild(document.createTextNode(m.text));
    d.appendChild(b);
    return d;
  }
  d.className = "msg ai";
  d.dataset.index = index;
  const modeName = (MODES.find(function (x) { return x.id === m.mode; }) || MODES[0]).name;
  d.innerHTML = "<div class='who'><span class='dot'>✦</span>AI tutor · " + esc(modeName) + "</div><div class='md'></div>";
  const body = d.querySelector(".md");
  if (pending) {
    body.innerHTML = "<span class='typing' aria-label='AI is thinking'><i></i><i></i><i></i></span>";
  } else {
    body.innerHTML = renderMarkdown(m.text);
    renderMath(body);
    const isLast = index === messages.length - 1;
    const acts = document.createElement("div");
    acts.className = "msg-acts";
    acts.innerHTML = "<button type='button' data-act='copy'>Copy</button>" +
      (isLast ? "<button type='button' data-act='regen'>↻ Regenerate</button>" : "") +
      "<button type='button' data-act='quiz'>🎯 Quiz me on this</button>" +
      (m.mode !== "simple" ? "<button type='button' data-act='simpler'>Simpler please</button>" : "");
    d.appendChild(acts);
  }
  return d;
}

function appendError(msg) {
  const d = document.createElement("div");
  d.className = "msg ai err";
  d.innerHTML = "<div class='who'><span class='dot'>!</span>Couldn't get an answer</div><div class='md'></div><div class='msg-acts'><button type='button' data-act='retry'>Try again</button></div>";
  d.querySelector(".md").textContent = msg;
  el.chatLog.appendChild(d);
}

function onLogClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const node = b.closest(".msg");
  const idx = node && node.dataset.index != null ? +node.dataset.index : -1;
  const act = b.dataset.act;
  if (act === "copy" && messages[idx]) copyText(messages[idx].text);
  else if (act === "regen" && !controller) {
    messages.splice(idx, 1);
    node.remove();
    send("", { regenerate: true });
  } else if (act === "retry" && !controller) {
    node.remove();
    // last message should be the user's; resend it
    send("", { regenerate: true });
  } else if (act === "quiz") {
    goQuiz({ subject: el.tutorSubject.value, topic: guessTopic(idx) });
  } else if (act === "simpler") {
    send("Can you explain that more simply, with an everyday analogy?");
  }
}

function copyText(t) {
  const done = function () { toast("Copied to clipboard"); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t); done(); });
  } else { fallbackCopy(t); done(); }
}
function fallbackCopy(t) {
  const ta = document.createElement("textarea");
  ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) { /* ignore */ }
  ta.remove();
}

function scrollToBottom(force) {
  const log = el.chatLog;
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
  if (force || near) log.scrollTop = log.scrollHeight;
}

function autosize() {
  const t = el.chatInput;
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + 2, 180) + "px";
  const n = t.value.length;
  el.charCount.textContent = n > 3200 ? n + " / 4000" : "";
}

/* ---------------- images ---------------- */
function attachImage(file) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast("Please use a PNG, JPG or WebP image"); return; }
  if (file.size > 15 * 1024 * 1024) { toast("That image is too large (max 15 MB)"); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);
    pendingImage = { dataUrl: dataUrl, mimeType: "image/jpeg", base64: dataUrl.split(",")[1] };
    el.attachPreview.innerHTML = "<img alt='Photo to send'><span class='fine'>Photo ready to send</span><button type='button' aria-label='Remove photo'>✕ Remove</button>";
    el.attachPreview.querySelector("img").src = dataUrl;
    el.attachPreview.querySelector("button").onclick = clearImage;
    el.attachPreview.hidden = false;
    el.chatInput.focus();
  };
  img.onerror = function () { URL.revokeObjectURL(url); toast("Couldn't read that image"); };
  img.src = url;
}
function clearImage() {
  pendingImage = null;
  el.attachPreview.hidden = true;
  el.attachPreview.innerHTML = "";
}

/* ---------------- voice input ---------------- */
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  el.micBtn.hidden = false;
  let rec = null;
  el.micBtn.addEventListener("click", function () {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = true;
    const base = el.chatInput.value ? el.chatInput.value.replace(/\s*$/, " ") : "";
    rec.onresult = function (ev) {
      let t = "";
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      el.chatInput.value = base + t;
      autosize();
    };
    rec.onend = function () { rec = null; el.micBtn.classList.remove("rec"); el.chatInput.focus(); };
    rec.onerror = function (ev) { if (ev.error === "not-allowed") toast("Microphone access was blocked"); };
    el.micBtn.classList.add("rec");
    try { rec.start(); } catch (e) { rec = null; el.micBtn.classList.remove("rec"); }
  });
}

/* ---------------- helpers ---------------- */
function save() {
  store.set(STORE_KEY, {
    subject: el.tutorSubject.value,
    tier: tier.get(),
    mode: mode,
    messages: messages.filter(function (m) { return m.text; }).slice(-MAX_SAVED).map(function (m) {
      return { role: m.role, text: m.text, mode: m.mode, hadImage: !!(m.hadImage || m.img) };
    })
  });
}

function guessTopic(aiIndex) {
  let i = aiIndex != null && aiIndex >= 0 ? aiIndex : messages.length;
  for (i = i - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "user" && messages[i].text !== PHOTO_PROMPT && messages[i].text.indexOf("I just did a quiz") !== 0) {
      let t = messages[i].text.replace(/^(explain( simply:)?|revision notes on|give me an exam question on|what is|what are|how do(es)?|why)\s+/i, "");
      t = t.replace(/[?.!]+$/, "").trim();
      return t.length > 90 ? t.slice(0, 87) + "…" : t;
    }
  }
  return "";
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
// "Quadratic equations" -> "quadratic equations", but keep proper nouns like "Germany 1918–45" or "The Cold War".
function lowerFirst(s) {
  const w = s.split(/\s+/);
  if (!/^[A-Z][a-z]/.test(w[0])) return s;
  if (w.length > 1 && !/^[a-z]/.test(w[1])) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export { nm };
