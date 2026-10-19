// Vercel Serverless Function (Node.js) — POST /api/chat
// Streams an AI tutor reply from Google Gemini as plain text.
//
// Request JSON:
//   { subject: "Physics", tier: "Higher", mode: "explain",
//     messages: [{ role: "user"|"model", text: "...", image?: { mimeType, data(base64) } }] }
// Response: text/plain stream. If something fails mid-stream, the text "\u0000ERR:<message>" is appended.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY   required — from https://aistudio.google.com/apikey
//   GEMINI_MODEL     optional — defaults to gemini-3.8-flash
//   ACCESS_CODES     optional — comma-separated codes; if set, only these codes can use the AI

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const API_BASE = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

const SUBJECT_CODES = {
  "Mathematics": "4MA1", "Physics": "4PH1", "Chemistry": "4CH1", "Biology": "4BI1",
  "English Language": "4EA1", "English Literature": "4ET1", "Computer Science": "4CP0",
  "Economics": "4EC1", "Business": "4BS1", "Geography": "4GE1", "History": "4HI1"
};

const MODES = {
  explain: "Explain the concept step by step in clear language. Include one short worked example with all working shown. Finish with a single 'Quick check' question for the student, without giving its answer.",
  notes: "Produce concise revision notes using these sections where relevant: ## Key ideas, ## Definitions (bold each key term), ## Key equations / facts, ## Common mistakes, ## Exam tips. Use bullet points and keep each bullet short.",
  practice: "Act as an Edexcel examiner running a practice session. If the student names a topic, set ONE exam-style question with the marks shown in brackets, e.g. (3), and wait for their answer: do not reveal the answer. When the student answers, mark it like a mark scheme (M1/A1/B1 for maths, separate marking points for other subjects), state the marks awarded out of the total, explain exactly what earned or lost marks, give a model answer, then offer the next question.",
  mark: "The student will give you a question and their answer. Mark it like an Edexcel examiner: give a score out of the available marks (estimate the marks if they are not stated), list each marking point with ✓ or ✗, explain how to improve, and finish with a full-mark model answer.",
  simple: "Explain in very simple, plain English with an everyday analogy. Avoid jargon and define any technical term you must use. Keep it under 200 words."
};

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_TURNS = 20;
const MAX_TEXT = 8000;
const MAX_IMAGE_B64 = 4_000_000; // keep requests under Vercel's 4.5 MB body limit

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Use POST." });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: "Invalid JSON body." }); }

  // Access codes: only people with a code listed in ACCESS_CODES can use the AI.
  if (!hasAccess(req)) {
    return sendJson(res, 401, { error: "The AI tutor is for approved users. Click Log in and enter your access code." });
  }
  if (body && body.check) return sendJson(res, 200, { ok: true }); // used by the Log in box

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { error: "The AI tutor isn't set up yet: add a GEMINI_API_KEY environment variable in Vercel and redeploy." });
  }

  // Backwards compatible with the old site, which sent { prompt, subject }.
  if (body && typeof body.prompt === "string" && !Array.isArray(body.messages)) {
    body.messages = [{ role: "user", text: body.prompt }];
  }

  let contents;
  try { contents = toContents(body && body.messages); } catch (e) { return sendJson(res, 400, { error: e.message }); }

  const subject = SUBJECT_CODES[body.subject] ? body.subject : "";
  const tier = body.tier === "Foundation" ? "Foundation" : "Higher";
  const mode = MODES[body.mode] ? body.mode : "explain";

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(subject, tier, mode) }] },
    contents,
    generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" } }
  };

  const abort = new AbortController();
  res.on("close", function () { if (!res.writableFinished) abort.abort(); });

  let upstream;
  try {
    upstream = await callGemini(apiKey, payload, abort.signal);
    if (upstream.status === 400) {
      // Some models reject thinkingConfig — retry once without it.
      if (upstream.body) upstream.body.cancel().catch(function () {});
      delete payload.generationConfig.thinkingConfig;
      upstream = await callGemini(apiKey, payload, abort.signal);
    }
  } catch (e) {
    if (abort.signal.aborted) return;
    return sendJson(res, 502, { error: "Couldn't reach the AI service. Please try again." });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(function () { return ""; });
    console.error("Gemini error", upstream.status, detail.slice(0, 500));
    return sendJson(res, upstream.status === 429 ? 429 : 502, { error: friendlyError(upstream.status) });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  let wrote = false;
  let blocked = "";
  try {
    for await (const event of sseEvents(upstream.body)) {
      if (event.promptFeedback && event.promptFeedback.blockReason) blocked = "prompt";
      const cand = event.candidates && event.candidates[0];
      if (!cand) continue;
      const parts = (cand.content && cand.content.parts) || [];
      for (const p of parts) {
        if (typeof p.text === "string" && p.text && !p.thought) { res.write(p.text); wrote = true; }
      }
      if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") blocked = "answer";
      if (cand.finishReason === "MAX_TOKENS" && wrote) res.write("\n\n_…answer cut short. Ask me to continue._");
    }
    if (!wrote) {
      res.write("\u0000ERR:" + (blocked
        ? "I can't help with that one. Try asking about an IGCSE topic instead."
        : "The AI returned an empty answer. Try rephrasing your question."));
    }
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error("Stream error", e);
      res.write("\u0000ERR:The answer was interrupted. Please try again.");
    }
  }
  res.end();
}

function systemPrompt(subject, tier, mode) {
  const subj = subject ? "Edexcel International GCSE " + subject + " (" + SUBJECT_CODES[subject] + ")" : "Edexcel International GCSE (any subject)";
  return [
    "You are the AI tutor on IGCSE Papers, a revision site for Pearson Edexcel International GCSE students (typically aged 14–16).",
    "Current subject: " + subj + ". Tier: " + tier + ".",
    "",
    "Rules:",
    "- Stay within the Edexcel International GCSE specification for the subject. If something goes beyond it, say so briefly.",
    "- Use British English spelling and SI units.",
    "- Format with Markdown: short paragraphs, bullet lists, **bold** key terms, tables for comparisons, and ## headings only for longer answers.",
    "- Write all maths, formulas and chemical equations in LaTeX, using \\( ... \\) inline and \\[ ... \\] for display. Never use single $ signs for maths. Write money as plain text (e.g. $5, £20).",
    "- Be accurate. If you are not sure, say so. Never invent past-paper references, dates, grade boundaries or mark-scheme wording.",
    "- Teach the method rather than just handing over final answers to homework.",
    "- If the student attaches a photo, first restate the question you can see in one line, then help. If it is unreadable, say so.",
    "- Only help with study and school topics. Politely decline anything unrelated, unsafe or inappropriate for students.",
    "- Keep answers focused: usually under 350 words unless the student asks for more.",
    tier === "Foundation" ? "- Foundation tier: use simpler language and avoid Higher-only content unless asked." : "- Higher tier: you may include Higher-only content and stretch questions.",
    "",
    "Mode: " + MODES[mode]
  ].join("\n");
}

function toContents(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("Send at least one message.");
  const out = [];
  for (const m of messages.slice(-MAX_TURNS)) {
    if (!m || (m.role !== "user" && m.role !== "model")) continue;
    const text = typeof m.text === "string" ? m.text.slice(0, MAX_TEXT) : "";
    const parts = [];
    if (m.role === "user" && m.image && typeof m.image.data === "string") {
      if (!ALLOWED_IMAGE_TYPES.has(m.image.mimeType)) throw new Error("Images must be JPG, PNG or WebP.");
      if (m.image.data.length > MAX_IMAGE_B64) throw new Error("That image is too large. Try a smaller photo.");
      parts.push({ inlineData: { mimeType: m.image.mimeType, data: m.image.data } });
    }
    if (text.trim()) parts.push({ text });
    if (!parts.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.parts.push(...parts); // Gemini expects alternating turns
    else out.push({ role: m.role, parts });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") throw new Error("The last message must be from the student.");
  return out;
}

function callGemini(apiKey, payload, signal) {
  return fetch(API_BASE + "/v1beta/models/" + encodeURIComponent(MODEL) + ":streamGenerateContent?alt=sse", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
    signal
  });
}

async function* sseEvents(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") {
          try { yield JSON.parse(data); } catch (e) { /* ignore partial/keep-alive lines */ }
        }
      }
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) { try { yield JSON.parse(rest.slice(5).trim()); } catch (e) { /* ignore */ } }
}

function friendlyError(status) {
  if (status === 429) return "The AI tutor is busy right now. Please wait a few seconds and try again.";
  if (status === 401 || status === 403) return "The AI service rejected the API key. Check GEMINI_API_KEY in Vercel.";
  if (status === 404) return "The configured AI model wasn't found. Check GEMINI_MODEL in Vercel.";
  if (status === 400) return "The AI service couldn't process that message. Try rephrasing it.";
  return "The AI service had a problem (" + status + "). Please try again.";
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8") || "{}");
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw new Error("Body too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// ACCESS_CODES is a comma-separated list set in Vercel, e.g. "amira-4821,omar-9302".
// If it is empty or missing, the AI is open to everyone.
function hasAccess(req) {
  const codes = (process.env.ACCESS_CODES || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean);
  if (!codes.length) return true;
  const given = String(req.headers["x-access-code"] || "").trim();
  return given !== "" && codes.indexOf(given) >= 0;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
